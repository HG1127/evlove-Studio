# Compact manifest-local source selectors

Status: prospective opt-in repair; qualification and full C42 acceptance remain pending.

The first long-ID source-fragment trial received HTTP 200 with finish=stop, but a summary omitted one hex digit from its first selection ID. Strict JSONL parsing rejected that response before any independent judgment qualified. The failed response, source and bounded window remain immutable; no prefix matching, repair or inferred selection is permitted.

`manifest-local-source-fragments-v2` uses exact aliases `d0s0`, `d0s1`, etc. Document order is the same canonical source-identity order, and span order is its complete measured-body range order. An alias is meaningful only within the issued manifest: it is not a global or cryptographic identifier by itself. Full manifest SHA256 still binds policy, logical source ID, Artifact SHA, measured UTF-8 body SHA, every UTF-16 range and exact text. The input fingerprint/frozen wire, raw-order journal and rendering receipt bind that full digest. The runtime reconstructs the entire manifest before resolving an alias; source ownership, literal absence, explicit markers and the original semantic/Safety gates remain unchanged.

A distinct `paired-evaluation-jsonl-compact-selection-v2` header and scoring-route instruction hash bind this opt-in protocol. The existing versioned input has an explicitly versioned manifest policy; its additive schema supports both policies. Raw selection records remain versioned DTOs with a manifest binding. Legacy long-ID JSONL grammar, instruction bytes, generation wire and reconstruction remain available under v1. New aliases never reinterpret an old stored result; a different manifest or route cannot replay as an accepted order. No rubric, expected label, score, budget, private paper or previously observed result changes.

This is a usability repair at the model boundary, not evidence that a short ID or a supported quotation proves the model's inference. A fresh bounded fixed-bank calibration is required before the same SOP can advance to its original acceptance gates.
