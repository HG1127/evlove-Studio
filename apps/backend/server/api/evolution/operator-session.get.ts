import {defineEventHandler,setHeader} from "nitro/h3";
import {operatorSessionStatus} from "../../../src/services/operator-session";

export default defineEventHandler((event)=>{
  setHeader(event,"Cache-Control","no-store");
  return operatorSessionStatus(event);
});
