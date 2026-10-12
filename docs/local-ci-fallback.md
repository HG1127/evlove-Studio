# Local CI fallback

Authorized by the project owner on 2026-10-12. PROJECT_RULES.md is the governing policy.

## Trigger and quality gate

Use local CI when hosted GitHub Actions is unavailable due to a verified infrastructure, account billing/quota, or service failure. Record the affected run and observed reason. A failing code test is a defect to repair, not a fallback trigger.

After every required local check passes for the exact candidate commit, LOCAL_CI_PASSED is the approved quality gate during the hosted outage. Preserve the actual hosted status and any enforced branch-protection/access restriction.

## Complete checklist

Use .github/workflows/quality-gate.yml as the current authoritative checklist. If that workflow gains a check, local CI must cover it too.

1. Use a clean isolated checkout of the exact full commit SHA. Record parent/tree, source and lockfile hashes, operating system, Node 24 and the packageManager-pinned pnpm version.
2. Install root dependencies with pnpm install --frozen-lockfile. Installation may reuse a verified local package cache, but must preserve the lockfile.
3. Run pnpm lint and pnpm architecture:check.
4. Install the root lockfile-pinned Chromium before the Vitest suite: browser-backed unit tests execute the trusted generated runner against synthetic HTML. Then run the entire Vitest suite with maxWorkers=1. For memory-limited hosts, discover the full test manifest and execute serial batches. Retain every report/exit code, check unique complete manifest coverage, and record explicit skips.
5. Run pnpm build, including TypeScript and the production bundle. Hash the produced build files before browser checks and verify they remain unchanged afterwards.
6. Run pnpm runner:setup. Install or verify the pinned Chromium/browser dependencies required by both Playwright and Runner.
7. Run pnpm runner:test.
8. Run pnpm test:e2e for the Chromium project.
9. Start an owned local UI server and run scripts/ui-smoke.mjs, including the routes, responsive and denied-storage checks implemented by the current script.
10. Verify the source checkout remains clean and matches the original candidate SHA. Emit one summary containing all stage statuses, commands, logs, exit codes, counts, skips and build/source identities.

## Execution isolation

- Keep TEMP/TMP, reports and screenshots on D:/Downloads/evolution-os-smoke-temp when available.
- Run expensive checks serially; coordinate with the dedicated CI chat to avoid competing full-suite processes.
- Use synthetic fixtures and child-process CI configuration. Do not inherit production credentials into tests that can write externally; do not change persisted operator/model configuration.
- Do not reuse an unrelated server already listening on the default port. Use an owned free port with a temporary CI-only configuration when necessary, and stop only owned processes.
- Preserve a failed attempt and its cause. A passing rerun must be linked to the same unchanged source or to an explicitly identified repair commit.
- If a process is interrupted or a required receipt is missing, report that stage INCOMPLETE. A narrower fixture, route smoke or prior commit receipt cannot replace it.

## Delivery evidence

The dedicated Git and CI chats own integration, merge, push and deployment under their existing authorization. Hand off the exact candidate SHA and complete local result. A new candidate needs matching verification; do not reuse a passed result from a different SHA.

Production build-info and read-only smoke must identify the actually served commit. Record old-deployment observations separately while a new candidate is not deployed.

Local CI verifies code and controlled runtime checks. It does not establish a real Mission's original/frozen/downloaded file identities, live Experiment, paired same-Hidden execution, Gate F or accepted-file reopening. Existing production/user-file approval boundaries remain in force.
