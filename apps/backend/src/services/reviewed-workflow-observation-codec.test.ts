// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {importKey} from "@workflow/core/encryption";
import {dehydrateStepArguments,dehydrateStepReturnValue} from "@workflow/core/serialization";
import {decodeReviewedWorkflowIo,REVIEWED_KEY_WAIT_MS,REVIEWED_OBSERVATION_BYTES} from "./reviewed-workflow-observation-codec";
const payload={literal:'Synthetic "quote" \\ newline\nnext',note:"private synthetic payload"},output={result:{status:"waiting-human",iterations:1}};
const bytes=new Uint8Array(32).fill(9);
async function frame(encrypted=true){const key=encrypted?await importKey(bytes):undefined;return{input:await dehydrateStepArguments([payload],"synthetic-run",key),output:await dehydrateStepReturnValue(output,"synthetic-run",key)};}
afterEach(()=>vi.useRealTimers());
describe("official Workflow encrypted observation codec",()=>{
 it("decodes SDK-produced encrypted input/output with one private key lookup and no key export",async()=>{const step=await frame(),resolve=vi.fn(async()=>bytes),before=bytes.slice();expect(await decodeReviewedWorkflowIo(step,resolve)).toEqual({input:[payload],output});expect(resolve).toHaveBeenCalledOnce();expect(bytes).toEqual(before);});
 it("does not request a key for SDK plaintext serialization",async()=>{const resolve=vi.fn(async()=>undefined);expect(await decodeReviewedWorkflowIo(await frame(false),resolve)).toEqual({input:[payload],output});expect(resolve).not.toHaveBeenCalled();});
 it.each([undefined,new Uint8Array(31),new Uint8Array(33),new Uint8Array(32).fill(8)])("fails closed for missing, malformed or wrong key %#",async value=>{const error=await decodeReviewedWorkflowIo(await frame(),async()=>value).catch(e=>e);expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain("private synthetic");expect(error).not.toHaveProperty("cause");});
 it("does not publish or fall back after authenticated-ciphertext corruption",async()=>{const step=await frame();const changed=(step.input as Uint8Array).slice();changed[changed.length-1]^=1;await expect(decodeReviewedWorkflowIo({...step,input:changed},async()=>bytes)).rejects.toThrow("无法核验");});
 it("sanitizes a key-provider error without retaining a cause or private content",async()=>{const error=await decodeReviewedWorkflowIo(await frame(),async()=>{throw new Error("private-key-provider-response");}).catch(e=>e);expect(error.message).not.toContain("private-key");expect(error).not.toHaveProperty("cause");});
 it("bounds encoded observations before asking for a key",async()=>{const resolve=vi.fn(async()=>bytes),large=new Uint8Array(REVIEWED_OBSERVATION_BYTES+1);large.set(new TextEncoder().encode("encr"));await expect(decodeReviewedWorkflowIo({input:large},resolve)).rejects.toThrow();expect(resolve).not.toHaveBeenCalled();});
 it("bounds an unavailable key provider without starting any replacement request",async()=>{const step=await frame();vi.useFakeTimers();const resolve=vi.fn(()=>new Promise<Uint8Array>(()=>{}));const pending=decodeReviewedWorkflowIo(step,resolve);const check=expect(pending).rejects.toThrow("无法核验");await vi.advanceTimersByTimeAsync(REVIEWED_KEY_WAIT_MS);await check;expect(resolve).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);});
});
