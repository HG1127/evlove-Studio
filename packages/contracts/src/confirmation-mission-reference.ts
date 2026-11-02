import {z} from "zod";

/** Opt-in for new full confirmation Missions; never reinterpret historical runs. */
export const ConfirmationMissionReferenceSchema=z.object({
  schemaVersion:z.literal("full-confirmation-mission-v1"),
  catalogSha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
