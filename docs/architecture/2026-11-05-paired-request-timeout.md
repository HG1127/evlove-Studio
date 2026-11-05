# Paired judging request lifetime

Status: accepted for explicit local configuration; production configuration unchanged.

A measured paired MiniMax request hit the legacy 300,000 ms clamp while the enclosing diagnostic still had ten minutes remaining. Its sent POST has an unknown outcome. That historical outcome stays unknown and is not retried by this change.

`EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS` explicitly selects 10,000–900,000 integer milliseconds for each `evaluate-paired` physical request, before choosing SDK, Responses, or Chat transport. Blank retains the existing configured/default timeout and its legacy clamp. Other operations ignore this setting. Invalid paired settings fail before provider I/O.

When this new paired setting is explicit, SDK `maxRetries: 0` prevents opaque SDK retries from silently consuming additional attempts after a sent call. Direct HTTP network recovery then requires positive pre-send failure evidence (`getaddrinfo` with ENOTFOUND/EAI_AGAIN or `connect` with ECONNREFUSED); a reset, socket error or unqualified fetch failure stays unknown without another send. Explicit capacity recovery and definitely unsent failures share the existing single reconnect allowance. A bounded caller also enforces its whole-window allowance. The adapter receives a typed, Zod-validated policy from the app; it does not read application environment configuration. Unset configurations retain legacy retry behavior, which is not asserted to be single-attempt or unknown-safe.

This is a resource setting, excluded from scoring identity: model, instructions, payload, output schema and token budget are unchanged. Execution evidence must separately bind the effective request timeout and source. Existing control Job cancellation remains composed with each transport's timeout; a bounded local controller must still enforce its original absolute deadline. A longer request timeout cannot authorize extra attempts, renew an expired window, retry an unknown POST, repair malformed output, or qualify an incomplete assessment.

No domain, Harness, evidence, acceptance, identity or storage contract changes. Verification covers delayed synthetic responses beyond the observed five-minute ceiling, legacy timeout, all three transports, pre-I/O validation, scoring identity stability and earlier control cancellation. No real provider result is inferred from these engineering checks.
