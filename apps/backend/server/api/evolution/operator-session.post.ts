import {assertBodySize,createError,defineEventHandler,readBody,setHeader} from "nitro/h3";
import {z} from "zod";
import {OperatorSessionStatusSchema} from "@evolution/contracts";
import {
  assertOperatorSameOrigin,createOperatorSession,operatorSessionConfigured,setOperatorSessionCookie,
} from "../../../src/services/operator-session";

const LoginSchema=z.object({accessKey:z.string().min(1).max(256)}).strict();

export default defineEventHandler(async(event)=>{
  setHeader(event,"Cache-Control","no-store");
  assertOperatorSameOrigin(event);
  if(!operatorSessionConfigured())throw createError({statusCode:503,statusMessage:"Operator browser access is not configured"});
  assertBodySize(event,4096);
  const input=LoginSchema.safeParse(await readBody(event));
  if(!input.success)throw createError({statusCode:400,statusMessage:"Invalid operator access request"});
  const session=createOperatorSession(input.data.accessKey);
  if(!session)throw createError({statusCode:401,statusMessage:"Invalid operator access key"});
  setOperatorSessionCookie(event,session.token);
  return OperatorSessionStatusSchema.parse({configured:true,authenticated:true,expiresAt:session.expiresAt});
});
