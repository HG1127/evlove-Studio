# Safe provider failure diagnostics

Status: implemented prospectively; no historical attribution is rewritten.

The direct provider boundary collapsed native connect/header/body timeouts and an aborted request signal into `provider-timeout`. The gateway then discarded the cause. A terminal code and elapsed time cannot establish which timer fired. Two local long-wait experiments also failed to establish their expected control contrast; their failed outcomes remain unchanged.

Usage observation V3 adds an optional, strict, finite diagnostic DTO. V1 and V2 retain their original shapes and remain readable. The DTO contains the request/body/SDK phase, recognized codes, configured duration and positively identified source. It contains no message, stack, URL, request or response content, headers, keys or raw cause. A signal must be the exact object in the observed error chain; an already aborted signal or a similar error name is insufficient. Conflicting source evidence stays unknown. SDK-internal timer ownership stays unknown without direct evidence.

Adapters classify external errors; the backend supplies its actual signal identities and persists the versioned observation. Contracts remain infrastructure independent. This does not change prompts, scoring fingerprints, output parsing, token counters, billing status, retry eligibility, request deadlines, execution windows or promotion gates. A recorded diagnostic never proves whether an unknown POST was processed and never authorizes its replay.

The direct gateway preserves the already observed phase and signal attribution through an invocation-local `AsyncLocalStorage`/`WeakMap`. It does not mutate provider errors or trust a provider-supplied diagnostic property. Concurrent invocations cannot contaminate each other's observations even if a provider reuses an Error object. Two distinct matched signal reasons or conflicting native timeout codes remain unknown, including at the persisted contract boundary.

Validation covers nested timeout codes, HTTP200 with interrupted body, exact signal identity, unrelated expired signals, competing causes, execution cancellation, SDK uncertainty, bounded cyclic/throwing causes, legacy records and rejection of unrestricted fields. No real provider calls or production writes are required.
