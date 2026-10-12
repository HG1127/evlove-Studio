// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readWorkflowRunMetadata} from "./workflow-run-metadata";

describe("metadata-only Workflow status",()=>{
  it("projects identity/status without reading user input or output",async()=>{
    const presence=vi.fn(async()=>true);
    const read=vi.fn(async()=>({runId:"run-1",status:"failed",get input(){throw new Error("INPUT_READ");},get output(){throw new Error("OUTPUT_READ");}}));
    expect(await readWorkflowRunMetadata("run-1",presence,read)).toEqual({exists:true,status:"failed"});
    expect(presence).toHaveBeenCalledWith("run-1");expect(read).toHaveBeenCalledOnce();
  });
  it("does not read missing Run metadata",async()=>{
    const read=vi.fn();expect(await readWorkflowRunMetadata("run-1",async()=>false,read)).toEqual({exists:false});
    expect(read).not.toHaveBeenCalled();
  });
  it.each([{runId:"foreign",status:"failed"},{runId:"run-1",status:"unknown"},{status:"failed"}])("rejects invalid identity or status %o",async(value)=>{
    await expect(readWorkflowRunMetadata("run-1",async()=>true,async()=>value)).rejects.toThrow();
  });
});
