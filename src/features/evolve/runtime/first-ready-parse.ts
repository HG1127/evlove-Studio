/** Wait for the first usable parsed Artifact; a failure from another file is not success. */
export async function firstReadyParse<T>(jobs:Iterable<Promise<T|undefined>>):Promise<T|undefined>{
  const pending=[...jobs];
  if(!pending.length)return undefined;
  try{
    return await Promise.any(pending.map(async job=>{
      const artifact=await job;
      if(artifact===undefined)throw new Error("Parse did not produce a usable Artifact");
      return artifact;
    }));
  }catch(error){
    if(error instanceof AggregateError)return undefined;
    throw error;
  }
}
