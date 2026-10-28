import {expect,it} from "vitest";
import {failureObservationFixture} from "@evolution/testkit";
import {campaignScoringInputFingerprint} from "./campaign-scoring-input";
import {evidenceFingerprint} from "./evidence-binding";
import {finalHoldoutContractFingerprint} from "./independent-final-holdout";
import {candidateFailureContextBlocker} from "./candidate-failure-context";
it("preserves scoring comparability while binding generation treatment and evidence",()=>{
  const x=failureObservationFixture(),p=x.source,c=x.candidate;
  const fingerprints=()=>[campaignScoringInputFingerprint(p),finalHoldoutContractFingerprint(p),evidenceFingerprint(p,c)];
  const old=fingerprints();p.failureObservationSources=[];expect(fingerprints()).toEqual(old);
  p.failureObservationSources=[x.sourceRef()];const declared=fingerprints();expect(declared[0]).toBe(old[0]);expect(declared.slice(1).every((f,i)=>f!==old[i+1])).toBe(true);
  p.failureObservationSources[0]!.missionSha256="f".repeat(64);const changed=fingerprints();expect(changed[0]).toBe(old[0]);expect(changed.slice(1).every((f,i)=>f!==declared[i+1])).toBe(true);
});
it("requires the actual planning receipt and rejects removal, replacement, wrong Mission/round",()=>{
  const x=failureObservationFixture(),p=x.current,c=x.candidate;
  p.campaign.checkpoint={round:1,completedPhase:"plan",at:x.at};
  expect(candidateFailureContextBlocker(p,c)).toBeUndefined();p.failureObservationSources=[x.sourceRef()];
  expect(candidateFailureContextBlocker(p,c)).toContain("binding-mismatch");
  const use={schemaVersion:"failure-observation-use-v1" as const,grade:"provided-to-plan" as const,missionId:p.id,round:1,at:x.at,sources:structuredClone(p.failureObservationSources),contextFingerprint:"context"};
  c.planningFailureObservationUse=use;expect(candidateFailureContextBlocker(p,c)).toBeUndefined();
  const before=evidenceFingerprint(p,c);c.planningFailureObservationUse={...use,contextFingerprint:"different-context"};expect(evidenceFingerprint(p,c)).not.toBe(before);
  for(const altered of [{...use,missionId:"foreign"},{...use,round:2},{...use,sources:[]}]){c.planningFailureObservationUse=altered;expect(candidateFailureContextBlocker(p,c)).toContain("binding-mismatch");}
  c.planningFailureObservationUse=use;p.failureObservationSources=undefined;expect(candidateFailureContextBlocker(p,c)).toContain("binding-mismatch");
});
