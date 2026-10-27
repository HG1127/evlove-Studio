import {
  OutcomeAnalyticsResponseSchema,
  OUTCOME_MEASUREMENT_POLICY,
  type OutcomeAnalyticsResponse,
  type OutcomeMetricAnalysis,
  type OutcomeMetricSample,
  type OutcomeSummary,
  type BusinessBenefitPolicy,
} from "@evolution/contracts";
import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "./release-outcome";
import {qualifyOutcomeObservations} from "./outcome-observation-identity";
import {assessBusinessBenefit} from "./business-benefit";

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
    const key=row.metricKey+"\u0000"+row.segment;
    const group=map.get(key)??{segment:row.segment,rows:[]};
    group.rows.push(row);map.set(key,group);
  }
  return [...map.values()];
}

function assertComparableMetricContracts(samples:OutcomeMetricSample[]){
  const contracts=new Map<string,string>();
  for(const sample of samples){
    const contract=[
      sample.metricKind,
      sample.direction,
      sample.unit?.trim()??"",
      sample.source.trim(),
    ].join("\u0000");
    const existing=contracts.get(sample.metricKey);
    if(existing&&existing!==contract){
      throw new Error(
        `Outcome metric ${sample.metricKey} has inconsistent kind/direction/unit/source and cannot be compared safely`,
      );
    }
    contracts.set(sample.metricKey,contract);
  }
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

function deploymentScopeIssue(samples:OutcomeMetricSample[]){
  const idsFor=(arm:OutcomeMetricSample["arm"])=>new Set(samples
    .filter((sample)=>sample.arm===arm)
    .map((sample)=>sample.deploymentId??""));
  const stable=idsFor("stable");
  const candidate=idsFor("candidate");
  if(stable.size>1||candidate.size>1){
    return "Outcome 样本跨多个 Deployment 或缺少部分 Deployment 身份，不能合并为同一次 Stable/Candidate 比较。";
  }
  if(stable.has("")||candidate.has("")){
    return "Outcome 样本缺少 Deployment 身份，不能确认它属于本次 Release。";
  }
  const stableId=[...stable][0];
  const candidateId=[...candidate][0];
  if(stableId&&candidateId&&stableId===candidateId){
    return "Stable 和 Candidate 样本绑定同一个 Deployment，不能作为两个独立实验组比较。";
  }
  return undefined;
}
export function analyzeOutcomeSamples(input:{
  missionId:string;
  candidateId?:string;
  samples:OutcomeMetricSample[];
  minimumSamplesPerArm:number;
  requiredMetricScopes?:ReadonlyArray<{metricKey:string;segment:string;source?:string}>;
  telemetryConfigurationError?:string;
  businessBenefitPolicy?:BusinessBenefitPolicy;
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
  const scoped=input.samples.filter((sample)=>{
    if(sample.missionId!==input.missionId)return false;
    if(candidateId&&sample.candidateId!==candidateId)return false;
    const observedAt=Date.parse(sample.observedAt);
    return Number.isFinite(observedAt)&&observedAt<=checkedAtMs+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS;
  });
  const qualified=qualifyOutcomeObservations(scoped),samples=qualified.samples;
  const businessBenefit=input.businessBenefitPolicy?assessBusinessBenefit({policy:input.businessBenefitPolicy,samples:scoped,checkedAt,
    configurationError:input.telemetryConfigurationError}):undefined;
  const dropped=input.samples.length-scoped.length;
  const measurement={measurementPolicy:OUTCOME_MEASUREMENT_POLICY,independentSampleCount:samples.length,
    excludedSampleCount:qualified.excludedCount,droppedSampleCount:dropped,observationConflictCount:qualified.conflictCount};
  const scopeIssue=new Set(scoped.map(sample=>sample.workspaceId)).size>1?"Outcome 样本混合了多个 Workspace。":deploymentScopeIssue(scoped);
  if(scopeIssue){
    return OutcomeAnalyticsResponseSchema.parse({
      missionId:input.missionId,candidateId,checkedAt,sampleCount:scoped.length,...measurement,
      minimumSamplesPerArm:input.minimumSamplesPerArm,
      metrics:[],drift:[],regressions:[],verdict:"insufficient",...(businessBenefit?{businessBenefit}:{}),
      message:scopeIssue+" 请按单一 Release 部署周期补齐可比样本。",
    });
  }
  assertComparableMetricContracts(scoped);
  const grouped=groups(samples);
  const metrics=grouped.map((group)=>analyzeGroup(group.rows,group.segment,input.minimumSamplesPerArm));
  const driftRows=grouped.map((group)=>drift(group.rows,group.segment,input.minimumSamplesPerArm));
  const regressions=metrics.filter((metric)=>metric.significance==="significant-regression").map((metric)=>({
    metricKey:metric.metricKey,
    segment:metric.segment,
    kind:metric.metricKind,
    reason:`${metric.metricKey}/${metric.segment}: Candidate ${metric.candidate.mean} vs Stable ${metric.stable.mean}; p≈${metric.pValueApprox?.toFixed(4)}`,
  }));
  const observedScopeSources=new Map(grouped.map((group)=>[
    group.rows[0]!.metricKey+"\u0000"+group.segment,
    group.rows[0]!.source,
  ] as const));
  const requiredScopes=new Map((input.requiredMetricScopes??[])
    .map((scope)=>[scope.metricKey+"\u0000"+scope.segment+"\u0000"+(scope.source??""),scope] as const));
  const missingConfigured=[...requiredScopes.values()]
    .filter((scope)=>{
      const observedSource=observedScopeSources.get(scope.metricKey+"\u0000"+scope.segment);
      return observedSource===undefined||(scope.source!==undefined&&observedSource!==scope.source);
    })
    .map((scope)=>`${scope.metricKey}/${scope.segment}${scope.source?` (${scope.source})`:""}: Stable 0, Candidate 0`);
  const incompleteScopes=[
    ...metrics.filter((metric)=>metric.evidenceStatus==="insufficient")
      .map((metric)=>`${metric.metricKey}/${metric.segment}: Stable ${metric.stable.count}, Candidate ${metric.candidate.count}`),
    ...missingConfigured,
  ];
  const insufficient=metrics.length===0||incompleteScopes.length>0||Boolean(input.telemetryConfigurationError)||qualified.conflictCount>0||businessBenefit?.status==="insufficient";
  const drifting=driftRows.some((item)=>item.status==="drifting");
  const verdict=regressions.length?"regression":insufficient?"insufficient":drifting||businessBenefit?.status==="failed"?"watch":"healthy";
  return OutcomeAnalyticsResponseSchema.parse({
    missionId:input.missionId,
    candidateId,
    checkedAt,
    sampleCount:scoped.length,
    ...measurement,
    minimumSamplesPerArm:input.minimumSamplesPerArm,
    metrics,
    ...(businessBenefit?{businessBenefit}:{}),
    drift:driftRows,
    regressions,
    verdict,
    message:(verdict==="insufficient"
      ?`每个 Stable/Candidate arm 至少需要 ${input.minimumSamplesPerArm} 个独立任务样本。`
      :verdict==="regression"
        ?`检测到 ${regressions.length} 个统计回归。`
        :verdict==="watch"
          ?businessBenefit?.status==="failed"?"业务任务门槛未通过，需要继续验证。":"未检测到显著回归，但 Candidate 时间漂移需要继续观察。"
          :"当前样本未检测到显著回归。")
      +(incompleteScopes.length?` 证据不足：${incompleteScopes.slice(0,5).join("；")}${incompleteScopes.length>5?"；等更多分段":""}。`:"")
      +(input.telemetryConfigurationError?` Telemetry 配置不可用：${input.telemetryConfigurationError}。`:"")
      +(qualified.excludedCount?` 已排除 ${qualified.excludedCount} 个缺少任务身份、汇总轮询、重复或冲突记录。`:"")
      +(qualified.conflictCount?` ${qualified.conflictCount} 个任务身份存在内容或部署冲突，不能证明改善。`:"")
      +(dropped?` 已忽略 ${dropped} 个跨 Candidate、无效时间或超前时间样本。`:"")
      +(businessBenefit?` 业务任务检查：${businessBenefit.reason}`:""),
  });
}
