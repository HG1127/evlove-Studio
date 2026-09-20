# Evolution OS Agent Instructions

Before modifying this repository, read and follow `PROJECT_RULES.md`.

`PROJECT_RULES.md` is the mandatory architecture and technology-stack baseline. In particular:

- respect `contracts → core → harness → adapters/apps` dependency direction;
- keep Domain logic out of React/UI and infrastructure adapters;
- keep Harness independent of React/Supabase/Vercel concrete implementations;
- use `@evolution/*` public package imports rather than cross-package deep relative imports;
- validate external/storage/AI boundaries with Zod;
- preserve evidence/artifact identity and the 23-node Evolution closed-loop invariants;
- migrate legacy root/runtime code incrementally with compatibility shims rather than bulk rewrites;
- run `pnpm architecture:check`, build, and relevant tests after architecture changes.

Any intentional exception requires an ADR under `docs/architecture/`.
