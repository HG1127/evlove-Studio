import {z} from "zod";
import type {Candidate,SourceArtifact} from "@evolution/contracts";
import {describeArtifact} from "@evolution/core";

/** The coordinates come from the original OOXML / sheet, not plain-text extraction. */
const IndexedRun=z.object({index:z.number().int().min(0),text:z.string()});
const Doc=z.object({parts:z.array(z.object({path:z.string(),textRuns:z.array(IndexedRun)}))});
const Slides=z.object({slides:z.array(z.object({number:z.number().int().positive(),textRuns:z.array(IndexedRun)}))});
const Sheets=z.object({sheets:z.array(z.object({name:z.string(),cells:z.array(z.object({
  address:z.string(),value:z.unknown().optional(),formula:z.string().optional(),
}))}))});
type Run=z.infer<typeof IndexedRun>;
function queryWords(candidate:Candidate){
  return [...new Set([candidate.title,candidate.name,candidate.change,candidate.hypothesis,
    ...candidate.patches.map(patch=>[patch.target,patch.rationale].join(" "))].filter(Boolean)
    .join(" ").toLowerCase().split(/[\s,，。:：/;；()（）]+/).filter(word=>word.length>=3))].slice(0,35);
}
function relevance(value:string,words:string[]){
  const text=value.toLowerCase();
  return words.reduce((sum,word)=>sum+(text.includes(word)?1:0),0);
}
function selectRuns(runs:Run[],words:string[],max:number){
  if(runs.length<=max)return runs;
  const selected=new Set<number>();
  const top=runs.map((run,offset)=>({offset,score:relevance(run.text,words)}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score)
    .slice(0,Math.max(4,Math.floor(max/3)));
  for(const item of top)for(let delta=-1;delta<=1;delta++){
    const entry=runs[item.offset+delta];if(entry)selected.add(entry.index);
  }
  for(const run of runs)if(selected.size<max)selected.add(run.index);
  return runs.filter(run=>selected.has(run.index)).slice(0,max);
}
function safeJson(value:string){
  try{return JSON.parse(value) as unknown;}catch{return undefined;}
}
function mergeParentRuns(original:Run[],overrides:Run[]|undefined){
  if(!overrides?.length)return original;
  const patch=new Map(overrides.map(run=>[run.index,run.text]));
  return original.map(run=>({...run,text:patch.get(run.index)??run.text}));
}
/** A frozen prior spreadsheet Candidate is a sparse delta, not a complete sheet.
 * Reflect its actual cell changes in the next AI context without dropping the
 * original unmodified cells or pretending cached formula results are current. */
function mergeParentCells(
  original:Array<{address:string;value?:unknown;formula?:string}>,
  updates:Array<{address:string;value?:unknown;formula?:string}>|undefined,
){
  const byAddress=new Map(original.map(cell=>[cell.address,{...cell}]));
  for(const changed of updates??[]){
    const next={...(byAddress.get(changed.address)??{address:changed.address})};
    if(changed.value!==undefined){
      next.value=changed.value;
      if(changed.formula===undefined)delete next.formula;
    }
    if(changed.formula!==undefined){
      next.formula=changed.formula;
      // A changed formula invalidates the previous numerical cached result.
      if(changed.value===undefined)delete next.value;
    }
    byAddress.set(changed.address,next);
  }
  return [...byAddress.values()];
}
/**
 * Bounded native edit addresses for the AI Candidate builder. Unmentioned
 * Office parts/slides/sheets are not reconstructed; original bytes are kept.
 */
export function serverStructuredTargetContext(artifact:SourceArtifact,candidate:Candidate,parentContent?:string){
  const descriptor=artifact.artifactDescriptor??describeArtifact(artifact);
  const words=queryWords(candidate);
  if(descriptor.adapterId==="document-docx-ooxml"){
    const source=Doc.safeParse(artifact.structuredContent);
    if(!source.success||!source.data.parts.length)return undefined;
    const parent=Doc.safeParse(parentContent?safeJson(parentContent):undefined);
    const overrides=new Map(parent.success?parent.data.parts.map(part=>[part.path,part.textRuns]):[]);
    const ranked=source.data.parts.map(part=>{
      const runs=mergeParentRuns(part.textRuns,overrides.get(part.path));
      return {path:part.path,textRuns:selectRuns(runs,words,90),totalRuns:runs.length,
        relevance:relevance(part.path+" "+runs.map(run=>run.text).join(" "),words)};
    }).sort((a,b)=>b.relevance-a.relevance).slice(0,6);
    return {kind:"document",subtype:"docx",
      editingContract:"word part path + zero-based w:t run index",
      totalParts:source.data.parts.length,
      parts:ranked.map(part=>({path:part.path,textRuns:part.textRuns,totalRuns:part.totalRuns})),
      omittedParts:source.data.parts.length-ranked.length};
  }
  if(descriptor.adapterId==="presentation-pptx-ooxml"){
    const source=Slides.safeParse(artifact.structuredContent);
    if(!source.success||!source.data.slides.length)return undefined;
    const parent=Slides.safeParse(parentContent?safeJson(parentContent):undefined);
    const overrides=new Map(parent.success?parent.data.slides.map(slide=>[slide.number,slide.textRuns]):[]);
    const ranked=source.data.slides.map(slide=>{
      const runs=mergeParentRuns(slide.textRuns,overrides.get(slide.number));
      return {number:slide.number,textRuns:selectRuns(runs,words,70),totalRuns:runs.length,
        relevance:relevance("slide "+slide.number+" "+runs.map(run=>run.text).join(" "),words)};
    }).sort((a,b)=>b.relevance-a.relevance).slice(0,10);
    return {kind:"presentation",editingContract:"one-based slide number + zero-based a:t run index",
      totalSlides:source.data.slides.length,slides:ranked.map(slide=>({number:slide.number,textRuns:slide.textRuns,totalRuns:slide.totalRuns})),
      omittedSlides:source.data.slides.length-ranked.length};
  }
  if(descriptor.family==="spreadsheet"){
    const source=Sheets.safeParse(artifact.structuredContent);
    if(!source.success||!source.data.sheets.length)return undefined;
    const parent=Sheets.safeParse(parentContent?safeJson(parentContent):undefined);
    const parentSheets=new Map(parent.success?parent.data.sheets.map(sheet=>[sheet.name,sheet.cells]):[]);
    const ranked=source.data.sheets.map(sheet=>{
      const modified=parentSheets.get(sheet.name);
      const changedAddresses=new Set((modified??[]).map(cell=>cell.address));
      const merged=mergeParentCells(sheet.cells,modified);
      const cells=merged.map(cell=>({...cell,
        relevance:relevance(sheet.name+" "+cell.address+" "+String(cell.value??"")+" "+String(cell.formula??""),words)
          +(changedAddresses.has(cell.address)?10:0)}))
        .sort((a,b)=>b.relevance-a.relevance).slice(0,160);
      return {name:sheet.name,totalCells:merged.length,
        cells:cells.map(cell=>({address:cell.address,value:cell.value,formula:cell.formula})),
        omittedCells:merged.length-cells.length,relevance:relevance(sheet.name,words)
          +(modified?.length?10:0)};
    }).sort((a,b)=>b.relevance-a.relevance).slice(0,8);
    return {kind:"spreadsheet",editingContract:"existing sheet name + A1 cell address",
      totalSheets:source.data.sheets.length,sheets:ranked.map(sheet=>({name:sheet.name,totalCells:sheet.totalCells,cells:sheet.cells,omittedCells:sheet.omittedCells})),
      omittedSheets:source.data.sheets.length-ranked.length,
      note:"No formula recalculation is implied by the listed cell values."};
  }
  return undefined;
}
