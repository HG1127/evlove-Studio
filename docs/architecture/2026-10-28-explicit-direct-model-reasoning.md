# Explicit reasoning effort for direct model routes

Date: 2026-10-28

Status: accepted configuration mechanism; actual efficiency and acceptance improvement unproved.

## Measured cause

C28's initial Baseline review made five real requests under the existing default MiniMax-M3.1-Flash route. The first three completion observations are `length`; two later criterion-group replies are `stop`. Together they report 36,371 output tokens including 34,123 reasoning tokens. The existing fallback eventually settled the full Baseline, but the original full reviews did not finish within the 8,192-token evaluation limit. Incomplete replies were not accepted or converted into scores.

[MiniMax's official compatible-API documentation](https://platform.minimax.cn/docs/api-reference/text-openai-api) states that Flash defaults to maximum effort, supports `low`, `medium`, `high`, `xhigh` and `max`, and counts thinking toward the generation limit. This supports an inference that the default reasoning budget competes with final structured output. It does not prove that selecting medium will retain quality or complete a real evolution loop.

## Decision

The application composition accepts optional server-only `EVOLUTION_AI_REASONING_EFFORT` for direct compatible providers. Zod validates the explicit value before dispatch. Both environment-only routes and saved Vault connections honor it. Chat Completions uses `reasoning_effort`; Responses uses `reasoning.effort`. An unconfigured value sends no new field and preserves legacy routing bytes. Gateway rejects this direct-only option rather than silently using another setting. Provider-specific supported values remain the provider's responsibility; there is no automatic parameter fallback.

The resolved direct configuration is pinned for an operation. Explicit effort participates in the scoring fingerprint and usage-route identity; changing it invalidates prior scoring identity even when model/provider names remain the same. Credentials and timeout remain excluded from scoring identity. No key, reasoning text or task evidence is added to telemetry.

This adds no provider, SDK, database migration, UI flow or architecture exception. Contracts/Core/Harness remain independent of concrete configuration and transport. It does not change output caps, acceptance thresholds, the single format correction, bounded criterion sharding, candidate/repair allowance, deadline or evidence requirements.

## Verification and limits

Local tests cover both protocols, immutable configuration within an operation, effort-specific scoring/usage identity, default-route compatibility, environment/Vault resolution, invalid values and unsupported Gateway routes. All provider replies in these tests are synthetic. The initial failing tests and a corrected visual-result fixture remain retained; runtime schemas were not weakened.

During C28 the live backend remained the preregistered `3025eea` production build with effort unset. Source edits were tested in separate local processes without replacing that build or changing its environment. Exact replay of actual planning request SHA-256 `810cd27ef57bd7c5dea36e04d955802f40aface8cb8e77ea1878d530c8d2faf7` still matches after adding the unset optional configuration. This is compatibility evidence, not a real configured-medium result or causal use of memory.

A subsequent separately registered trial must hold one explicit effort fixed across paired judgments, use a fresh Baseline and preserve all original 8/6/9 and final acceptance requirements. Actual business benefit and causal unseen-task transfer require their independent observations; faster local tests cannot satisfy them.

Final verification passes 207 related tests across 15 files, all 11 Runner tests, architecture/changed-file lint and the full TypeScript/production build. These checks establish configuration/identity compatibility, not a real configured-medium generation, faster trial or accepted SOP.
