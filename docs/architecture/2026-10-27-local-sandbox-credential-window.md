# Local Sandbox credential lifetime covers the bounded Campaign

Status: accepted, 2026-10-27.

## Measured problem

Confirmation twelve used `943c5fc` and completed its initial construction in one physical model request. The exact response can be replayed through the existing parser, request-bound ranges, text mutation and derived-index compiler to reproduce frozen SHA-256 `755684e6078e337f2f3e1d5c91fa2d0208b7a3863f0d3c3c84dcec58863141a3`, 310,301 bytes. This establishes construction identity, not semantic acceptance.

The fixed local OIDC expired at `2026-10-27T12:37:26.000Z`. At the `12:32:35.815Z` start intent it still passed the existing two-minute passive check, but could not cover the registered 30-minute trial. Candidate execution later lacked native evidence; the explicit protection test reported missing OIDC credentials. Ordinary fallback/static evidence did not establish all protection criteria. The visible verdict also recorded lower user-goal scores. No Winner, shared repair, Hidden/final acceptance, delivery or lesson followed. The completed Workflow and failed/partial verdict remain preserved; refreshing credentials cannot reopen that trial or rewrite its scores.

## Decision

Add the public adapter helper `sandboxCredentialWindowIssue(windowMs, env, nowMs)`. It first preserves existing malformed/expired/not-yet-valid/scope and explicit Access Token checks. For fixed local OIDC it additionally requires remaining validity greater than the bounded Campaign duration plus the existing two-minute margin. It returns `VERCEL_OIDC_WINDOW_TOO_SHORT` with expiry and remediation, never a bearer token. Invalid window arguments fail closed.

The HTML start preflight calls this passive helper before database and metered VM probes, and again after the actual probes, immediately before returning to Job creation. A slow successful health probe cannot leave a stale initial lifetime check as start authority. The existing `HTML_SANDBOX_NOT_READY` response carries the specific credential issue. Non-HTML paths do not call it.

Deployment context (`VERCEL=1` with production/preview environment) retains the platform's refreshed OIDC path; explicit Access Token mode retains its existing configuration and remote authorization checks. Neither path infers an unknown credential lifetime from a local JWT. A missing bounded Campaign duration retains the existing short-lived diagnostic behavior; this change does not invent a duration for an unbounded job.

JWT claims are not signature-verified here and can only deny a start. Passing this check does not establish provider permission. Actual Sandbox and executable Chromium probes remain mandatory. No credentials enter the guest; deny-all networking, ephemeral execution, original file identities, all quality/Safety gates and shared repair limits are unchanged. No automatic login, renewal, trial retry or deployment is added.

## Ownership and verification

Credential inspection stays in Adapters, imported through `@evolution/adapters/sandbox` by the backend composition root. Contracts/Core/Harness gain no infrastructure dependency, persisted policy reinterpretation or schema migration.

Tests reproduce C12's actual timing, exact expiry boundary, slow-probe transition, malformed/scope/incomplete credentials, platform and explicit-token compatibility, mandatory remote probes, non-HTML behavior and no-Job behavior through the existing start-route tests. Synthetic JWTs establish only the local rejection rule. The real expired token and sealed trial remain historical evidence; local tests cannot establish any of the three real evolution effects.
