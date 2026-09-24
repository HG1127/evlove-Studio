import {describe,expect,it} from "vitest";
import {EvolutionWorkflowStatusQuerySchema,EvolutionWorkflowStatusResponseSchema} from "./workflow-contract";

describe("durable Workflow status contract",()=>{
  it("requires a bounded run or Job identity",()=>{
    expect(EvolutionWorkflowStatusQuerySchema.safeParse({runId:" run-1 "}).data)
      .toEqual({runId:"run-1"});
    expect(EvolutionWorkflowStatusQuerySchema.safeParse({}).success).toBe(false);
    expect(EvolutionWorkflowStatusQuerySchema.safeParse({jobId:" "}).success).toBe(false);
    expect(EvolutionWorkflowStatusQuerySchema.safeParse({runId:["run-1"]}).success).toBe(false);
  });

  it("validates workflow status and Event collections at the HTTP boundary",()=>{
    expect(EvolutionWorkflowStatusResponseSchema.parse({workflow:{exists:true,status:"running"},events:[]}))
      .toEqual({workflow:{exists:true,status:"running"},events:[]});
    expect(EvolutionWorkflowStatusResponseSchema.safeParse({workflow:{exists:true,status:42},events:[]}).success)
      .toBe(false);
    expect(EvolutionWorkflowStatusResponseSchema.safeParse({events:{}}).success).toBe(false);
  });
});
