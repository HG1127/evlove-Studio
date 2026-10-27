import {expect,it,vi} from "vitest";
import {TestCaseSchema} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {finalHoldoutContractFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {verifyServerIndependentFinalHoldout} from "./server-independent-final-holdout";

it("does not execute or replace a frozen paper whose browser predicates lack a bound mode",async()=>{
  const {project,current:candidate}=acceptedPackageFixture(false);
  const suite=[TestCaseSchema.parse({id:"F",title:"final",input:"novel scenario",expected:["visible"],hidden:true,
    executionMode:"artifact-runtime",browserSteps:[{action:"visible",selector:"#actual"}]})];
  candidate.finalHoldoutPaperHash=finalHoldoutPaperHash(suite);
  project.finalHoldout={round:1,suite,paperHash:candidate.finalHoldoutPaperHash,contractFingerprint:finalHoldoutContractFingerprint(project),createdAt:project.updatedAt};
  const before=structuredClone(project),execute=vi.fn();
  await expect(verifyServerIndependentFinalHoldout({project,candidate},execute)).rejects.toThrow("浏览器断言");
  expect(execute).not.toHaveBeenCalled();expect(project).toEqual(before);
});
