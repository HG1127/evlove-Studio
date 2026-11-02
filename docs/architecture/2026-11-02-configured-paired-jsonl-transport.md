# Configure one paired transport for calibration and normal execution

JSONL generation and strict record validation were available only through an explicit diagnostic `AsyncLocalStorage` scope. A calibration performed in that scope would bind a different scoring-route fingerprint from a normal Mission's default JSON route. A diagnostic success therefore could not qualify the normal route.

The server-only `EVOLUTION_AI_PAIRED_TRANSPORT` setting now selects `json` or `jsonl-v1` for normal `evaluate-paired` operations. Empty/unset retains the existing JSON default. The existing route fingerprint already binds the line protocol and generation version; the configured JSONL route and an equivalent explicit diagnostic scope must have the same fingerprint. Invalid settings stop paired execution without echoing the value or falling back. No environment, provider, model, credential or deployment is changed by this source patch.

The setting affects paired judging only. Planning, building and single-arm evaluation keep their existing contracts. An explicit bounded diagnostic scope retains its stricter paired-only operation restriction and cannot regain a forbidden format correction through nesting. JSONL still requires an explicitly configured direct protocol, strict parsing and all existing three-slot/case/threshold checks. Malformed line output is not retried as JSON.

Tests exercise the normal paired composition route without a transport scope, the equality/difference of route identities, unrelated operation behavior, malformed output, invalid settings before provider I/O and a configuration change during a comparison. All provider responses are local fixtures; this is integration evidence, not real-model calibration or a new budget authorization.
