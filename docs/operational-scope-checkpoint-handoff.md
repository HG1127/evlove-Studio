# Dedicated operational scope checkpoint binding

## Observed failure

The approved unique fresh Mission `project-main-flow-sop-fields-7ba9c02b-0ffc-48bc-b109-101592ae0d14` reached normal human Target Ready at revision2 on production `0e813bf911f879b5ea7822b4bf8713bf84ebc6f5`. The dedicated protection preview read the physical Original and returned target-contract SHA-256 `f9991bf30e86871ee6286c51ef425bd50c3701c27b21b7ec6639ce028ffe0adf`. Confirmation returned HTTP409 (upstream data-plane request rejection). Readback still showed revision2, no operational scope, idle Baseline and no control owner. The older Mission stayed revision50.

## Source defect and repair

The route passed an `ActionCompleted` event to `compare_and_swap_mission_with_event`. The existing migration `20260924100000_job_lifecycle_security_invariants.sql` requires `CheckpointCreated` and `checkpointId === id` before changing the Mission or inserting an event. The regression reads these checked-in SQL guards and applies them to the route event; the unfixed route reproduces the checkpoint-binding rejection. This is a source-level contract reproduction; the live database function definition has not been read.

The route now creates the matching checkpoint event with deterministic `operational-scope:<mission>:<expected revision>` identity. The action, original identity, target-contract hash, reviewed actor, finite policy and universalProtectionProved=false payload remain unchanged. The same atomic RPC and revision CAS remain mandatory. No database migration or guard relaxation is introduced.

## Verification and continuation

The first red regression (10 passed / 1 failed) is retained in `D:/Downloads/evolution-os-smoke-temp/scope-confirmation-checkpoint-fix-20261019/red-regression.log`. Focused tests, architecture check, full lint and production build results, exact commit and artifact hashes are recorded in that directory's development handoff. Full Quality Gate belongs to the CI owner; Git integration and any production publication belong to the authorized delivery owner.

After exact-version CI and approved delivery, recheck production identity and the same existing Mission. Preview and confirm its unchanged contract using the dedicated human API before the first normal fixed-key Workflow. Do not create another Mission, repair a Job or rewrite old results. Continue the actual Baseline/diagnosis/changed frozen Candidate/Experiment/same-Hidden pair/Gate F/exact accepted download and reopen, preserving every failure and unknown. No stage after Target Ready is accepted by development tests.
