import {createHash} from "node:crypto";
import {HTML_BUILD_BODY_CONTEXT_VERSION,HtmlBuildBodyContextSchema} from "@evolution/contracts";
import {htmlBuildBodyEditAnchors,htmlKnownSemanticComponents,htmlRepairBodyContext} from "@evolution/core";
import {isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";
import {serverRepairMeasuredTextAuthorized} from "./server-ai-repair-consent";

/** The existing exact-Mission body consent also bounds initial SOP construction; no provider call occurs here. */
export function serverHtmlBuildBodyContext(missionId:string,extension:string,source:string){
  if(!serverRepairMeasuredTextAuthorized(missionId)||!/^html?$/i.test(extension))return undefined;
  const markup=htmlRepairBodyContext(source);
  if(markup===undefined)throw new Error("HTML construction needs complete physical body boundaries before sharing body context");
  const parentSha256=createHash("sha256").update(source).digest("hex");
  const context=HtmlBuildBodyContextSchema.parse({schemaVersion:HTML_BUILD_BODY_CONTEXT_VERSION,parentSha256,
    anchors:htmlBuildBodyEditAnchors(source,parentSha256),components:isKnownHtmlNativeSubject(source)?htmlKnownSemanticComponents(source):[]});
  return {markup,context};
}

export const SERVER_HTML_BUILD_BODY_INSTRUCTION="For currentTargets with htmlBuildBodyContext, read its complete body anchor index as the full document, not just the retrieved markup chunks. The index contains exact before/start/end locations in the same SHA-bound physical full parent. Body-markup chunk offsets refer only to the projection; never use them as physical file offsets. Return text-edits with exact supplied anchors, retaining all untouched source bytes. For body text replacements copy the COMPLETE before/start/end from the selected issued anchor, especially when multiple body nodes share text. If positions are omitted, the server binds only a unique complete body node; copies inside search attributes are not body nodes. Ambiguous body nodes, invented anchors and changed parents remain rejected. Preserve every renderer component's label and exactly two descendant paragraphs: the known renderer consumes only these slots and removes their entire content-block. Place extra explanatory paragraphs outside that content-block, within the same slide-body; do not put new prose beside the two slots where runtime would discard it. New ordinary paragraphs/lists remain possible elsewhere. All original goals, chapter scope and thresholds remain binding. Do not claim that more words, a focused plan or a construction check proves configuration improvement or acceptance.";
