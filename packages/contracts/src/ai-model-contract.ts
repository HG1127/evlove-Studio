import {z} from "zod";

/** Provider model IDs are opaque user selections, not names inferred from their length. */
export const AiModelIdSchema=z.string().trim().min(1).max(200);
