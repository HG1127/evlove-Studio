import { defineEventHandler } from "nitro/h3";
import { checkVercelSandboxBrowserHealth } from "@evolution/adapters/sandbox";

export default defineEventHandler(async()=>{
  return checkVercelSandboxBrowserHealth();
});
