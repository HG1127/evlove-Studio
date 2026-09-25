// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";

const {validate,register,requirePermission,UncertainError}=vi.hoisted(()=>(
  {
    validate:vi.fn(),register:vi.fn(),requirePermission:vi.fn(),
    UncertainError:class ValidationPersistenceUncertainError extends Error{
      constructor(readonly validationId:string,cause:unknown){super("uncertain",{cause});}
    },
  }
));
vi.mock("nitro/h3",()=>(
  {
    defineEventHandler:(handler:unknown)=>handler,
    readBody:(event:{body:unknown})=>event.body,
    createError:(input:{statusCode:number;statusMessage:string;data?:unknown})=>Object.assign(new Error(input.statusMessage),input),
  }
));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({})}));
vi.mock("./evidence-runtime",()=>({registerArtifactEvidence:register}));
vi.mock("./evidence-ledger",()=>({EventEvidenceIdentityConflictError:class extends Error{}}));
vi.mock("./event-persistence",()=>({
  EventEvidenceMirrorError:class extends Error{},EventIdempotencyConflictError:class extends Error{},
}));
vi.mock("./validation-runtime",()=>({
  validateArtifact:validate,ValidationIdempotencyConflictError:class extends Error{},
  ValidationPersistenceUncertainError:UncertainError,
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:requirePermission}));

import handler from "../../server/api/evolution/validation.post";

const body={missionId:"mission-1",artifactId:"artifact-1",checks:{minBytes:1}};

describe("Validation POST recovery response",()=>{
  beforeEach(()=>{
    validate.mockReset();register.mockReset();requirePermission.mockReset();
    requirePermission.mockResolvedValue(undefined);
  });

  it("returns the attempted ID when Event persistence is uncertain",async()=>{
    validate.mockRejectedValue(new UncertainError("validation:one",new Error("timeout")));
    await expect(handler({body} as never)).rejects.toMatchObject({
      statusCode:503,data:{validationId:"validation:one"},
    });
    expect(register).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith({body},"mission.execute");
  });

  it("continues to Evidence after an authoritative Validation is recovered",async()=>{
    const validation={id:"validation:one",missionId:"mission-1",artifactId:"artifact-1",status:"passed"};
    const evidence={id:"validation-evidence:validation:one"};
    validate.mockResolvedValue(validation);register.mockResolvedValue(evidence);
    await expect(handler({body} as never)).resolves.toEqual({validation,evidence});
  });
});
