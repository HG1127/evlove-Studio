import {defineEventHandler,setHeader} from "nitro/h3";
import {OperatorSessionStatusSchema} from "@evolution/contracts";
import {
  assertOperatorSameOrigin,clearOperatorSessionCookie,operatorSessionConfigured,
} from "../../../src/services/operator-session";

export default defineEventHandler((event)=>{
  setHeader(event,"Cache-Control","no-store");
  assertOperatorSameOrigin(event);
  clearOperatorSessionCookie(event);
  return OperatorSessionStatusSchema.parse({configured:operatorSessionConfigured(),authenticated:false});
});
