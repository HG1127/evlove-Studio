import {afterEach,expect,it} from "vitest";
import {demoProject} from "../data/mock-project";
import {fastHash} from "../ai/performance";
import {createProviderConnection,saveProviderConnections,saveAiRoutingPolicy,resolveProjectOperationConnections} from "../ai/providers/registry";
import {baselineScoringRouteFingerprint} from "./round-cache";
afterEach(()=>window.localStorage.clear());
it("invalidates compatible Chat score reuse when the output policy changes and excludes credentials",()=>{
 const connection={...createProviderConnection("custom"),apiKey:"fictional-chat-key",baseUrl:"https://provider.example.test/v1",defaultModel:"x",models:["x"]};
 saveProviderConnections([connection]);saveAiRoutingPolicy({mode:"single",operationRoutes:{},defaultRoute:{connectionId:connection.id,model:"x",fallbackConnectionIds:[]},requireIndependentEvaluator:false,fallbackToDemo:false});
 const aiProfile={mode:"global" as const};
 const legacyRoutes=(["execute-artifact","execute-artifact-batch","evaluate","evaluate-population"] as const).map(operation=>{
  const routed=resolveProjectOperationConnections(operation,aiProfile)[0]!;expect(routed).toBeDefined();return [operation,routed.connection.id,routed.connection.providerId,routed.model,routed.resolved.baseUrl];
 });
 const fingerprint=baselineScoringRouteFingerprint({...demoProject,aiProfile});
 expect(fingerprint).not.toBe(fastHash(JSON.stringify([aiProfile,legacyRoutes])));
 saveProviderConnections([{...connection,apiKey:"rotated-fictional-key"}]);expect(baselineScoringRouteFingerprint({...demoProject,aiProfile})).toBe(fingerprint);
});
