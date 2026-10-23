import type {EvaluationResult} from "@evolution/contracts";

type Metrics=Pick<EvaluationResult,"averageCost"|"averageLatencyMs">;
function relativeChange(current:number|undefined,baseline:number|undefined,direction:1|-1){
  if(current===undefined||baseline===undefined||!Number.isFinite(current)||!Number.isFinite(baseline)||current<0||baseline<0)return {value:0,known:false};
  if(baseline===0)return {value:0,known:current===0};
  const value=(current/baseline-1)*100*direction;
  return Number.isFinite(value)?{value:value===0?0:Number(value.toFixed(1)),known:true}:{value:0,known:false};
}
/** Relative percentages require a measured denominator; missing comparisons never claim improvement. */
export function candidateMetricDeltas(evaluation:Metrics|undefined,baseline:Metrics|undefined){
  const cost=relativeChange(evaluation?.averageCost,baseline?.averageCost,1);
  const speed=relativeChange(evaluation?.averageLatencyMs,baseline?.averageLatencyMs,-1);
  return {costDelta:cost.value,speedDelta:speed.value,costDeltaKnown:cost.known,speedDeltaKnown:speed.known};
}
