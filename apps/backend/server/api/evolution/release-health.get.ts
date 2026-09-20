import { defineEventHandler } from "nitro/h3";
import { checkVercelReleaseHealth } from "../../../src/services/vercel-release";

export default defineEventHandler(async()=>{
  return checkVercelReleaseHealth();
});
