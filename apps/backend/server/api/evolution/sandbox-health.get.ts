import { defineEventHandler } from "nitro/h3";
import { checkVercelSandboxHealth } from "@evolution/adapters/sandbox";

export default defineEventHandler(async()=>{
  return checkVercelSandboxHealth();
});
