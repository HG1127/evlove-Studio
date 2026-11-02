# Local native incomplete-execution diagnostics

The local HTML adapter deliberately returns unavailable when execution or result validation is incomplete. A real local document measurement reached the execution boundary but produced no settled result; the generic unavailable response could not distinguish a deadline, browser launch, observer, protocol or cleanup failure. It must remain unverified, and elapsed wall time alone cannot establish its cause.

The local runner now reports a fixed failure kind, run ID, last phase, subject arm, completed-check count and monotonic elapsed time. An optional trusted local progress sink receives the same limited fields. The observer reports progress at document entry and after recorded assertions. No document text, selectors, URLs, clipboard values, private exception messages or causes enter the diagnostic. Node retains the private cause on the thrown error for local debugging only; the adapter accepts the diagnostic through a strict Zod boundary and discards malformed metadata.

This adds optional metadata to unavailable responses. It does not turn partial progress into an observation or alter any assertion, deadline, browser isolation, cleanup requirement, source identity, retry policy or acceptance threshold. Previous incomplete runs remain incomplete; a new implementation fingerprint cannot retroactively diagnose or qualify them. The VM assertion body remains unchanged.

Validation covers deadline and observer failure metadata, denied extra fields, closure of owned browsers, adapter redaction, legacy responses and native-kernel assertion parity. A separate trusted local browser fault probe verifies the metadata with a real isolated browser; it is not an SOP Candidate, calibration observation or business sample.
