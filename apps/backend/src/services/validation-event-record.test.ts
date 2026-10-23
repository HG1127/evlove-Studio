// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type ValidationResult} from "@evolution/contracts";
import {eventRow} from "./event-persistence";
import {parsePersistedValidationEvent,readServerValidationRecord} from "./validation-event-record";

const result:ValidationResult={
  id:"validation:one",schemaVersion:"validation-v1",missionId:"mission-1",
  jobId:"job-1",checkpointId:"checkpoint-1",artifactId:"artifact-1",
  artifactSha256:"a".repeat(64),requestFingerprint:"b".repeat(64),
  status:"passed",checks:[],reason:"All requested checks passed",createdAt:"2026-09-25T00:00:00.000Z",
};
const event=createEvolutionEvent({
  id:"validation-result:"+result.id,missionId:result.missionId,jobId:result.jobId,
  checkpointId:result.checkpointId,type:"ValidationPassed",source:"backend-validation-runtime",
  payload:{validationId:result.id,validation:result},at:result.createdAt,
});

describe("persisted Validation Event identity",()=>{
  it("loads a validation by exact Event ID and binding",async()=>{
    const request=vi.fn(async(path:string)=>{expect(path).toContain("events?");return [eventRow(event)];});
    expect(await readServerValidationRecord(request,result.id)).toEqual({event,result});
    const query=new URL("https://example.supabase.co/rest/v1/"+request.mock.calls[0][0]).searchParams;
    expect(query.get("id")).toBe('eq.validation-result:validation:one');
    expect(query.get("limit")).toBe("1");
  });

  it("returns undefined when the exact Event does not exist",async()=>{
    expect(await readServerValidationRecord(async()=>[],result.id)).toBeUndefined();
  });

  it("skips unrelated Events but rejects a Validation Event with a different ID shape",()=>{
    const unrelated=createEvolutionEvent({
      id:"job-created:one",missionId:"mission-1",type:"JobQueued",source:"backend-job-lifecycle",payload:{},
    });
    expect(parsePersistedValidationEvent(unrelated)).toBeUndefined();
    expect(()=>parsePersistedValidationEvent({...event,id:"another-prefix:"+result.id})).toThrow("ID is invalid");
  });

  it.each([
    ["type",{type:"ValidationFailed"}],
    ["source",{source:"another-runtime"}],
    ["mission",{mission_id:"another-mission"}],
    ["job",{job_id:"another-job"}],
    ["checkpoint",{checkpoint_id:"another-checkpoint"}],
    ["validation ID",{payload:{validationId:"another-id",validation:result}}],
  ])("rejects a mismatched %s binding",async(_name,change)=>{
    await expect(readServerValidationRecord(async()=>[{...eventRow(event),...change}],result.id))
      .rejects.toThrow("binding is invalid");
  });

  it("rejects a malformed persisted validation result",async()=>{
    await expect(readServerValidationRecord(async()=>[{
      ...eventRow(event),payload:{validationId:result.id,validation:{...result,requestFingerprint:"invalid"}},
    }],result.id)).rejects.toThrow();
  });
});
