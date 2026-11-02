import {expect,it} from "vitest";
import {compareHtmlCardParagraphs as compare} from "./html-card-paragraph-diff";
const card=(id:string,body:string)=>`<article class="slide-card" id="${id}">${body}</article>`;
it("detects paragraph removal despite unchanged card structure",()=>{
 const result=compare(card("s1","<p>required input</p><p>required output</p>"),card("s1","<p></p><p>required output</p>"));
 expect(result).toMatchObject({status:"compared",changes:[{cardId:"s1",removed:["required input"],added:[],originalParagraphCount:2,candidateParagraphCount:1}]});
});
it("normalizes HTML entities, inline markup and whitespace without evaluating source",()=>{
 expect(compare(card("s1","<p>A &amp; <b>B</b><br>C</p>"),card("s1","<p>A &amp; B C</p>"))).toMatchObject({status:"compared",changes:[]});
});
it("excludes executable, template, code, SVG and outside-card text",()=>{
 const html='<p>outside</p><script>secret()</script>'+card("s1",'<style>.secret{}</style><template><p>template</p></template><svg><text>vector</text></svg><pre><p>example</p></pre><p>real</p>');
 expect(compare(html,card("s1","<p>real</p>"))).toMatchObject({status:"compared",changes:[]});
});
it("preserves multiplicity and card association for repeated paragraphs",()=>{
 const result=compare(card("s1","<p>x</p><p>x</p>")+card("s2","<p>y</p>"),card("s1","<p>x</p>")+card("s2","<p>y</p><p>x</p>"));
 expect(result).toMatchObject({changes:[{cardId:"s1",removed:["x"],added:[]},{cardId:"s2",removed:[],added:["x"]}]});
});
it("reports a rewrite and order change without declaring it harmful",()=>{
 expect(compare(card("s1","<p>v1</p>"),card("s1","<p>v2</p>"))).toMatchObject({changes:[{removed:["v1"],added:["v2"]}]});
 expect(compare(card("s1","<p>a</p><p>b</p>"),card("s1","<p>b</p><p>a</p>"))).toMatchObject({changes:[{removed:[],added:[],paragraphSequenceChanged:true}]});
});
it("reports missing cards separately",()=>{
 expect(compare(card("s1","<p>a</p>")+card("s2","<p>b</p>"),card("s1","<p>a</p>"))).toMatchObject({changes:[{cardId:"s2",candidateCardPresent:false,removed:["b"]}]});
});
it("refuses absent, duplicate, nested or unnamed card identities",()=>{
 for(const invalid of ["<p>none</p>",card("s1","")+card("s1",""),card("s1",card("s2","")),card("","")])
  expect(compare(invalid,card("s1",""))).toMatchObject({status:"unavailable"});
});
