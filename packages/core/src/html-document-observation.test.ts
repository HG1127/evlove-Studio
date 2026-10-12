import { describe, expect, it } from "vitest";
import { htmlDocumentObservation } from "./html-document-observation";

describe("whole HTML static document observations", () => {
  it("observes actual cards, tail, duplicate IDs and absent closing tags without inventing acceptance", () => {
    const html='<!doctype html><html><head><style>.x{content:"fake <article>"}</style></head><body>'
      +'<article class="slide-card" id="slide-1"><h2>First &amp; complete</h2><p>Configuration one</p></article>'
      +'<article class="slide-card" id="slide-2"><h2>Last section</h2><p>TODO quoted tutorial</p></article><div id="slide-2"></div>';
    const result=htmlDocumentObservation(html);
    expect(result.structure).toMatchObject({readWholeFile:true,slideCardCount:2,explicit:{bodyEnd:false,htmlEnd:false},placeholderOccurrenceCount:1});
    expect(result.structure.duplicateIds).toEqual([{id:"slide-2",count:2}]);
    expect(result.structure.sections.at(-1)?.id).toBe("slide-2");
    expect(result.documentText).toContain("First & complete");
    expect(result.documentText).toContain("Last section");
    expect(result.documentText).not.toContain('content:"fake');
    expect(result.structure).not.toHaveProperty("pass");
  });
  it("never executes scripts and excludes their text while indexing template scope", () => {
    const result=htmlDocumentObservation('<html><body><script>throw new Error("executed");</script><template><p>INERT ONLY</p></template><p>Text</p></body></html>');
    expect(result.documentText).not.toContain("executed");
    expect(result.documentText).toContain("[inert template content]");
    expect(result.documentText).toContain("INERT ONLY");
    expect(result.structure.elementCounts.script).toBe(1);
    expect(result.structure.limitations.join(" ")).toContain("no scripts");
  });
  it("uses actual file counts without trusting a supplied or historical slide count", () => {
    const cards=Array.from({length:111},(_,i)=>'<article class="slide-card" id="slide-'+i+'"><h2>Title '+i+'</h2>Content '+i+'</article>').join("");
    const observation=htmlDocumentObservation('<html><body>'+cards+'</body></html>');
    expect(observation.structure.slideCardCount).toBe(111);
    expect(observation.structure.sections).toHaveLength(111);
    expect(observation.documentText).toContain("Content 110");
  });
});


it("preserves newline and indentation sensitive configuration examples exactly",()=>{
  const yaml="services:\n  app:\n    image: nginx\n";
  const python="if ready:\n    execute()\n";
  const here="cat << EOF\nline one\nEOF\n";
  const observed=htmlDocumentObservation('<html><body><article id="setup"><pre><code>'+yaml+'</code></pre><pre>'+python+'</pre><textarea>'+here.replace(/</g,'&lt;')+'</textarea></article></body></html>');
  expect(observed.documentText).toContain(yaml);expect(observed.documentText).toContain(python);expect(observed.documentText).toContain(here);
});
