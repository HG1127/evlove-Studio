param(
 [Parameter(Mandatory)][string]$EntryPoint,
 [Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][string]$DeadlineUtc,
 [ValidateRange(0,60)][int]$CleanupGraceSeconds=0,
 [ValidateRange(0,60)][int]$DiagnosticStartupAllowanceSeconds=0,
 [string[]]$EnvironmentFiles=@(),
 [string]$ControlBindingPath
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Get-Location).Path)+[IO.Path]::DirectorySeparatorChar
function Workspace-Path([string]$inputPath){
 $resolved=[IO.Path]::GetFullPath($inputPath,(Get-Location).Path)
 if(!$resolved.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Path must stay inside the workspace'}
 return $resolved
}
$entry=Workspace-Path $EntryPoint
$evidence=Workspace-Path $EvidenceDirectory
$artifactRoot=Join-Path $root 'artifacts'
if(!$evidence.StartsWith($artifactRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Process evidence must stay in local artifacts'}
if(!(Test-Path -LiteralPath $entry -PathType Leaf) -or [IO.Path]::GetExtension($entry) -ne '.mjs'){throw 'Existing trusted mjs entrypoint required'}
$deadline=[DateTimeOffset]::Parse($DeadlineUtc,[Globalization.CultureInfo]::InvariantCulture)
$remaining=($deadline-[DateTimeOffset]::UtcNow).TotalMilliseconds
if($DiagnosticStartupAllowanceSeconds -gt 0 -and $ControlBindingPath){throw 'Diagnostic startup allowance cannot extend a bound execution window'}
if($remaining -le 0 -or $remaining -gt (1800000+1000*$DiagnosticStartupAllowanceSeconds)){throw 'Deadline exceeds the next 30 minutes plus explicit diagnostic startup allowance'}
$cleanupDeadline=$deadline.AddSeconds($CleanupGraceSeconds)
if(Test-Path -LiteralPath $evidence){throw 'Evidence directory already exists; inspect instead of overwriting'}
$environmentPaths=@($EnvironmentFiles | ForEach-Object { $v=Workspace-Path $_;if(!(Test-Path -LiteralPath $v -PathType Leaf)){throw 'Environment file missing'};$v })
[IO.Directory]::CreateDirectory($evidence) | Out-Null
$nodePath=@(Get-Command node -CommandType Application)[0].Source
$info=[Diagnostics.ProcessStartInfo]::new($nodePath)
$info.WorkingDirectory=(Get-Location).Path
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$info.RedirectStandardOutput=$true
$info.RedirectStandardError=$true
# Trusted child controllers must enforce this original deadline before any new work.
# Cleanup grace is process lifetime only; it grants no model or trial authority.
$info.Environment['EVOLUTION_EXECUTION_DEADLINE_UTC']=$deadline.ToUniversalTime().ToString('o')
$info.Environment['EVOLUTION_PROCESS_CLEANUP_DEADLINE_UTC']=$cleanupDeadline.ToUniversalTime().ToString('o')
$info.ArgumentList.Add('--max-old-space-size=768')
foreach($v in $environmentPaths){$info.ArgumentList.Add('--env-file='+$v)}
$info.ArgumentList.Add($entry)
$child=[Diagnostics.Process]::new();$child.StartInfo=$info
$stdout=[IO.FileStream]::new((Join-Path $evidence 'stdout.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
$stderr=[IO.FileStream]::new((Join-Path $evidence 'stderr.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
$started=$false;$terminalWritten=$false;$deadlineStop=$false;$executionDeadlineReached=$false
$controlModule=Join-Path $PSScriptRoot 'control-session.mjs'
if($ControlBindingPath){
 $controlBinding=Workspace-Path $ControlBindingPath
 & $nodePath $controlModule initialize $evidence $controlBinding $deadline.ToUniversalTime().ToString('o') (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
 if($LASTEXITCODE -ne 0){throw 'Control binding rejected before process start'}
}
function Record-CancelIntent([string]$reason){
 if($ControlBindingPath){
  & $nodePath $controlModule intent $evidence $reason
  if($LASTEXITCODE -ne 0){throw 'Cancellation intent could not be durably recorded; authoritative cancellation remains unknown'}
 }
}
function Record([hashtable]$record){
 $record.at=[DateTimeOffset]::UtcNow.ToString('o')
 $record.supervisorPid=$PID
 $record.pid=$child.Id
 $record.deadlineUtc=$deadline.ToUniversalTime().ToString('o')
 $record.cleanupDeadlineUtc=$cleanupDeadline.ToUniversalTime().ToString('o')
 $record.cleanupGraceSeconds=$CleanupGraceSeconds
 $record.diagnosticStartupAllowanceSeconds=$DiagnosticStartupAllowanceSeconds
 [IO.File]::AppendAllText((Join-Path $evidence 'events.jsonl'),(($record|ConvertTo-Json -Compress)+[Environment]::NewLine))
}
try{
 if([DateTimeOffset]::UtcNow -ge $deadline){throw 'Deadline expired before process start'}
 if(!$child.Start()){throw 'Owned process did not start'};$started=$true
 $outCopy=$child.StandardOutput.BaseStream.CopyToAsync($stdout)
 $errCopy=$child.StandardError.BaseStream.CopyToAsync($stderr)
 Record @{kind='started';entrypointSha256=(Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant();automaticRestart=$false}
 while($true){
  $nextDeadline=if($executionDeadlineReached){$cleanupDeadline}else{$deadline}
  if($child.WaitForExit([Math]::Max(1,[Math]::Min(500,[int]($nextDeadline-[DateTimeOffset]::UtcNow).TotalMilliseconds)))){break}
  $child.Refresh()
  Record @{kind='heartbeat';workingSetBytes=$child.WorkingSet64}
  if(!$executionDeadlineReached -and [DateTimeOffset]::UtcNow -ge $deadline){
   $executionDeadlineReached=$true;Record-CancelIntent 'deadline'
   Record @{kind='execution-deadline-reached';automaticRestart=$false}
  }
  if([DateTimeOffset]::UtcNow -ge $cleanupDeadline){$deadlineStop=$true;$child.Kill($true);$child.WaitForExit();break}
 }
 if(!$executionDeadlineReached -and ([DateTimeOffset]($child.ExitTime.ToUniversalTime())) -ge $deadline){
  $executionDeadlineReached=$true;Record-CancelIntent 'deadline'
  Record @{kind='execution-deadline-reached';automaticRestart=$false}
 }
 $outCopy.GetAwaiter().GetResult();$errCopy.GetAwaiter().GetResult()
 Record @{kind='exited';exitCode=$child.ExitCode;deadlineStop=$deadlineStop;executionDeadlineReached=$executionDeadlineReached;automaticRestart=$false}
 if(!$deadlineStop -and $child.ExitCode -ne 0){Record-CancelIntent 'runtime-loss'}
 $terminalWritten=$true
}finally{
 if($started -and !$child.HasExited){$child.Kill($true);$child.WaitForExit()}
 if($started -and !$terminalWritten){Record-CancelIntent 'supervision-failed';Record @{kind='supervision-failed';exitCode=$child.ExitCode;executionEvidenceComplete=$false}}
 $stdout.Dispose();$stderr.Dispose();$child.Dispose()
}
