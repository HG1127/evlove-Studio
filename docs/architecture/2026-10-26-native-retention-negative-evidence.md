# Measured HTML retention loss is negative evidence

Owner: Evolution OS maintainers. Date: 2026-10-26. This clarifies evidence settlement within the existing architecture; it adds no platform or schema exception.

## Actual failure

The bounded confirmation produced physical Candidate `eb096af64ddfe3f297933d829c0e4a04eea64d0779cb6f01c026ac892159609e`, 314,618 bytes. Its script/style surface matches the supported renderer, but the unchanged parsed retention policy retained only 55 of 57 original preformatted/code blocks. The native inspector previously required successful retention for observation completeness. Harness then replaced the observation with `NATIVE_HTML_EVIDENCE_INVALID`, hiding a concrete preservation problem as missing capability.

The same exact Original and Candidate were read back and independently observed in one network-denied, nonpersistent remote Sandbox. The adapter awaited shutdown before returning. Each subject completed 37 assertions; the report has SHA-256 `0f545b7e2b55832b911c4e3afc59fe62eaa767f26f6ac252f78f4269cbfd4782`. This diagnostic is local, consumes no AI request, and does not replace the authoritative Visible/Hidden result or use the reserved final questions.

## Decision

Core continues validating the complete receipt, rendered text, per-case/source/physical hashes, Original health, expected check inventory, tested counts, query binding and viewport/style observations. A consistent, versioned retention summary can prove that original blocks were lost. It adds `original-code-block-loss` to failures and no longer makes an otherwise complete observation unavailable. A missing retention summary with a false retention flag remains partial. Contradictory counts remain invalid. Unknown controls and an unhealthy Original still prevent complete coverage.

The existing protection settlement now receives the complete negative proof and returns a verified failure even if an independent Judge offers 99/pass. Passing observations continue requiring independent semantic review; native checks do not produce positive quality scores. Harness preserves the physically bound failure and still rejects stale, duplicate or wrong-Original evidence. Application execution fingerprints include `html-native-evidence-v2-measured-retention-loss` so assessment reuse cannot silently ignore the change.

The real Hidden report also exposed a misleading comparison row: unverified Candidate observations could display a passing regression check because no verified regression had been detected. The row now remains a warning whenever comparison evidence is incomplete, without presenting unmeasured zero quality values as a successful comparison. An actual verified regression still fails, and a complete verified comparison can pass. This changes the truthful report projection, not admission thresholds or the historical report.

## Trial limits

The confirmation's existing start, 30-minute limit, one Candidate, one possible repair, original eight criteria and independent final paper remain unchanged. Its wall-clock window expired before this engineering repair. The unused repair allowance does not grant more time or a new trial. No AI-authored file is manually repaired, no original verdict is rewritten, and no delivery, actual user benefit or transfer is claimed. See [the actual acceptance record](../real-evolution-acceptance.md).

## Verification

Regression tests reproduce the measured 57/55 counterexample, require a verified protection failure with or without a positive Judge response, preserve the proof through Harness execution/recovery checks, and retain unknown-capability/identity guards. The incomplete-comparison counterexample warns while existing complete-pass and verified-regression tests retain their outcomes. All 237 related tests across 12 files pass; the 49-case Holdout file was rerun after the final report fix. All 11 Runner tests, architecture checks, affected-file lint and the complete TypeScript/Vite/Nitro build pass. The generated manifest retains the two intended Workflow modules and 11 step-module records and contains no private validation directory.

An initial test worker ran out of local memory; sequential reruns with bounded heap completed successfully. The first build encountered the native module held open by the owned local backend. Its exact PID, process creation time, command line and loopback port were verified, and the already completed/paused trial state was checked before that one backend was stopped. User services and containers were untouched. Subsequent full builds passed. These engineering checks do not certify the failed Candidate, independent final acceptance or a real evolution effect.
