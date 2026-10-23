import {z} from "zod";

const Timestamp=z.string().datetime({offset:true});

/** Normalize database time at the storage boundary; retain PostgreSQL's submillisecond precision. */
export function supabaseTimestampToIso(raw:unknown):string{
  const value=Timestamp.parse(raw);
  const utc=new Date(value).toISOString();
  const fraction=/\.(\d{4,})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
  return fraction?utc.replace(/\.\d{3}Z$/,"."+fraction+"Z"):utc;
}
