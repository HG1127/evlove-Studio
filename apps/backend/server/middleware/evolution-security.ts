import {defineEventHandler,getRequestURL} from "nitro/h3";
import {requireEvolutionPermission} from "../../src/services/security-policy";

function signedWebhook(path:string){
  return path.endsWith("/git-webhook")||path.includes("/connector-webhook/");
}

export default defineEventHandler((event)=>{
  const path=getRequestURL(event).pathname;
  if(!path.startsWith("/api/evolution"))return;
  if(signedWebhook(path))return;
  // Defense-in-depth only: every normal Evolution API requires at least an authenticated reader.
  // Route handlers enforce the stronger operation-specific permission (write/execute/approve/etc.).
  requireEvolutionPermission(event,"data.read");
});
