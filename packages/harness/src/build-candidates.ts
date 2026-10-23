import {CandidateSchema,type Candidate} from "@evolution/contracts";
type Route={provider?:string;model?:string};
export async function buildCandidatePopulation(candidates:Candidate[],options:{
  concurrency:number;signal?:AbortSignal;
  build:(candidate:Candidate,progress:(detail:string,route?:Route)=>void)=>Promise<Candidate>;
  checkpoint?:(candidate:Candidate)=>void|Promise<void>;
  progress?:(done:number,total:number,detail:string,route?:Route)=>void;
}):Promise<Candidate[]>{
  const results=new Array<Candidate>(candidates.length);
  let cursor=0;let completed=0;
  await Promise.all(Array.from({length:Math.max(0,Math.min(Math.max(1,options.concurrency),candidates.length))},async()=>{
    while(cursor<candidates.length){
      options.signal?.throwIfAborted();
      const index=cursor++;const candidate=candidates[index]!;
      const progress=(detail:string,route?:Route)=>{options.signal?.throwIfAborted();options.progress?.(completed,candidates.length,`方案 ${index+1}/${candidates.length} · ${detail}`,route);};
      progress("准备构造文件");
      let built:Candidate;
      try{
        built=CandidateSchema.parse(await options.build(candidate,progress));
        if(built.id!==candidate.id)throw new Error("构造结果与所选方案 ID 不一致");
      }catch(error){
        options.signal?.throwIfAborted();
        built=CandidateSchema.parse({...candidate,artifactBuildStatus:"failed",artifactBuildSummary:error instanceof Error?error.message:String(error)});
      }
      options.signal?.throwIfAborted();
      await options.checkpoint?.(built);
      options.signal?.throwIfAborted();
      results[index]=built;completed++;
      options.progress?.(completed,candidates.length,built.artifactBuildStatus==="ready"?"候选文件已保存，可继续验证":"已记录构造失败原因");
    }
  }));
  return results;
}
