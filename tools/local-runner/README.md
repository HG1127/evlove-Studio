# Local Runner Migration Target

For explicitly authorized local backend runs on Windows, launch the trusted Node entrypoint with `pwsh -NoProfile -File tools/local-runner/observe-node-process.ps1 -EntryPoint <workspace-entry.mjs> -EvidenceDirectory <new-artifacts-directory> -DeadlineUtc <original-UTC-deadline>`. Optional `-EnvironmentFiles` loads existing workspace files without recording their contents. The deadline must already be fixed and within 30 minutes; existing evidence directories are rejected. Keep evidence and process output private. This launcher does not grant AI, upload or trial authorization.

The supervisor records child identity, entrypoint hash, heartbeats, real exit code and deadline termination, streams output to local files and never restarts the process. It terminates its owned process tree at the original deadline. Run `node --test tools/local-runner/observed-process.test.mjs` on Windows for real-process failure/deadline checks. If the supervisor itself is forcibly terminated, a missing terminal event remains incomplete evidence; a heartbeat gap does not establish an exit cause. This improves observation, not immunity to host termination, Workflow cancellation or semantic acceptance. C44's unknown exit cause and negative verdict remain unchanged.

The existing `runner-gateway/` remains operational during the transition.

This package implements local native HTML observations for explicitly selected local Missions. Production execution continues to use Vercel Sandbox; this package is loaded only by a local Node 22+ process through its public workspace export.

Select `experimentPolicy.nativeHtmlRuntime: "local-browser-v1"` and list the authorized Mission ID in `EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS`. The route admits only the existing known renderer and always requests Chromium's process sandbox. It starts a fresh headless process per subject, blocks document egress, and never falls back to a paid cloud service. Missing capability pauses dependent work as UNVERIFIED.

Run `pnpm runner:test` for launcher and existing runner checks; `pnpm runner:test:local-browser` verifies the real local browser boundary using a trusted fixture. Install a supported browser separately if unavailable. The native assertion body remains identical to the cloud observer and is checked by adapter tests. See `docs/architecture/2026-10-29-local-native-html-verification.md` for evidence and authorization boundaries.
