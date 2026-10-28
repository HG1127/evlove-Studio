// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const provider=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("@vercel/sandbox",()=>({Sandbox:{create:provider.create},Snapshot:{get:vi.fn()},APIError:class extends Error{}}));
import {checkVercelSandboxHealth} from "./vercel-sandbox-adapter";
const previous={...process.env};
function untilAborted(signal?:AbortSignal){return new Promise<never>((_resolve,reject)=>{
  if(signal?.aborted)reject(signal.reason);else signal?.addEventListener("abort",()=>reject(signal.reason),{once:true});
});}
beforeEach(()=>{
  vi.useFakeTimers();provider.create.mockReset();
  Object.assign(process.env,{EVOLUTION_SANDBOX_AUTH_MODE:"access-token",VERCEL_TOKEN:"test-not-real",VERCEL_TEAM_ID:"team_test",VERCEL_PROJECT_ID:"prj_test"});
  vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException("health timeout","TimeoutError")),ms);return c.signal;});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();process.env={...previous};});
describe("bounded basic Sandbox readiness",()=>{
  it("does not dispatch commands if a provider returns an allocation after its deadline",async()=>{
    const runCommand=vi.fn(),stop=vi.fn(async()=>undefined);
    provider.create.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({region:"iad1",runCommand,stop}),31_000)));
    const work=checkVercelSandboxHealth();await vi.advanceTimersByTimeAsync(45_000);
    expect((await work).ready).toBe(false);expect(runCommand).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledOnce();
  });
  it.each(["allocation","command","output","cleanup"] as const)("bounds an unresponsive %s without inventing readiness",async phase=>{
    let probeSignal:AbortSignal|undefined,cleanupSignal:AbortSignal|undefined;
    const stop=vi.fn(async(opts?:{signal?:AbortSignal})=>{cleanupSignal=opts?.signal;if(phase==="cleanup")await untilAborted(opts?.signal);});
    const command={exitCode:0,stdout:vi.fn(async(opts?:{signal?:AbortSignal})=>{if(phase==="output")return untilAborted(opts?.signal);return "v22.0.0\n";})};
    const runCommand=vi.fn(async(_cmd:string,_args:string[],opts?:{signal?:AbortSignal})=>{if(phase==="command")await untilAborted(opts?.signal);return command;});
    provider.create.mockImplementation(async(opts:{signal?:AbortSignal})=>{probeSignal=opts.signal;if(phase==="allocation")await untilAborted(opts.signal);return {region:"iad1",runCommand,stop};});
    let settled=false;
    const work=checkVercelSandboxHealth().then(result=>{settled=true;return result;});
    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).toBe(true);
    const result=await work;
    expect(result.ready).toBe(phase==="cleanup");
    if(phase!=="cleanup")expect(result.message).toContain("SANDBOX_HEALTH_TIMEOUT");
    expect(probeSignal).toBeInstanceOf(AbortSignal);
    if(phase==="allocation")expect(stop).not.toHaveBeenCalled();
    else{expect(stop).toHaveBeenCalledOnce();expect(cleanupSignal).toBeInstanceOf(AbortSignal);expect(cleanupSignal).not.toBe(probeSignal);}
    if(phase==="command")expect(command.stdout).not.toHaveBeenCalled();
  });
});
