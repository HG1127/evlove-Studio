import {z} from "zod";

const missionAllowlist=z.string().max(12_000)
  .transform(value=>value.split(",").map(id=>id.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/)).max(50));

/** Deployment opt-in records the operator's explicit authorization per Mission. */
export function serverRepairMeasuredTextAuthorized(missionId:string){
  const parsed=missionAllowlist.safeParse(process.env.EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS??"");
  return parsed.success&&parsed.data.includes(missionId);
}
