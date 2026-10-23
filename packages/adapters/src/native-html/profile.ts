import {createHash} from "node:crypto";
import {HTML_NATIVE_PROFILE_ID} from "@evolution/contracts";
import {htmlCandidateProtection,htmlNativeCodeRetention,htmlNativeProgramIdentity,synchronizeHtmlCardSearchIndex} from "@evolution/core";

export const nativeHtmlSha256=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
export const KNOWN_HTML_NATIVE_PROFILES=[{
  id:HTML_NATIVE_PROFILE_ID,
  programSignature:"b43d7f9d8d3caf5bd54b0c19c9ffa9b4aa71a826bcec54db8f906d00ef4656af",
  styleSignature:"0c557712115a75fe9e636e2dddcf6fcfe57adeb09dbd62e397b951dc8ef21f91",
}] as const;
export interface HtmlNativeProfile {id:typeof HTML_NATIVE_PROFILE_ID;programSignature:string;styleSignature:string}

export function isKnownHtmlNativeSubject(html:string){
  try{
    const identity=htmlNativeProgramIdentity(html,nativeHtmlSha256);
    return !identity.unlocated&&KNOWN_HTML_NATIVE_PROFILES.some(profile=>profile.programSignature===identity.signature&&profile.styleSignature===identity.styleSignature);
  }catch{return false;}
}

export function identifyHtmlNativeSubjects(originalHtml:string,subjectHtml:string,profiles:readonly HtmlNativeProfile[]=KNOWN_HTML_NATIVE_PROFILES){
  const original=htmlNativeProgramIdentity(originalHtml,nativeHtmlSha256),subject=htmlNativeProgramIdentity(subjectHtml,nativeHtmlSha256);
  const profile=profiles.find(item=>item.programSignature===original.signature&&item.styleSignature===original.styleSignature);
  if(!profile||original.unlocated||subject.unlocated||original.templateCount||subject.templateCount||original.frameCount||subject.frameCount
    ||original.externalScriptCount||subject.externalScriptCount||original.mediaCount||subject.mediaCount
    ||JSON.stringify(original.visualBlockDigests)!==JSON.stringify(subject.visualBlockDigests)
    ||subject.signature!==original.signature||subject.styleSignature!==original.styleSignature)return undefined;
  const codeBlockRetention=htmlNativeCodeRetention(originalHtml,subjectHtml);
  const protection=htmlCandidateProtection({sourceArtifactId:"native-subject",originalHtml,candidateHtml:subjectHtml,protectedItems:[],allowCanonicalDerivedSearchIndex:true});
  return {profile,original,subject,originalCodeBlocksRetained:codeBlockRetention.retained,codeBlockRetention,protection:protection.nativeObservation};
}

/** Preserve model-authored prose and compile only the known renderer's derived index. */
export function compileKnownHtmlDerivedMetadata(originalHtml:string,subjectHtml:string){
  if(!identifyHtmlNativeSubjects(originalHtml,subjectHtml))return {html:subjectHtml,updatedIds:[] as string[]};
  return synchronizeHtmlCardSearchIndex(originalHtml,subjectHtml);
}
