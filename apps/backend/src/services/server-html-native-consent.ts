import {z} from "zod";

const missions=z.string().max(12_000).transform(value=>value.split(",").map(id=>id.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/)).max(50));

/** Operator opt-in for complete HTML transport to an ephemeral, network-denied Sandbox. */
export function serverHtmlNativeAuthorized(missionId:string){
  const parsed=missions.safeParse(process.env.EVOLUTION_HTML_NATIVE_MISSIONS??"");
  return parsed.success&&parsed.data.includes(missionId);
}
