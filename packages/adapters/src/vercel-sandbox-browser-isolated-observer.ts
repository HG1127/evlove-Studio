/** Fixed Chromium observers run only in a named, non-default CDP execution realm. */
export const VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT = String.raw`
async function collectFixedIsolatedBrowserFacts(args) {
  const finite=value=>typeof value==="number"&&Number.isFinite(value);
  const failure=message=>{throw new Error(message);};
  const select=selector=>{
    if(typeof selector!=="string"||!selector.trim()||selector.length>500)failure("Invalid isolated CSS selector");
    const css=selector.startsWith("css=")?selector.slice(4):selector;
    const roots=[document],matches=[],seen=new Set();let elements=0;
    for(let index=0;index<roots.length;index++) {
      if(roots.length>256)failure("Isolated selector exceeds shadow-root bound");
      const root=roots[index];
      for(const element of root.querySelectorAll(css))if(!seen.has(element)){seen.add(element);matches.push(element);}
      for(const element of root.querySelectorAll("*")) {
        if(++elements>20000)failure("Isolated selector exceeds DOM observation bound");
        if(element.shadowRoot)roots.push(element.shadowRoot);
      }
    }
    return matches;
  };
  if(args.action==="layout") {
    const width=document.documentElement.scrollWidth,viewport=window.innerWidth;
    if(!finite(width)||width<0||!finite(viewport)||viewport<=0)failure("Isolated layout dimensions are unavailable");
    return {observer:"chromium-cdp-isolated-v1",overflow:width>viewport+2,title:document.title};
  }  if(args.action==="scroll-position") {
    const actual=args.axis==="x"?window.scrollX:window.scrollY;
    if(!finite(actual))failure("Isolated scroll position is not finite");
    return {observer:"chromium-cdp-isolated-v1",actual};
  }
  const matches=select(args.selector);
  if(matches.length!==1)return {observer:"chromium-cdp-isolated-v1",count:matches.length};
  const element=matches[0];
  if(args.action==="in-viewport") {
    if(typeof IntersectionObserver!=="function")failure("Native isolated IntersectionObserver is unavailable");
    const ratio=await new Promise((resolve,reject)=>{
      let observer,timer;
      try {
        observer=new IntersectionObserver(entries=>{
          const entry=entries.find(item=>item.target===element);
          if(!entry)return;
          clearTimeout(timer);observer.disconnect();
          if(!finite(entry.intersectionRatio)||entry.intersectionRatio<0||entry.intersectionRatio>1)reject(new Error("Invalid isolated viewport ratio"));
          else resolve(entry.intersectionRatio);
        });
        timer=setTimeout(()=>{observer.disconnect();reject(new Error("Isolated viewport observation timed out"));},750);
        observer.observe(element);
      }catch(error){clearTimeout(timer);observer?.disconnect();reject(error);}
    });
    return {observer:"chromium-cdp-isolated-v1",count:1,intersectionRatio:ratio};
  }
  if(args.action!=="computed-style")failure("Unknown isolated observer operation");
  const computed=getComputedStyle(element).getPropertyValue(args.property);
  if(typeof computed!=="string"||!computed)failure("Isolated computed property is unavailable");
  const facts={observer:"chromium-cdp-isolated-v1",count:1,computed};
  if(args.property==="width") {
    facts.width=element.getBoundingClientRect().width;
    if(!finite(facts.width)||facts.width<0)failure("Isolated element width is not finite");
    if(args.mode==="parent-relative") {
      const references=select(args.relativeTo);facts.referenceCount=references.length;
      if(references.length!==1)return facts;
      facts.referenceWidth=references[0].getBoundingClientRect().width;
      if(!finite(facts.referenceWidth)||facts.referenceWidth<=0)failure("Isolated reference has no measurable border-box");
    }
  }
  if(args.property==="opacity") {
    let current=element,effective=1,depth=0;
    while(current) {
      const text=getComputedStyle(current).opacity;
      const opacity=Number(text);
      if(typeof text!=="string"||!text||!finite(opacity)||opacity<0||opacity>1)failure("Invalid isolated ancestor opacity");
      effective*=opacity;
      if(++depth>2048)failure("Isolated ancestor opacity exceeds bound");
      const root=current.getRootNode();
      current=current.assignedSlot||current.parentElement||(root instanceof ShadowRoot?root.host:null);
    }
    facts.effectiveOpacity=effective;
  }
  if(args.property==="transform") {
    if(typeof DOMMatrixReadOnly!=="function")failure("Isolated DOMMatrixReadOnly unavailable");
    facts.matrix=Array.from(new DOMMatrixReadOnly(computed==="none"?undefined:computed).toFloat64Array());
    if(facts.matrix.length!==16||!facts.matrix.every(finite))failure("Isolated transform lacks a complete finite matrix");
  }
  return facts;
}

async function observeFixedBrowserFacts(context,page,step) {
  let session;
  try {
    session=await context.newCDPSession(page);
    const contexts=new Map();
    session.on("Runtime.executionContextCreated",event=>contexts.set(event.context.id,event.context));
    await session.send("Runtime.enable");
    const tree=await session.send("Page.getFrameTree");
    const frameId=tree?.frameTree?.frame?.id;
    if(typeof frameId!=="string"||!frameId)throw new Error("Missing isolated observer frame");
    const worldName="evolution-fixed-observer-"+randomUUID();
    // grantUniveralAccess is the historical spelling in the pinned CDP protocol.
    const created=await session.send("Page.createIsolatedWorld",{frameId,worldName,grantUniveralAccess:false});
    const realm=contexts.get(created.executionContextId);
    if(!realm||realm.name!==worldName||realm.auxData?.frameId!==frameId||realm.auxData?.isDefault!==false||realm.auxData?.type!=="isolated"
      ||typeof realm.uniqueId!=="string"||!realm.uniqueId)throw new Error("Could not independently bind a non-default isolated realm");
    const args={action:step.action,selector:step.selector};
    if(step.action==="scroll-position")args.axis=step.axis??"y";
    if(step.action==="computed-style") {
      args.property=step.property;args.mode=step.mode;
      if(step.mode==="parent-relative")args.relativeTo=step.relativeTo;
    }
    const response=await session.send("Runtime.callFunctionOn",{
      functionDeclaration:collectFixedIsolatedBrowserFacts.toString(),uniqueContextId:realm.uniqueId,
      arguments:[{value:args}],returnByValue:true,awaitPromise:true,silent:true,userGesture:false,
    });
    if(response.exceptionDetails||!response.result||response.result.type!=="object"||!response.result.value)
      throw new Error("Isolated fixed observation did not return a complete value");
    return response.result.value;
  }catch(error){throw browserCapabilityError("Isolated browser observation unavailable: "+String(error));}
  finally{await session?.detach().catch(()=>{});}
}
`;