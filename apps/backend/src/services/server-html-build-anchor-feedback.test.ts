// @vitest-environment node
import {describe,expect,it} from "vitest";
import {htmlBuildBodyEditAnchors} from "@evolution/core";
import {serverHtmlBuildAnchorFeedback} from "./server-html-build-anchor-feedback";
import {serverAiBuildContract} from "./server-ai-build-contract";
const html='<html><body><p>first body</p><p>second body</p></body></html>',sha="a".repeat(64),anchors=htmlBuildBodyEditAnchors(html,sha),node=anchors[0]!;
const scope={project:{currentTargets:[{id:"s",bodyAnchorPolicy:"issued-body-nodes-v1",htmlBuildBodyContext:{schemaVersion:"html-build-body-context-v1",parentSha256:sha,anchors,components:[]}}]}};
const response=(id:string)=>({summary:"synthetic",artifacts:[{sourceArtifactId:"s",name:"s.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"html-build-body-node-edits-v1",edits:[{anchorId:id,after:"replacement"}]})}]});
describe("actionable issued HTML node feedback",()=>{
  it("supplies a complete request-owned ID for a unique shortened prefix while still rejecting it",()=>{
    const shortened=node.anchorId.split("-")[0]!,contract=serverAiBuildContract(scope),bad=contract.parser.safeParse(response(shortened));
    expect(bad.success).toBe(false);if(!bad.success){expect(bad.error.issues[0]!.message).toContain(node.anchorId);expect(bad.error.issues[0]!.message.length).toBeLessThanOrEqual(240);}
    expect(contract.parser.parse(response(node.anchorId)).artifacts[0]!.content).toBe(response(node.anchorId).artifacts[0]!.content);
    expect(response(shortened).artifacts[0]!.content).not.toContain(node.anchorId);
  });
  it("uses only current-source suggestions for an unknown range and never changes its acceptance",()=>{
    const wrong=`t${(node.start+1).toString(36)}_${(node.end+99).toString(36)}-${"b".repeat(16)}`,message=serverHtmlBuildAnchorFeedback(wrong,anchors,12);
    expect(message).toContain("no exact source node");expect(message).toContain(node.anchorId);expect(message.length).toBeLessThanOrEqual(240);
    expect(serverAiBuildContract(scope).parser.safeParse(response(wrong)).success).toBe(false);
    expect(serverHtmlBuildAnchorFeedback("invented",anchors,0)).not.toContain(node.anchorId);
  });
  it("keeps a duplicate valid node distinct from an unknown node",()=>{
    const value=response(node.anchorId),inner=JSON.parse(value.artifacts[0]!.content);inner.edits.push({...inner.edits[0]});value.artifacts[0]!.content=JSON.stringify(inner);
    const parsed=serverAiBuildContract(scope).parser.safeParse(value);expect(parsed.success).toBe(false);
    if(!parsed.success){expect(parsed.error.issues[0]!.message).toContain("duplicate issued anchorId");expect(parsed.error.issues[0]!.message).not.toContain("Nearby");}
  });
  it("keeps suggested IDs complete within the existing 240-character correction envelope",()=>{
    const id="t1_2-"+"a".repeat(195),message=serverHtmlBuildAnchorFeedback("t1_2",[{anchorId:id,start:1,end:2}],0);
    expect(message).toContain(id);expect(message.length).toBeLessThanOrEqual(240);
    const oversized=[{anchorId:id,start:1,end:2},{anchorId:"t3_4-"+"b".repeat(195),start:3,end:4}];
    const nearby=serverHtmlBuildAnchorFeedback("t2_9",oversized,0);expect(nearby.length).toBeLessThanOrEqual(240);expect(nearby).not.toContain("Nearby");
  });
});
