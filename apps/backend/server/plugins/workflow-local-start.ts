import {definePlugin} from "nitro";
import {getWorld} from "workflow/runtime";

/** Local queues need initialization after dev-server restart, including already queued runs. */
export default definePlugin(()=>{
  if(process.env.NODE_ENV==="production"||process.env.VERCEL
    ||(process.env.WORKFLOW_TARGET&&process.env.WORKFLOW_TARGET!=="local"))return;
  // Startup recovery may probe the listening server; do not block that server's initialization.
  const world=getWorld();
  void world.start?.().catch(error=>console.error("Local Workflow recovery failed",error));
});
