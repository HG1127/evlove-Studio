# Observing a bounded local calibration

A local model calibration must keep process evidence independently of the caller's
interactive command handle. Losing that handle does not say whether a request
was delivered or answered. A reserved request with no complete response remains
unknown and must not be replayed.

Use the existing Windows supervisor for a trusted, already approved executor:

```powershell
pwsh -NoProfile -File tools/local-runner/observe-node-process.ps1 `
  -EntryPoint '<approved-executor.mjs>' `
  -EntryPointArguments '<approved-trial-directory>' `
  -EvidenceDirectory '<new-artifacts-process-evidence-directory>' `
  -DeadlineUtc '<original-approved-absolute-deadline>' `
  -UseEnvironmentProxy -RequireProcessObservation
```

Run from the intended workspace with the approved environment already loaded.
Arguments are passed through `ProcessStartInfo.ArgumentList`, with no shell
evaluation. `UseEnvironmentProxy` explicitly forwards Node's proxy option; it
does not change proxy settings or load credentials. Do not put credentials in
arguments. If launching through `Start-Process`, use `-WindowStyle Hidden` and
persist the launcher's output to local artifact files.

`RequireProcessObservation` preloads a guard before the entrypoint runs. It checks
the current child's identity, the live supervisor's creation ticks, the exact
entrypoint hash and the original deadline against the recorded start. Missing or
conflicting supervision stops startup before the executor is imported. This guard
does not replace the executor's authorization or request-budget checks.

The supervisor records stdout/stderr, a heartbeat, absolute execution deadline,
and child/supervisor PID plus Windows creation ticks. It never restarts the child.
Cleanup grace extends cleanup time only. The executor remains responsible for
authorization, immutable request hashes, quota, request reservation, response
validation, and stopping new work at the original deadline. Supervision itself
does not grant model authority or make a failed or occupied trial reusable.

For recovery, import `inspectObservedNodeProcess` from the public
`@evolution/local-runner/process-observation` entry point and inspect the evidence
directory. The default probe reads only Windows process identity. It does not
read command lines, environment, provider response text, SOPs or answer labels.

| Observation | Meaning |
| --- | --- |
| `live` | The recorded child PID and creation ticks currently match. The supervisor may already be gone. Keep observing that child. |
| `awaiting-terminal-receipt` | The child is gone but its matching supervisor is still running. Allow it to finish recording. |
| `stopped-without-terminal-receipt` | Both recorded identities are gone or their PIDs were reused. The missing provider result remains unknown. |
| `unverified` | An OS read failed or was ambiguous. No death, retry or completion can be inferred. |
| `exited` / `supervision-failed` | A local process terminal record exists. This proves no model score or acceptance outcome. |

A stale heartbeat, a PID alone, an elapsed deadline, or an inaccessible process
cannot establish termination. Legacy journals lacking creation ticks and malformed
or inconsistent journals fail validation. Every result explicitly disables
automatic restart. Any caller saving a recovery observation must append a new
receipt rather than manufacture the executor's missing outcome or overwrite the
old trial.

The tests exercise real Windows child and supervisor termination, literal
argument forwarding, PID reuse, missing/access-denied observations, corrupt
journals, and completed process receipts. These are execution reliability tests;
they do not establish judge calibration, accepted SOP delivery, business benefit,
or causal Lesson transfer.
