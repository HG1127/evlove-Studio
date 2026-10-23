// @vitest-environment node
import {describe,expect,it} from "vitest";
import {HTML_NATIVE_PROFILE_ID} from "@evolution/contracts";
import {htmlNativeProgramIdentity} from "@evolution/core";
import {compileKnownHtmlDerivedMetadata,identifyHtmlNativeSubjects,isKnownHtmlNativeSubject,nativeHtmlSha256,type HtmlNativeProfile} from "./profile";

const original='<html><head><style>p{color:red}</style><script>const keep=true;</script></head><body><article class="slide-card" id="slide-1" data-search="old"><div class="slide-body"><p>old</p><pre>  exact code</pre></div></article></body></html>';
const subject=original.replace('<p>old</p>','<p>new_configuration</p>');
const identity=htmlNativeProgramIdentity(original,nativeHtmlSha256);
const profiles:HtmlNativeProfile[]=[{id:HTML_NATIVE_PROFILE_ID,programSignature:identity.signature,styleSignature:identity.styleSignature}];
describe("pure native renderer profile identification",()=>{
  it("leaves an unknown renderer unchanged rather than assuming its data-search attribute is executable coverage",()=>{
    expect(isKnownHtmlNativeSubject(subject)).toBe(false);
    expect(compileKnownHtmlDerivedMetadata(original,subject)).toEqual({html:subject,updatedIds:[]});
    expect(identifyHtmlNativeSubjects(original,subject)).toBeUndefined();
  });
  it("recognizes matching program/style surfaces separately from semantic quality",()=>{
    expect(identifyHtmlNativeSubjects(original,subject,profiles)).toMatchObject({originalCodeBlocksRetained:true,protection:{scriptBlocksUnchanged:true,styleBlocksUnchanged:true}});
    const changed=subject.replace('  exact code',' altered example');
    expect(identifyHtmlNativeSubjects(original,changed,profiles)).toMatchObject({originalCodeBlocksRetained:false});
  });
  it.each(["script","style","image","template","frame"])("declines changed or unsupported %s surfaces",kind=>{
    let changed=subject;
    if(kind==="script")changed=changed.replace('keep=true','keep=false');
    if(kind==="style")changed=changed.replace('color:red','color:blue');
    if(kind==="image")changed=changed.replace('</body>','<img src="private.png"></body>');
    if(kind==="template")changed=changed.replace('</body>','<template>unknown</template></body>');
    if(kind==="frame")changed=changed.replace('</body>','<iframe></iframe></body>');
    expect(identifyHtmlNativeSubjects(original,changed,profiles)).toBeUndefined();
  });
});
