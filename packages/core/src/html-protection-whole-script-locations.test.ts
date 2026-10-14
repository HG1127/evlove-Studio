// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlProtectionWholeSubjectScriptLocations } from "./html-protection-whole-script-locations";
import { htmlProtectionWholeRuntimeSourcePlan } from "./html-protection-whole-runtime-plan";
const html = '<!doctype html><html><head></head><body>\n<script>window.value=1;</script>\n<script>window.value=1;</script></body></html>';
const plan = htmlProtectionWholeRuntimeSourcePlan({ original: { sourceArtifactId: 'synthetic', sha256:'a'.repeat(64), byteLength:html.length }, html });
describe('full physical inline source occurrence binding',()=>{
 it('identical sources retain two independently located Original parents',()=>{const locations=htmlProtectionWholeSubjectScriptLocations({sourcePlan:plan,html});expect(locations).toHaveLength(2);expect(locations.map(value=>value.parentId)).toEqual(['runtime-script:0','runtime-script:1']);expect(locations[0]?.line).not.toBe(locations[1]?.line)});
 it('legitimate text refinement may shift native source locations but not Original parent scope',()=>{const changed=html.replace('<body>','<body>expanded\n');const before=htmlProtectionWholeSubjectScriptLocations({sourcePlan:plan,html}),after=htmlProtectionWholeSubjectScriptLocations({sourcePlan:plan,html:changed});expect(after.map(value=>value.parentId)).toEqual(before.map(value=>value.parentId));expect(after[0]?.line).toBe(before[0]!.line+1)});
 it.each([html.replace('window.value=1;','window.value=2;'),html.replace('</body>','<script>window.value=1;</script></body>'),html.replace('<script>window.value=1;</script>','')])('retains missing/extra/changed physical source as real mismatch',changed=>expect(()=>htmlProtectionWholeSubjectScriptLocations({sourcePlan:plan,html:changed})).toThrow());
});
