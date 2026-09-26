import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {z} from "zod";
import {listEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const LedgerPageQuerySchema=z.object({
  missionId:z.string().trim().min(1).max(200),
  limit:z.string().regex(/^[1-9]\d*$/).transform(Number)
    .refine(value=>Number.isSafeInteger(value)&&value<=2000).default(500),
  afterSequence:z.string().regex(/^(0|[1-9]\d*)$/).transform(Number)
    .refine(Number.isSafeInteger).default(0),
});

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=LedgerPageQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Evidence Ledger page query",data:parsed.error.flatten()});
  const {missionId,limit,afterSequence}=parsed.data;
  return {missionId,entries:await listEvidenceLedger(missionId,limit,afterSequence)};
});
