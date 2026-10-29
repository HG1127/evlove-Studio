# Local Runner Migration Target

The existing `runner-gateway/` remains operational during the transition.

This package implements local native HTML observations for explicitly selected local Missions. Production execution continues to use Vercel Sandbox; this package is loaded only by a local Node 22+ process through its public workspace export.

Select `experimentPolicy.nativeHtmlRuntime: "local-browser-v1"` and list the authorized Mission ID in `EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS`. The route admits only the existing known renderer and always requests Chromium's process sandbox. It starts a fresh headless process per subject, blocks document egress, and never falls back to a paid cloud service. Missing capability pauses dependent work as UNVERIFIED.

Run `pnpm runner:test` for launcher and existing runner checks; `pnpm runner:test:local-browser` verifies the real local browser boundary using a trusted fixture. Install a supported browser separately if unavailable. The native assertion body remains identical to the cloud observer and is checked by adapter tests. See `docs/architecture/2026-10-29-local-native-html-verification.md` for evidence and authorization boundaries.
