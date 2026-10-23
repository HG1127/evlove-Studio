/** Compatibility shim: Workflow and Artifact retries share the canonical occurrence replay policy. */
export {appendCanonicalOccurrenceEvent as appendWorkflowControlEvent} from "./event-replay";
