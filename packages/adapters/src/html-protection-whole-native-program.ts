/** Fixed native program evaluated only in a controller-created isolated Chromium world. */
export const HTML_PROTECTION_WHOLE_NATIVE_PROGRAM = String.raw`
function observeOwnedWholeRuntime(args) {
  const apply=Reflect.apply,desc=Object.getOwnPropertyDescriptor;
  const getter=(p,n)=>{const d=desc(p,n);if(typeof d?.get!=="function")throw Error("native-unavailable");return o=>apply(d.get,o,[]);};
  const elementFromPoint=Document.prototype.elementFromPoint,contains=Node.prototype.contains;
  const query=Document.prototype.querySelectorAll,elQuery=Element.prototype.querySelectorAll,matches=Element.prototype.matches;
  const attr=Element.prototype.getAttribute,attrs=getter(Element.prototype,"attributes"),nodeName=getter(Node.prototype,"nodeName"),ns=getter(Element.prototype,"namespaceURI");
  const parent=getter(Node.prototype,"parentElement"),children=getter(Element.prototype,"children"),text=getter(Node.prototype,"textContent"),outer=getter(Element.prototype,"outerHTML");
  const attrName=getter(Attr.prototype,"name"),attrValue=getter(Attr.prototype,"value"),inputValue=getter(HTMLInputElement.prototype,"value");
  const getAnimations=Document.prototype.getAnimations,animationState=getter(Animation.prototype,"playState");
  const computed=window.getComputedStyle,rect=Element.prototype.getBoundingClientRect,cssItem=CSSStyleDeclaration.prototype.item,cssValue=CSSStyleDeclaration.prototype.getPropertyValue;
  const cssLength=getter(CSSStyleDeclaration.prototype,"length"),encode=TextEncoder.prototype.encode,encoder=new TextEncoder();
  const bounded=value=>{const encoded=JSON.stringify(value);if(encoded.length>args.maximumBytes||apply(encode,encoder,[encoded]).length>args.maximumBytes)throw Error("native-limit");return value;};
  const attribute=(e,n)=>apply(attr,e,[n]);
  const attributeList=e=>{const a=Array.from(attrs(e));if(a.length>128)throw Error("native-limit");return a.map(v=>[attrName(v),attrValue(v)]);};
  const all=Array.from(apply(query,document,["*"]));if(all.length>args.maximumNodes)throw Error("native-limit");
  const path=e=>{const pieces=[];let n=e;while(n){const p=parent(n),siblings=p?Array.from(children(p)):[document.documentElement];pieces.unshift(nodeName(n).toLowerCase()+":nth-child("+(siblings.indexOf(n)+1)+")");n=p;if(pieces.length>128)throw Error("native-limit");}return pieces.join(" > ");};
  const style=(e,pseudo=null)=>{const s=apply(computed,window,[e,pseudo]),length=cssLength(s);if(length>args.maximumProperties)throw Error("native-limit");const out=[];for(let i=0;i<length;i++){const name=apply(cssItem,s,[i]);out.push([name,apply(cssValue,s,[name])]);}return out;};
  const closestCard=e=>{let n=e;while(n){if(apply(matches,n,["article.slide-card"]))return attribute(n,"id");n=parent(n);}return null;};
  if(args.mode==="viewport")return {viewport:{width:window.innerWidth,height:window.innerHeight},scroll:{x:window.scrollX,y:window.scrollY},documentSize:{width:getter(Element.prototype,"scrollWidth")(document.documentElement),height:getter(Element.prototype,"scrollHeight")(document.documentElement)}};
  if(args.mode==="properties"){
    const strings=[],stringIds=new Map(),styleRows=[],styleIds=new Map(),elements=[];
    const intern=s=>{if(!stringIds.has(s)){stringIds.set(s,strings.length);strings.push(s);}return stringIds.get(s);};
    const internStyle=s=>{const row=s.map(([name,value])=>[intern(name),intern(value)]),key=JSON.stringify(row);if(!styleIds.has(key)){styleIds.set(key,styleRows.length);styleRows.push(row);}return styleIds.get(key);};
    for(const e of all){const r=apply(rect,e,[]);elements.push({sourcePath:path(e),tag:nodeName(e),id:attribute(e,"id"),namespace:ns(e),bounds:[r.x,r.y,r.width,r.height],styles:internStyle(style(e)),beforeStyles:internStyle(style(e,"::before")),afterStyles:internStyle(style(e,"::after")),markerStyles:internStyle(style(e,"::marker"))});}
    const activeAnimations=apply(getAnimations,document,[]).filter(animation=>["running","pending"].includes(animationState(animation))).length;
    return bounded({elementCount:all.length,activeAnimations,viewport:{width:window.innerWidth,height:window.innerHeight},scroll:{x:window.scrollX,y:window.scrollY},documentSize:{width:getter(Element.prototype,"scrollWidth")(document.documentElement),height:getter(Element.prototype,"scrollHeight")(document.documentElement)},styleTable:{strings,styleRows,elements}});
  }
  if(args.mode==="census"){
    const targets=[];const revealTargets=[];let foreign=0;
    for(const e of all){if(ns(e)!=="http://www.w3.org/1999/xhtml"){foreign++;continue;}
      const classes=(attribute(e,"class")||"").split(/\s+/).filter(Boolean),tag=nodeName(e),id=attribute(e,"id"),p=path(e);
      if(classes.includes("reveal"))revealTargets.push({targetId:"reveal:"+revealTargets.length,selector:p,sourcePath:p});
      if(!apply(matches,e,["button,input,select,textarea,summary,a[href],[role='button'],[tabindex],[contenteditable],.check-item"]))continue;
      const kind=tag==="INPUT"&&id==="search"?"search":classes.some(c=>["copy-slide","copy-btn","prompt-copy-all"].includes(c))?"copy":id==="menuBtn"?"menu":id==="toTop"?"top":tag==="A"&&((attribute(e,"href")||"").startsWith("#"))?"anchor":classes.includes("check-item")?"check":tag==="SUMMARY"?"details":"unknown";
      let selector=p;if(id&&Array.from(apply(query,document,["[id]"])).filter(n=>attribute(n,"id")===id).length===1){selector='[id="'+Array.from(id,c=>'\\'+c.codePointAt(0).toString(16)+' ').join('')+'"]';}
      targets.push({targetId:"native-control:"+targets.length,selector,sourcePath:p,tag,namespace:ns(e),id,classNames:classes,
        attributes:attributeList(e),kind,ownerCardId:closestCard(e),href:tag==="A"?attribute(e,"href"):null});
    }
    return bounded({elementCount:all.length,controls:targets,revealTargets,gaps:[...(foreign?["foreign-native-elements"]:[]),...(targets.some(t=>t.kind==="unknown")?["unknown-native-control"]:[])]});
  }
  if(args.mode==="hit-test"){const found=Array.from(apply(query,document,[args.selector]));if(found.length!==1)throw Error("target-not-unique");const hit=apply(elementFromPoint,document,[args.x,args.y]);return {hit:Boolean(hit&&(hit===found[0]||apply(contains,found[0],[hit])))};}
  if(args.mode==="select"){const found=Array.from(apply(query,document,[args.selector]));if(found.length!==1)throw Error("target-not-unique");return found[0];}
  if(args.mode==="clipboard-write"){
    const clip=apply(desc(Navigator.prototype,"clipboard").get,navigator,[]);return apply(Promise.prototype.then,apply(Clipboard.prototype.writeText,clip,[args.sentinel]),[()=>({written:true})]);
  }
  if(args.mode==="clipboard-read"){
    const clip=apply(desc(Navigator.prototype,"clipboard").get,navigator,[]);return apply(Promise.prototype.then,apply(Clipboard.prototype.readText,clip,[]),[value=>bounded({text:value})]);
  }
  const selected=Array.from(apply(query,document,[args.selector]));if(selected.length!==1)throw Error("target-not-unique");const e=selected[0],r=apply(rect,e,[]),tag=nodeName(e);
  const globals=Array.from(apply(query,document,["html,body,#progress,#toast,#searchCount,.sidebar,.sidebar a,.checklist-progress,.check-progress,.chapter,.slide-card"]))
    .map(n=>({tag:nodeName(n),id:attribute(n,"id"),attributes:attributeList(n),...(apply(matches,n,["#toast,#searchCount,.checklist-progress,.check-progress"])?{text:text(n)}:{})}));
  return bounded({elementCount:all.length,target:{tag,namespace:ns(e),hovered:apply(matches,e,[":hover"]),attributes:attributeList(e),text:text(e),outerHtml:outer(e),
      ...(tag==="INPUT"?{value:inputValue(e)}:{}),parentAttributes:parent(e)?attributeList(parent(e)):null,bounds:[r.x,r.y,r.width,r.height],styles:style(e),beforeStyles:style(e,"::before"),afterStyles:style(e,"::after")},
    documentSize:{width:getter(Element.prototype,"scrollWidth")(document.documentElement),height:getter(Element.prototype,"scrollHeight")(document.documentElement)},rootScrollPaddingTop:apply(cssValue,apply(computed,window,[document.documentElement]),["scroll-padding-top"]),documentUrl:window.location.href,viewport:{width:window.innerWidth,height:window.innerHeight},scroll:{x:window.scrollX,y:window.scrollY},globals});
}
`;
