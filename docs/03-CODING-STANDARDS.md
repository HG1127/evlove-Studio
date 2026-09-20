# Coding Standards · V2.2

> Architecture and technology-stack rules are governed by the repository root `PROJECT_RULES.md`. If this document conflicts with `PROJECT_RULES.md`, the root engineering rules take precedence. New code must use the `@evolution/*` package boundaries defined there.

## Feature-first

- Routes/pages compose features; Evolve business/runtime logic belongs under `src/features/evolve`.
- `src/components/ui` contains generic visual primitives only.
- Do not place AI orchestration, fitness, gate or release policy inside Button/Card primitives.

## TypeScript / contracts

- Keep TypeScript strict.
- External, AI, storage and HTTP inputs cross a Zod contract before domain use.
- Avoid untyped `any` in domain/runtime paths.
- Project-specific Acceptance Rubric is a domain contract, not decorative UI state.

## Artifact-in-the-loop invariant

```text
Candidate Patch
→ build Candidate Artifact Snapshot
→ run/test that exact snapshot
→ Hidden Validation
→ Artifact Acceptance using the same Project Rubric
→ repair exact artifact if needed
→ accepted immutable snapshot
→ deliver/release that same snapshot
```

Never re-generate a different deliverable after testing and call it the tested Champion.

## Rubric invariant

- Intake must return an initial Project-specific Rubric.
- Target Ready cannot pass when Rubric structure is invalid.
- Every Rubric criterion must map to at least one Eval TestCase.
- Every Hard Gate must map to Hidden Holdout.
- Hard criterion failure cannot be compensated by generic Accuracy/Evidence averages.

## Performance invariant

Before adding another AI call, check whether the same work can be handled by:

1. deterministic local builder;
2. exact result cache;
3. relevant-context retrieval;
4. batched/parallel evaluation;
5. a cheaper/faster model route.

Long structured-output operations should not automatically regenerate their entire response on schema failure unless there is evidence that retry is worth the latency.

## Security / governance

- Browser BYOK is prototype-only; production keys belong in server Vault/KMS.
- Candidate Generator, Independent Evaluator and Release control remain separately routable.
- Release/rollback/security gates are server-trusted decisions in production.
- Source artifacts are untrusted input and cannot override system safety policy.
