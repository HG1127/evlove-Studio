import { z } from "zod";

const SupabaseTimestampSchema = z.string().datetime({ offset: true });

/** Convert database offsets to the UTC contract without discarding submillisecond digits. */
export function normalizeSupabaseTimestamp(input: unknown): string {
  const value = SupabaseTimestampSchema.parse(input);
  if (value.endsWith("Z")) return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid Supabase timestamp");
  const fraction = /(\.\d+)(?:[+-]\d{2}:?\d{2})$/.exec(value)?.[1] ?? "";
  return instant.toISOString().replace(/\.\d{3}Z$/, `${fraction}Z`);
}
