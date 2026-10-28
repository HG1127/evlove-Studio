type IssuedAnchor={anchorId:string;start:number;end:number};

/** Suggestions are feedback only. The caller still rejects every unknown ID unchanged. */
export function serverHtmlBuildAnchorFeedback(anchorId:string,anchors:readonly IssuedAnchor[],editIndex:number){
  const prefix=anchorId.split("-")[0]!,exact=anchors.filter(a=>a.anchorId.split("-")[0]===prefix);
  if(exact.length===1){
    const id=JSON.stringify(exact[0]!.anchorId),base=`Edit ${editIndex+1}: exact issued source ID: ${id}.`;
    const tail=" Unknown/shortened ID remains rejected. Copy the COMPLETE ID including its hash suffix; recheck before text. No automatic rebinding occurred.";
    return base.length+tail.length<=240?base+tail:base;
  }
  const match=/^t([0-9a-z]+)_[0-9a-z]+(?:-[0-9a-f]+)?$/.exec(anchorId),start=match?Number.parseInt(match[1]!,36):NaN;
  const nearby=Number.isSafeInteger(start)?[...anchors].sort((a,b)=>Math.abs(a.start-start)-Math.abs(b.start-start)||a.start-b.start).slice(0,2).map(a=>a.anchorId):[];
  const prefixMessage=`Edit ${editIndex+1}: unknown or duplicate issued anchorId; no exact source node. Nearby COMPLETE source IDs: `;
  while(nearby.length&&prefixMessage.length+JSON.stringify(nearby).length>240)nearby.pop();
  if(nearby.length){const base=prefixMessage+JSON.stringify(nearby),tail=". Recheck before text; never combine nodes or infer a binding.";return base.length+tail.length<=240?base+tail:base;}
  return `Edit ${editIndex+1}: unknown or duplicate issued anchorId. Copy one COMPLETE ID, including its hash suffix, from this Target's supplied body index. Do not reconstruct or combine nodes.`;
}
