param(
 [Parameter(Mandatory)][string]$EntryPoint,
 [Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][string]$DeadlineUtc,
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
if($remaining -le 0 -or $remaining -gt 1800000){throw 'Deadline must be in the next 30 minutes'}
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
$info.ArgumentList.Add('--max-old-space-size=768')
foreach($v in $environmentPaths){$info.ArgumentList.Add('--env-file='+$v)}
$info.ArgumentList.Add($entry)
$child=[Diagnostics.Process]::new();$child.StartInfo=$info
$stdout=[IO.FileStream]::new((Join-Path $evidence 'stdout.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
$stderr=[IO.FileStream]::new((Join-Path $evidence 'stderr.log'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,$true)
$started=$false;$terminalWritten=$false;$deadlineStop=$false
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
 [IO.File]::AppendAllText((Join-Path $evidence 'events.jsonl'),(($record|ConvertTo-Json -Compress)+[Environment]::NewLine))
}
try{
 if([DateTimeOffset]::UtcNow -ge $deadline){throw 'Deadline expired before process start'}
 if(!$child.Start()){throw 'Owned process did not start'};$started=$true
 $outCopy=$child.StandardOutput.BaseStream.CopyToAsync($stdout)
 $errCopy=$child.StandardError.BaseStream.CopyToAsync($stderr)
 Record @{kind='started';entrypointSha256=(Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant();automaticRestart=$false}
 while(!$child.WaitForExit([Math]::Max(1,[Math]::Min(500,[int]($deadline-[DateTimeOffset]::UtcNow).TotalMilliseconds)))){
  $child.Refresh()
  Record @{kind='heartbeat';workingSetBytes=$child.WorkingSet64}
  if([DateTimeOffset]::UtcNow -ge $deadline){$deadlineStop=$true;$child.Kill($true);$child.WaitForExit();Record-CancelIntent 'deadline';break}
 }
 $outCopy.GetAwaiter().GetResult();$errCopy.GetAwaiter().GetResult()
 Record @{kind='exited';exitCode=$child.ExitCode;deadlineStop=$deadlineStop;automaticRestart=$false}
 if(!$deadlineStop -and $child.ExitCode -ne 0){Record-CancelIntent 'runtime-loss'}
 $terminalWritten=$true
}finally{
 if($started -and !$child.HasExited){$child.Kill($true);$child.WaitForExit()}
 if($started -and !$terminalWritten){Record-CancelIntent 'supervision-failed';Record @{kind='supervision-failed';exitCode=$child.ExitCode;executionEvidenceComplete=$false}}
 $stdout.Dispose();$stderr.Dispose();$child.Dispose()
}
