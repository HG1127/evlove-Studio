import {OutcomeObservationIdentitySchema,type OutcomeMetricSample} from "@evolution/contracts";

/** Poll time and warehouse row ID never establish independent experimental units. */
export function qualifyOutcomeObservations(rows:OutcomeMetricSample[]){
  const candidates:Array<{sample:OutcomeMetricSample;unit:string;key:string;signature:string}>=[];
  const bindings=new Map<string,string>(),conflicts=new Set<string>();
  const signatures=new Map<string,string>();
  for(const sample of rows){
    const identity=OutcomeObservationIdentitySchema.safeParse(sample.observation);
    if(!identity.success||identity.data.kind!=="independent-task")continue;
    const unit=JSON.stringify([sample.source.trim(),identity.data.taskId]);
    const binding=JSON.stringify([sample.workspaceId,sample.missionId,sample.candidateId,sample.deploymentId,sample.arm]);
    if(bindings.has(unit)&&bindings.get(unit)!==binding)conflicts.add(unit);
    bindings.set(unit,binding);
    const key=JSON.stringify([unit,sample.metricKey,sample.segment]);
    const signature=JSON.stringify([binding,sample.value,sample.metricKind,sample.direction,sample.unit??null,Date.parse(sample.observedAt)]);
    if(signatures.has(key)&&signatures.get(key)!==signature)conflicts.add(unit);
    signatures.set(key,signature);
    candidates.push({sample,unit,key,signature});
  }
  const unique=new Map<string,OutcomeMetricSample>();
  for(const row of candidates)if(!conflicts.has(row.unit)&&!unique.has(row.key))unique.set(row.key,row.sample);
  const samples=[...unique.values()];
  return {samples,excludedCount:rows.length-samples.length,conflictCount:conflicts.size};
}
