import {
  createEvolutionEvent,
  type ConnectorWebhookEnvelope,
  type EvolveProject,
} from "@evolution/contracts";

function bindingError(code:string,message:string){
  const error=new Error(message);
  (error as Error&{code?:string}).code=code;
  return error;
}

type KnownVersion={
  role:"target-snapshot"|"candidate"|"champion";
  candidateId?:string;
};

function knownConnectorVersions(project:EvolveProject,connectorId:string,targetId:string){
  const known=new Map<string,KnownVersion>();
  const snapshot=project.targetConnection.connectorSnapshot;
  if(snapshot&&snapshot.connectorId===connectorId&&snapshot.targetId===targetId){
    known.set(snapshot.versionRef,{role:"target-snapshot"});
  }
  for(const candidate of project.candidates){
    const binding=candidate.connectorBinding;
    if(!binding||binding.connectorId!==connectorId||binding.targetId!==targetId)continue;
    known.set(binding.baseVersionRef,{role:"target-snapshot"});
    known.set(binding.versionRef,{role:"candidate",candidateId:candidate.id});
  }
  const champion=project.searchChampion?.candidate;
  const championBinding=champion?.connectorBinding;
  if(champion&&championBinding
    &&championBinding.connectorId===connectorId
    &&championBinding.targetId===targetId){
    known.set(championBinding.baseVersionRef,{role:"target-snapshot"});
    known.set(championBinding.versionRef,{role:"champion",candidateId:champion.id});
  }
  return known;
}

export function buildConnectorWebhookEvent(args:{
  mission:EvolveProject;
  connectorId:string;
  payload:ConnectorWebhookEnvelope;
  deliveryFingerprint?:string;
  at?:string;
}){
  const {mission,connectorId,payload}=args;
  if(!payload.missionId||payload.missionId!==mission.id){
    throw bindingError("CONNECTOR_WEBHOOK_MISSION_MISMATCH","Connector webhook Mission binding mismatch");
  }
  if(mission.targetConnection.adapter!=="connector"||mission.targetConnection.status!=="connected"){
    throw bindingError("CONNECTOR_WEBHOOK_TARGET_NOT_BOUND","Mission is not connected to a Connector Target");
  }
  const binding=mission.targetConnection.connector;
  if(!binding||binding.connectorId!==connectorId||binding.targetId!==payload.targetId){
    throw bindingError("CONNECTOR_WEBHOOK_TARGET_MISMATCH","Connector webhook target does not match Mission binding");
  }
  if(!payload.versionRef){
    throw bindingError("CONNECTOR_WEBHOOK_VERSION_REQUIRED","Mission-bound Connector webhook requires exact versionRef");
  }
  const matched=knownConnectorVersions(mission,connectorId,payload.targetId).get(payload.versionRef);
  if(!matched){
    throw bindingError(
      "CONNECTOR_WEBHOOK_VERSION_MISMATCH",
      `Connector webhook versionRef ${payload.versionRef} is not bound to the current Mission Target/Candidates`,
    );
  }
  const eventId=args.deliveryFingerprint
    ?`evt-connector-${args.deliveryFingerprint.slice(0,48)}`
    :undefined;
  return createEvolutionEvent({
    id:eventId,
    missionId:mission.id,
    type:"ActionCompleted",
    source:`connector-webhook:${connectorId}`,
    at:args.at,
    payload:{
      ...payload.payload,
      connectorId,
      targetId:payload.targetId,
      event:payload.event,
      versionRef:payload.versionRef,
      status:payload.status,
      bindingRole:matched.role,
      candidateId:matched.candidateId,
    },
  });
}
