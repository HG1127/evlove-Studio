# Web App Migration Target

The production React/Vite UI currently remains at repository root to avoid a high-risk bulk move.

Rules:
- New UI remains presentation/control-plane only.
- Do not add Evolution Domain algorithms or durable execution into React components/hooks.
- Shared contracts must come from `@evolution/contracts`.
- Shared domain/harness logic must come from `@evolution/core` / `@evolution/harness`.
- Phase 5 of `PROJECT_RULES.md` moves the root Vite app into this directory after package extraction stabilizes.
