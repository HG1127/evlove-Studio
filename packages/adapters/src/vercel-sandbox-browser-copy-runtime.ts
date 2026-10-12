/** Trusted native clipboard protocol installed only in disposable Sandbox browser runtime. */
export const VERCEL_SANDBOX_NATIVE_COPY_RUNTIME_SCRIPT = String.raw`
/**
 * Only the disposable cloud Sandbox browser may execute this native protocol.
 * Probe callbacks run in a trusted script-free same-origin page, never user HTML.
 * Local tests use fake Pages and never invoke a native system clipboard.
 */
async function copyTextWithNativeProbe({context,page,locator,probeUrl,step}) {
  if(typeof step.value!=="string"||step.value.length>65536)throw browserCapabilityError("Invalid copy-text expectation");
  let probe,timer,cancelled=false,actual,activated=false,readObserved=false;
  const mismatch=()=>{
    const error=new Error("Clipboard exact text assertion failed; actual length="+String(actual?.length)
      +" sha256="+(typeof actual==="string"?createHash("sha256").update(actual).digest("hex"):"unavailable"));
    error.code="BROWSER_ASSERTION_VIOLATION";return error;
  };
  const deadline=Date.now()+7000;
  const active=()=>{if(cancelled||Date.now()>=deadline)throw activated&&readObserved?mismatch():browserCapabilityError("Sandbox clipboard action deadline expired");};
  const remaining=()=>{active();return Math.max(1,deadline-Date.now());};
  const protocol=(async()=>{
    try {
      try {
        active();
        await context.grantPermissions(["clipboard-read","clipboard-write"],{origin:new URL(probeUrl).origin});active();
        probe=await context.newPage();active();
        await probe.goto(probeUrl,{waitUntil:"domcontentloaded",timeout:remaining()});active();
        await probe.bringToFront();active();
        const native=await probe.evaluate(()=>typeof navigator.clipboard?.readText==="function"
          &&typeof navigator.clipboard?.writeText==="function");active();
        if(!native)throw new Error("Native Clipboard API unavailable");
      }catch(error){throw browserCapabilityError("Sandbox native clipboard permission/API unavailable: "+String(error));}
      const read=async()=>{
        try {active();const text=await probe.evaluate(()=>navigator.clipboard.readText());active();return text;}
        catch(error){if(error?.code==="BROWSER_ASSERTION_VIOLATION")throw error;
          throw browserCapabilityError("Sandbox native clipboard read unavailable: "+String(error));}
      };
      const sentinel="evolution-sandbox-clipboard-sentinel-"+randomUUID();
      try {
        active();await probe.evaluate(value=>navigator.clipboard.writeText(value),sentinel);active();
        if(await read()!==sentinel)throw new Error("Native clipboard sentinel readback mismatch");
      }catch(error){throw browserCapabilityError("Sandbox native clipboard preflight unavailable: "+String(error));}
      await page.bringToFront();active();
      await locator.click({timeout:remaining()}); // exactly one real activation
      activated=true;active();await probe.bringToFront();active();
      do {
        actual=await read();readObserved=true;
        if(actual===step.value)return {operation:"copy-text",actualLength:actual.length,
          actualSha256:createHash("sha256").update(actual).digest("hex"),
          expectedSha256:createHash("sha256").update(step.value).digest("hex"),nativeProbe:true};
        await new Promise(resolve=>setTimeout(resolve,Math.min(50,Math.max(1,deadline-Date.now()))));
      }while(Date.now()<deadline&&!cancelled);
      throw mismatch();
    }finally{if(cancelled)await probe?.close().catch(()=>{});}
  })();
  const bounded=new Promise((_,reject)=>{timer=setTimeout(()=>{
    cancelled=true;void probe?.close().catch(()=>{});
    reject(activated&&readObserved?mismatch():browserCapabilityError("Sandbox native clipboard capability did not complete within its action deadline"));
  },Math.max(1,deadline-Date.now()));});
  try{return await Promise.race([protocol,bounded]);}
  finally{clearTimeout(timer);cancelled=true;await probe?.close().catch(()=>{});}
}

`;