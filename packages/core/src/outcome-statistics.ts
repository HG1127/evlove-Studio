import {
  OutcomeAnalyticsResponseSchema,
  type OutcomeAnalyticsResponse,
  type OutcomeMetricAnalysis,
  type OutcomeMetricSample,
  type OutcomeSummary,
} from "@evolution/contracts";
import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "./release-outcome";

function mean(values:number[]){
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:undefined;
}

function summary(values:number[]):OutcomeSummary{
  if(!values.length)return {count:0};
  const average=mean(values)!;
  const variance=values.length>1
    ?values.reduce((sum,value)=>sum+(value-average)**2,0)/(values.length-1)
    :0;
  return {
    count:values.length,
    mean:average,
    stddev:Math.sqrt(Math.max(0,variance)),
    min:Math.min(...values),
    max:Math.max(...values),
  };
}

function erf(value:number){
  const sign=value<0?-1:1;
  const x=Math.abs(value);
  const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t)*Math.exp(-x*x);
  return sign*y;
}

function pValue(z:number){
  const cdf=0.5*(1+erf(Math.abs(z)/Math.sqrt(2)));
  return Math.max(0,Math.min(1,2*(1-cdf)));
}

function analyzeGroup(rows:OutcomeMetricSample[],segment:string,minPerArm:number):OutcomeMetricAnalysis{
  const first=rows[0]!;
  const stable=summary(rows.filter((row)=>row.arm==="stable").map((row)=>row.value));
  const candidate=summary(rows.filter((row)=>row.arm==="candidate").map((row)=>row.value));
  const base={
    metricKey:first.metricKey,
    metricKind:first.metricKind,
    direction:first.direction,
    unit:first.unit,
    segment,
    stable,
    candidate,
  };
  if(stable.count<minPerArm||candidate.count<minPerArm||stable.mean===undefined||candidate.mean===undefined){
    return {...base,evidenceStatus:"insufficient",significance:"insufficient"};
  }
  const delta=candidate.mean-stable.mean;
  const relativeDelta=Math.abs(stable.mean)>1e-12?delta/Math.abs(stable.mean):undefined;
  const standardError=Math.sqrt(
    ((stable.stddev??0)**2)/stable.count+((candidate.stddev??0)**2)/candidate.count,
  );
  const zScore=standardError>1e-12?delta/standardError:delta===0?0:Math.sign(delta)*1e9;
  const pValueApprox=pValue(zScore);
  const favorable=first.direction==="higher"?delta>0:delta<0;
  const significance=pValueApprox<0.05
    ?favorable?"significant-improvement" as const:"significant-regression" as const
    :"not-significant" as const;
  return {
    ...base,delta,relativeDelta,standardError,zScore,pValueApprox,
    evidenceStatus:"estimated",significance,favorable,
  };
}

function groups(samples:OutcomeMetricSample[]){
  const map=new Map<string,{segment:string;rows:OutcomeMetricSample[]}>();
  for(const row of samples){
    const allKey=row.metricKey+"\u0000all";
    const all=map.get(allKey)??{segment:"all",rows:[]};
    all.rows.push(row);map.set(allKey,all);
    if(row.segment!=="all"){
      const key=row.metricKey+"\u0000"+row.segment;
      const group=map.get(key)??{segment:row.segment,rows:[]};
      group.rows.push(row);map.set(key,group);
    }
  }
  return [...map.values()];
}

function drift(rows:OutcomeMetricSample[],segment:string,minPerArm:number){
  const candidate=rows.filter((row)=>row.arm==="candidate")
    .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const window=Math.max(5,Math.min(minPerArm,20));
  if(candidate.length<window*2){
    return {metricKey:rows[0]!.metricKey,segment,older:{count:0},recent:{count:0},status:"insufficient" as const};
  }
  const split=Math.floor(candidate.length/2);
  const older=summary(candidate.slice(0,split).map((row)=>row.value));
  const recent=summary(candidate.slice(split).map((row)=>row.value));
  const scale=(older.stddev??0)>1e-12
    ?older.stddev!
    :Math.max(Math.abs(older.mean??0)*0.05,1e-9);
  const standardizedShift=((recent.mean??0)-(older.mean??0))/scale;
  return {
    metricKey:rows[0]!.metricKey,segment,older,recent,standardizedShift,
    status:Math.abs(standardizedShift)>=1?"drifting" as const:"stable" as const,
  };
}

export function analyzeOutcomeSamples(input:{
  missionId:string;
  candidateId?:string;
  samples:OutcomeMetricSample[];
  minimumSamplesPerArm:number;
  checkedAt?:string;
}):OutcomeAnalyticsResponse{
  const checkedAt=input.checkedAt??new Date().toISOString();
  const checkedAtMs=Date.parse(checkedAt);
  if(!Number.isFinite(checkedAtMs))throw new Error("Outcome analysis checkedAt is invalid");
  const candidateIds=[...new Set(input.samples.map((sample)=>sample.candidateId).filter((value):value is string=>Boolean(value)))];
  if(!input.candidateId&&candidateIds.length>1){
    throw new Error("Outcome analysis candidateId is required when multiple Candidates are present");
  }
  const candidateId=input.candidateId??candidateIds[0];
  const samples=input.samples.filter((sample)=>{
    if(candidateId&&sample.candidateId!==candidateId)return false;
    const observedAt=Date.parse(sample.observedAt);
    return Number.isFinite(observedAt)&&observedAt<=checkedAtMs+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS;
  });
  const dropped=input.samples.length-samples.length;
  const grouped=groups(samples);
  const metrics=grouped.map((group)=>analyzeGroup(group.rows,group.segment,input.minimumSamplesPerArm));
  const driftRows=grouped.map((group)=>drift(group.rows,group.segment,input.minimumSamplesPerArm));
  const regressions=metrics.filter((metric)=>metric.significance==="significant-regression").map((metric)=>({
    metricKey:metric.metricKey,
    segment:metric.segment,
    kind:metric.metricKind,
    reason:`${metric.metricKey}/${metric.segment}: Candidate ${metric.candidate.mean} vs Stable ${metric.stable.mean}; p≈${metric.pValueApprox?.toFixed(4)}`,
  }));
  const estimated=metrics.some((metric)=>metric.evidenceStatus==="estimated");
  const drifting=driftRows.some((item)=>item.status==="drifting");
  const verdict=!estimated?"insufficient":regressions.length?"regression":drifting?"watch":"healthy";
  return OutcomeAnalyticsResponseSchema.parse({
    missionId:input.missionId,
    candidateId,
    checkedAt,
    sampleCount:samples.length,
    minimumSamplesPerArm:input.minimumSamplesPerArm,
    metrics,
    drift:driftRows,
    regressions,
    verdict,
    message:(verdict==="insufficient"
      ?`每个 Stable/Candidate arm 至少需要 ${input.minimumSamplesPerArm} 个样本。`
      :verdict==="regression"
        ?`检测到 ${regressions.length} 个统计回归。`
        :verdict==="watch"
          ?"未检测到显著回归，但 Candidate 时间漂移需要继续观察。"
          :"当前样本未检测到显著回归。")
      +(dropped?` 已忽略 ${dropped} 个跨 Candidate、无效时间或超前时间样本。`:""),
  });
}
