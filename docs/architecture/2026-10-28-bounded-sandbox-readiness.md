# Bound basic isolated-runtime readiness I/O

Date: 2026-10-28

Status: accepted reliability repair; complete SOP acceptance remains unproved.

## Observation

C29's original start request timed out locally after 300 seconds. Repeated Mission-bound reads found no Job, local Workflow run or model admission. The owned backend remained alive until it was explicitly stopped, without another start request or a renewed trial window. Startup calls basic isolated-runtime readiness before creating a Job. The old basic check limited the VM lifetime and commands but supplied no cancellation signal for allocation, command transport, output streams or cleanup. The exact blocked await in C29 is unknown; a nearby stopped cloud health session is not proven to belong to this Mission.

Fault injection independently reproduced unbounded waits at all four basic-check boundaries. A VM expiry or command execution timeout alone does not bound the client's pending HTTP/stream operation.

## Decision

The adapter supplies one 30-second AbortSignal across basic allocation, version commands and output reads, preserving the existing 30-second VM budget. It checks cancellation after each awaited phase so a late allocation cannot dispatch commands. Cleanup receives a fresh, separate 10-second signal; it cannot reuse an expired probe signal. VM lifetime remains bounded if best-effort cleanup fails. There is no automatic retry.

A timed-out basic check returns `ready:false` with a phase-specific `SANDBOX_HEALTH_TIMEOUT` message. The application keeps the existing 503 admission gate and explains that the Mission has not started. Its remedy is to inspect the original check/request before another attempt; a timeout does not establish a credential failure. A cleanup failure after genuinely successful commands retains the pre-existing best-effort semantics and does not fabricate a failed command result.

This change bounds only the basic probe, not every browser/snapshot preflight. All browser, evidence, Candidate identity, budget and final-acceptance gates remain. SDK I/O stays in Adapters and admission presentation in the application; Contracts/Core/Harness acquire no infrastructure dependency or architecture exception.

## Verification and limits

Mocked SDK tests cover hanging allocation, commands, output and cleanup, plus a late allocation with zero subsequent command dispatch. Application tests retain the mandatory browser/evidence gate and verify the timeout-specific remedy. These are local fault-injection results, not a live induced cloud failure.

One separate real cloud diagnostic at `2026-10-28T14:41:31.429Z` completed in 3,701 ms, reporting Node `v24.22.1` and npm `11.19.1`. Its temporary environment was subsequently listed as stopped. It used only constant version commands, deny-all networking and `persistent:false`, with the existing active Hobby team; no SOP or model request was sent and no purchase/upgrade occurred. Actual monetary cost remains unavailable. This establishes normal-path compatibility, not that the timeout repair caused the faster response or that the complete SOP evolution loop passes.

C29's startup-only outcome remains signed and unchanged. A subsequent complete trial requires a fresh registration and all original 8/6/9 and independent-final requirements. No accepted delivery, real business benefit or causal transfer is established here.

Final engineering verification passes 97 related tests across 11 files, all 11 Runner tests, architecture/changed-file lint and the full TypeScript/production build.
