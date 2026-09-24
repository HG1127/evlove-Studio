// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ProductionRuntimePorts} from "@evolution/contracts";

const appendEvidence=vi.hoisted(()=>vi.fn());
vi.mock("./evidence-ledger",()=>({appendEvidenceLedger:appendEvidence}));
import {CheckpointBindingError,evaluateCheckpointValidation} from "./validation-gate";

function runtime(checkpointId="checkpoint-1"){
  return {
    missions:{get:vi.fn(async()=>({campaign:{checkpoint:{id:checkpointId}}}))},
    events:{append:vi.fn(async()=>undefined)},
  } as unknown as ProductionRuntimePorts;
}

const input={missionId:"mission-1",checkpointId:"checkpoint-1",artifactId:"artifact-1",
  artifactSha256:"a".repeat(64),validationId:"validation-1",status:"passed" as const};

describe("checkpoint validation gate",()=>{
  beforeEach(()=>{appendEvidence.mockReset();appendEvidence.mockResolvedValue({id:"evidence-1"});});

  it("accepts only the current persisted checkpoint",async()=>{
    const ports=runtime();
    await expect(evaluateCheckpointValidation(ports,input)).resolves.toMatchObject({accepted:true});
    expect(ports.events.append).toHaveBeenCalledOnce();
    expect(appendEvidence).toHaveBeenCalledOnce();
  });

  it("rejects a validation bound to another checkpoint before writing evidence",async()=>{
    const ports=runtime("checkpoint-new");
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointBindingError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("does not accept a passed claim without the exact Artifact hash",async()=>{
    const result=await evaluateCheckpointValidation(runtime(),{...input,artifactSha256:""});
    expect(result.accepted).toBe(false);
  });
});
