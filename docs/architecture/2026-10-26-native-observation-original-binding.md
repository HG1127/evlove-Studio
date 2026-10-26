# Bind native observations to the locked physical Original

Owner: Evolution OS maintainers. Date: 2026-10-26. This strengthens the existing evidence contract within the current architecture; no stack exception is introduced.

## Observed defect

Candidate native execution checked the Candidate hash but did not compare the observation's Original hash against the Mission's locked Baseline reference. Current-version same-paper execution checked that an observation compared a file with itself, but did not bind that file to the locked Original. A complete observation for another Original could therefore be adopted as verified evidence. A frozen receipt whose source ID contradicted its Snapshot was also accepted when its hash matched.

Eight added regression cases failed before the repair. These were synthetic counterexamples of the actual execution functions, not real browser observations or evidence of user benefit. The native production execution entry remains unwired, so this finding does not establish that the real pilot obtained a false formal pass.

## Decision

Harness validates the unique `original-artifact-reference-v1` receipt and requires its Mission ID, source ID and physical Original SHA-256 to match the native observation. Candidate execution additionally requires the unique frozen Snapshot receipt's source ID and subject SHA-256 to match. Invalid or missing bindings stay `unverified`; they cannot fall through to a semantic execution that would conceal the identity failure.

Initial Baseline execution still gathers fresh physical references before locking them. Current-version same-paper execution and Candidate execution use the already locked references. The two subjects may have different hashes: a real mutation must remain comparable with its unchanged Original.

Baseline reuse, Experiment recovery and Hidden recovery recheck native receipt completeness and both physical bindings. Matching measurement/checkpoint digests do not establish those bindings. No global fingerprint is changed, no historical record is rewritten, and runs without native proofs retain their existing recovery behavior. A rejected native binding does not become a product failure or an accepted Candidate.

## Verification and limits

Later on the same date, separate explicit human authorization allowed the [native production composition](2026-10-26-native-html-production-execution.md) and its actual cloud verification. References below to an unwired entry describe the earlier binding audit; no old pilot verdict or exhausted budget was changed.

The 201 tests across eight affected test files cover missing, duplicate, cross-Mission, cross-source, malformed and stale Original references; contradictory frozen source IDs; valid changed Candidates; and digest-consistent but incorrectly bound Baseline/Experiment/Hidden caches. All 11 Runner tests, architecture checks, changed-file lint and the production TypeScript/Vite build pass.

A read-only diagnostic at `2026-10-26T02:07:58.853Z` downloaded the approved supplemental Artifact `local-native-proof-7abc609c2c604b4c5a317b8e`, verified its registered hash and bindings, and checked the actual selected Candidate against the actual locked Original. The frozen `0de13e…` observation is complete but retains nine failures. The unregistered `b304af…` preview is rejected for that Candidate. A deliberately altered Original hash is rejected as a synthetic counterexample. No new browser execution, AI request, body upload, remote write or formal verdict was created; the supplemental report's authority remains unchanged.

This closes an evidence identity gap. It does not supply the missing native production composition, increase the exhausted repair budget, execute the reserved final paper, approve Gate F, deliver a file, establish business improvement or prove lesson transfer. See [the real evolution acceptance record](../real-evolution-acceptance.md).
