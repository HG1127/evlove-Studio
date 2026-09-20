import { defineEventHandler } from "nitro/h3";
import { getVercelReleaseCapabilities } from "../../../src/services/vercel-release";

export default defineEventHandler(async()=>{
  return getVercelReleaseCapabilities();
});
