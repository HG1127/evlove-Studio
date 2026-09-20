/** One shared budget prevents nested candidate/case/rubric pools multiplying concurrency. */
export function createRequestPool(limit:number){
 let active=0;
 const queue:Array<()=>void>=[];
 async function acquire(signal?:AbortSignal):Promise<()=>void>{
  if(signal?.aborted)throw signal.reason;
  if(active>=limit)await new Promise<void>((resolve,reject)=>{
   const proceed=()=>{signal?.removeEventListener("abort",cancel);resolve();};
   const cancel=()=>{const index=queue.indexOf(proceed);if(index>=0)queue.splice(index,1);reject(signal?.reason??new Error("已取消排队"));};
   queue.push(proceed);signal?.addEventListener("abort",cancel,{once:true});
  });
  else active++;
  if(signal?.aborted){release();throw signal.reason;}
  return release;
 }
 function release(){const next=queue.shift();if(next)next();else active--;}
 return async function run<T>(task:()=>Promise<T>,signal?:AbortSignal){const release=await acquire(signal);try{return await task();}finally{release();}};
}
export const withAiRequestSlot=createRequestPool(4);
