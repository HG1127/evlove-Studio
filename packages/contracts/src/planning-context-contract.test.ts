import {describe,expect,it} from "vitest";
import {HtmlStaticLocatorFactsSchema,PlanningDocumentContextSchema} from "./planning-context-contract";
const legacy={schemaVersion:"planning-document-context-v1",sourceArtifactId:"s",currentVersion:"V1",parentSha256:"a".repeat(64),inputChars:123,text:"body",textChars:4,complete:true,
  outline:[{index:0,id:"slide-1",title:"Guide"}],excludes:["scripts","styles","templates","noscript","svg","executable-attributes","runtime-verdicts"]};
const facts={schemaVersion:"html-static-locator-facts-v1",scope:"source-body-markup",complete:true,tagCounts:[{element:"article",count:1}],
  idElements:[{id:"slide-1",element:"article",classes:["slide-card"]}],classCounts:[{element:"article",className:"slide-card",count:1}]};
describe("versioned complete planning locator facts",()=>{
  it("keeps strict legacy data without inventing structure observations",()=>{
    const parsed=PlanningDocumentContextSchema.parse(legacy);expect(parsed).toEqual(legacy);expect(parsed).not.toHaveProperty("locatorFacts");
    expect(PlanningDocumentContextSchema.safeParse({...legacy,locatorFacts:facts}).success).toBe(false);
    expect(PlanningDocumentContextSchema.safeParse({...legacy,outline:[{...legacy.outline[0],element:"article"}]}).success).toBe(false);
  });
  it("requires v2 element identity and explicit static-only complete facts",()=>{
    const v2={...legacy,schemaVersion:"planning-document-context-v2",outline:[{...legacy.outline[0],element:"article"}],locatorFacts:facts};
    expect(PlanningDocumentContextSchema.parse(v2)).toEqual(v2);
    expect(PlanningDocumentContextSchema.safeParse({...v2,outline:legacy.outline}).success).toBe(false);
    expect(PlanningDocumentContextSchema.safeParse({...v2,locatorFacts:undefined}).success).toBe(false);
    expect(HtmlStaticLocatorFactsSchema.safeParse({...facts,runtimeVerified:true}).success).toBe(false);
    expect(HtmlStaticLocatorFactsSchema.safeParse({...facts,rawScripts:"private"}).success).toBe(false);
    expect(HtmlStaticLocatorFactsSchema.safeParse({...facts,complete:false}).success).toBe(false);
    expect(HtmlStaticLocatorFactsSchema.safeParse({...facts,tagCounts:[{element:"article",count:0}]}).success).toBe(false);
  });
});
