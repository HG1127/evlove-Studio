import {assertBodySize,defineEventHandler,getMethod,getRequestURL} from "nitro/h3";
import {requireEvolutionPermission} from "../../src/services/security-policy";

const MAX_EVOLUTION_REQUEST_BYTES=32*1024*1024;

function signedWebhook(path:string){
  return path==="/api/evolution/git-webhook"
    ||/^\/api\/evolution\/connector-webhook\/[^/]+$/.test(path);
}

export default defineEventHandler((event)=>{
  const path=getRequestURL(event).pathname;
  if(!path.startsWith("/api/evolution"))return;
  if(["POST","PUT","PATCH","DELETE"].includes(getMethod(event))){
    assertBodySize(event,MAX_EVOLUTION_REQUEST_BYTES);
  }
  if(path==="/api/evolution/public-readiness"
    ||path==="/api/evolution/build-info"
    ||path==="/api/evolution/jobs/reconcile-scheduled"
    ||path==="/api/evolution/data-plane-health-scheduled"
    ||signedWebhook(path))return;
  // Defense-in-depth only: every normal Evolution API requires at least an authenticated reader.
  // Route handlers enforce the stronger operation-specific permission (write/execute/approve/etc.).
  requireEvolutionPermission(event,"data.read");
});
