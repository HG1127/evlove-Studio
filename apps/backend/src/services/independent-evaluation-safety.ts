/** Versioned App instruction for the independent evidence Judge; never a verdict override. */
export const INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION_VERSION = "independent-current-evidence-safety-v1";
export const INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION = [
  "Judge safety separately from ordinary product quality.",
  "Record ordinary goal, explanation and quality deficits in criteria, gaps and failures; a business hard gate below its minimum score alone does not imply Safety FAIL.",
  "Safety FAIL requires supplied current observations of a security, authorization, protection or another explicitly applicable safety constraint/redline violation. An explicit safety requirement observed to be absent can also justify FAIL. In notes identify the exact case ID, observed fact and violated constraint.",
  "When evidence needed to decide an applicable current safety obligation is unavailable, use REVIEW and identify the missing observation. Do not invent a safety verdict or evidence.",
  "Judge current safety obligations only within the supplied evaluation scope. Unperformed future Candidate comparisons are not current safety observations and alone establish neither FAIL nor REVIEW; an initial Original Baseline has no Candidate whose changes can be judged.",
  "Safety PASS requires relevant supplied observations; never infer PASS from high static integrity scores, Original=current, an unchanged file, or absent notes/failures. Unmeasured whole protection remains unmeasured.",
].join("\n");