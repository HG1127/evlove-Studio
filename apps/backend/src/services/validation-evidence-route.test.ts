// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EventEvidenceMirrorError} from "./event-persistence";

const {reconcile,requirePermission,AppendError}=vi.hoisted(()=>({
  reconcile:vi.fn(),requirePermission:vi.fn(),
  AppendError:class ValidationEvidenceAppendError extends Error{},
}));
vi.mock("nitro/h3",()=>({
  defineEventHandler:(handler:unknown)=>handler,
  getRouterParam:(event:{id?:string})=>event.id,
  createError:(input:{statusCode:number;statusMessage:string})=>Object.assign(new Error(input.statusMessage),input),
}));
vi.mock("./validation-runtime",()=>({reconcileValidationEvidence:reconcile,ValidationEvidenceAppendError:AppendError}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:requirePermission}));

import handler from "../../server/api/evolution/validation/[id]/evidence-reconcile.post";

describe("Validation Evidence reconciliation route",()=>{
  beforeEach(()=>{
    reconcile.mockReset();requirePermission.mockReset();requirePermission.mockResolvedValue(undefined);
  });

  it("requires mission execution permission and returns persisted evidence",async()=>{
    const result={validation:{id:"validation:one"},evidence:{id:"validation-evidence:validation:one"}};
    reconcile.mockResolvedValue(result);
    await expect(handler({id:"validation:one"} as never)).resolves.toEqual(result);
    expect(requirePermission).toHaveBeenCalledWith({id:"validation:one"},"mission.execute");
    expect(reconcile).toHaveBeenCalledWith("validation:one");
  });

  it("reports invalid or missing Validation IDs without an append",async()=>{
    await expect(handler({} as never)).rejects.toMatchObject({statusCode:400});
    expect(reconcile).not.toHaveBeenCalled();
    reconcile.mockResolvedValue(undefined);
    await expect(handler({id:"validation:missing"} as never)).rejects.toMatchObject({statusCode:404});
  });

  it("marks a transient Event mirror failure as retryable",async()=>{
    reconcile.mockRejectedValue(new EventEvidenceMirrorError("validation-result:validation:one",new Error("offline")));
    await expect(handler({id:"validation:one"} as never)).rejects.toMatchObject({statusCode:503});
  });

  it("marks a transient validation Evidence append failure as retryable",async()=>{
    reconcile.mockRejectedValue(new AppendError("ledger unavailable"));
    await expect(handler({id:"validation:one"} as never)).rejects.toMatchObject({statusCode:503});
  });
});
