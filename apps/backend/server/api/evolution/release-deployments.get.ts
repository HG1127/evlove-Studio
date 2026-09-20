import { defineEventHandler } from "nitro/h3";
import { listVercelReleaseDeployments } from "../../../src/services/vercel-release";

export default defineEventHandler(async()=>{
  return listVercelReleaseDeployments();
});
