/** Trusted fixed browser observers; this is code owned by the adapter, never supplied eval. */
export const VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT = String.raw`
function browserCapabilityError(message) {
  const error=new Error(message);error.code="BROWSER_CAPABILITY_UNAVAILABLE";return error;
}
function validateFixedBrowserStep(step) {
  if(!step||typeof step.selector!=="string"||!step.selector.trim()||step.selector.length>500)
    throw browserCapabilityError("Invalid browser selector");
  let keys=["action","selector"];
  if(["click","fill","visible","text","count"].includes(step.action)) {
    keys.push("value","count");
    if(["fill","text"].includes(step.action)&&(typeof step.value!=="string"||step.value.length>65536))
      throw browserCapabilityError("Browser input/text lacks a bounded literal");
    if(step.count!==undefined&&(!Number.isInteger(step.count)||step.count<0))
      throw browserCapabilityError("Browser count is invalid");
    if(step.action==="count"&&step.count===undefined)throw browserCapabilityError("Browser count is absent");
    if(step.value!==undefined&&(typeof step.value!=="string"||step.value.length>65536))
      throw browserCapabilityError("Browser literal is invalid");
  }else if(step.action==="viewport")keys.push("width","height");
  else if(step.action==="in-viewport")keys.push("ratio","expected");
  else if(step.action==="attribute")keys.push("name","value","mode");
  else if(step.action==="checked")keys.push("checked");
  else if(step.action==="scroll-position")keys.push("axis","min","max");
  else if(step.action==="copy-text")keys.push("value");
  else if(step.action==="computed-style") {
    keys.push("property","mode");
    if(step.mode==="literal")keys.push("value");
    else if(step.mode==="numeric-range")keys.push("min","max");
    else if(step.mode==="identity-transform")keys.push("tolerance");
    else if(step.mode==="parent-relative")keys.push("relativeTo","min","max");
    else throw browserCapabilityError("Unknown computed-style mode");
  }else if(step.action!=="scroll-into-view")throw browserCapabilityError("Unknown browser action");
  if(Object.keys(step).some(key=>!keys.includes(key)))throw browserCapabilityError("Unsupported browser operation field");
}

function assertFiniteRange(step,minAllowed,maxAllowed) {
  if(!Number.isFinite(step.min)||!Number.isFinite(step.max)||step.min>step.max
    ||step.min<minAllowed||step.max>maxAllowed)throw browserCapabilityError("Invalid typed observation range");
}
async function setFixedBrowserViewport(page,step) {
  if(step.selector!=="html"||!Number.isInteger(step.width)||!Number.isInteger(step.height)
    ||step.width<240||step.width>2560||step.height<240||step.height>2560)
    throw browserCapabilityError("Invalid bounded viewport control");
  let timer,expired=false;
  const deadline=Date.now()+7000;
  const bounded=new Promise((_,reject)=>{timer=setTimeout(()=>{
    expired=true;void Promise.resolve().then(()=>page.close?.()).catch(()=>{});
    reject(browserCapabilityError("Trusted viewport control exceeded its action deadline"));
  },7000);});
  try {
    await Promise.race([page.setViewportSize({width:step.width,height:step.height}),bounded]);
    if(expired||Date.now()>=deadline)throw browserCapabilityError("Trusted viewport control completed after its action deadline");
    return {operation:"viewport",width:step.width,height:step.height};
  }catch(error){throw browserCapabilityError("Trusted viewport control unavailable: "+String(error));}
  finally{clearTimeout(timer);}
}async function runFixedTypedBrowserStep({page,context,locator,step,clipboardProbeUrl}) {
  if(step.action==="viewport")return setFixedBrowserViewport(page,step);
  if(step.action==="scroll-into-view") {await locator.scrollIntoViewIfNeeded({timeout:7000});return {operation:"scroll-into-view"};}
  if(step.action==="in-viewport") {
    const ratio=step.ratio??0,expected=step.expected??true;
    if(!Number.isFinite(ratio)||ratio<0||ratio>1||typeof expected!=="boolean")throw browserCapabilityError("Invalid viewport predicate");
    let facts,capability;
    await expect.poll(async()=>{
      try{facts=await observeFixedBrowserFacts(context,page,step);capability=undefined;}
      catch(error){capability=error;return false;}
      if(facts.count!==1)return false;
      const inside=facts.intersectionRatio>0&&facts.intersectionRatio>=ratio;
      return inside===expected;
    },{timeout:7000}).toBe(true).catch(error=>{if(capability)throw capability;throw error;});
    return {operation:"in-viewport",expected,ratio,...facts};
  }
  if(step.action==="attribute") {
    const allowed=["class","id","style","checked","disabled","hidden","open","href","aria-expanded","aria-checked",
      "aria-valuenow","aria-valuemin","aria-valuemax","aria-hidden","data-progress","data-state"];
    if(typeof step.name!=="string"||step.name.length>64
      ||(!allowed.includes(step.name)&&!/^data-[a-z0-9-]+$/.test(step.name))
      ||typeof step.value!=="string"||step.value.length>65536
      ||!["equals","contains"].includes(step.mode??"equals"))throw browserCapabilityError("Invalid typed attribute predicate");
    let actual;
    await expect.poll(async()=>{
      actual=await locator.getAttribute(step.name);
      return (step.mode??"equals")==="contains"?actual!==null&&actual.includes(step.value):actual===step.value;
    },{timeout:7000}).toBe(true);
    return {operation:"attribute",name:step.name,actual:actual.length<=512?actual:undefined,
      length:actual.length,sha256:createHash("sha256").update(actual).digest("hex")};
  }
  if(step.action==="checked") {
    if(typeof step.checked!=="boolean")throw browserCapabilityError("Invalid checked predicate");
    await expect(locator).toBeChecked({checked:step.checked,timeout:7000});
    return {operation:"checked",actual:await locator.isChecked()};
  }
  if(step.action==="scroll-position") {
    if(step.selector!=="html"||!["x","y"].includes(step.axis??"y"))throw browserCapabilityError("Invalid scroll-position scope");
    assertFiniteRange(step,-10000000,10000000);
    let facts,capability;
    await expect.poll(async()=>{
      try{facts=await observeFixedBrowserFacts(context,page,step);capability=undefined;}
      catch(error){capability=error;return false;}
      return facts.actual>=step.min&&facts.actual<=step.max;
    },{timeout:7000}).toBe(true).catch(error=>{if(capability)throw capability;throw error;});
    return {operation:"scroll-position",axis:step.axis??"y",...facts};
  }
  if(step.action==="computed-style") {
    if(!["opacity","transform","width","display","visibility"].includes(step.property))throw browserCapabilityError("Unsupported computed property");
    if(step.mode==="literal") {
      if(typeof step.value!=="string"||!step.value||step.value.length>512
        ||(step.property==="opacity"&&!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(step.value)))throw browserCapabilityError("Invalid CSS literal");
    }else if(step.mode==="numeric-range") {
      if(!["opacity","width"].includes(step.property))throw browserCapabilityError("Unsupported numeric CSS property");
      assertFiniteRange(step,0,step.property==="opacity"?1:10000000);
    }else if(step.mode==="identity-transform") {
      if(step.property!=="transform"||!Number.isFinite(step.tolerance??0.01)||(step.tolerance??0.01)<0
        ||(step.tolerance??0.01)>0.1)throw browserCapabilityError("Invalid transform predicate");
    }else if(step.mode==="parent-relative") {
      if(step.property!=="width"||typeof step.relativeTo!=="string"||!step.relativeTo.trim()||step.relativeTo.length>500)
        throw browserCapabilityError("Invalid relative-width predicate");
      assertFiniteRange(step,0,1);
    }else throw browserCapabilityError("Unsupported computed-style mode");
    let facts,capability;
    await expect.poll(async()=>{
      try {facts=await observeFixedBrowserFacts(context,page,step);capability=undefined;}catch(error){capability=error;return false;}
      if(facts.count!==1||(step.mode==="parent-relative"&&facts.referenceCount!==1))return false;
      if(step.mode==="literal")return (step.property==="opacity"?String(facts.effectiveOpacity):facts.computed)===step.value;
      if(step.mode==="identity-transform")return facts.matrix.every((value,index)=>Number.isFinite(value)
        &&Math.abs(value-([0,5,10,15].includes(index)?1:0))<=(step.tolerance??0.01));
      let value;
      if(step.mode==="parent-relative")value=facts.width/facts.referenceWidth;
      else if(step.property==="opacity")value=facts.effectiveOpacity;
      else if(/^\d+(?:\.\d+)?px$/.test(facts.computed))value=Number.parseFloat(facts.computed);
      else {capability=browserCapabilityError("Computed width is not a measurable px value");return false;}
      facts.actual=value;
      return Number.isFinite(value)&&value>=step.min&&value<=step.max;
    },{timeout:7000}).toBe(true).catch(error=>{
      if(capability)throw browserCapabilityError("Computed-style observation unavailable: "+String(capability));
      throw error;
    });
    return {operation:"computed-style",property:step.property,mode:step.mode,...facts};
  }
  if(step.action==="copy-text")return copyTextWithNativeProbe({context,page,locator,probeUrl:clipboardProbeUrl,step});
  throw browserCapabilityError("Unsupported browser action: "+String(step.action));
}

`;