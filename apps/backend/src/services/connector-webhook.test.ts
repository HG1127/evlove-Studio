// @vitest-environment node
import {describe,expect,it} from "vitest";
import type {ConnectorWebhookEnvelope,EvolveProject} from "@evolution/contracts";
import {buildConnectorWebhookEvent} from "./connector-webhook";

function mission(){
  const candidate={
    id:"C1",
    connectorBinding:{
      connectorId:"workflow-main",
      targetId:"workflow-42",
      baseVersionRef:"v42",
      versionRef:"v43",
      artifactFingerprint:"fp",
      evidenceRefs:[],
      observedAt:"now",
    },
  };
  return{
    id:"mission-connector-webhook",
    targetConnection:{
      adapter:"connector",
      connectionId:"connector",
      status:"connected",
      label:"Connector",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      connectorSnapshot:{
        connectorId:"workflow-main",
        targetId:"workflow-42",
        versionRef:"v42",
        snapshotRef:"snap42",
        artifactId:"source",
        observedAt:"now",
      },
    },
    candidates:[candidate],
    searchChampion:{candidate},
  } as unknown as EvolveProject;
}

function payload(overrides:Partial<ConnectorWebhookEnvelope>={}):ConnectorWebhookEnvelope{
  return{
    missionId:"mission-connector-webhook",
    targetId:"workflow-42",
    event:"validation.completed",
    versionRef:"v43",
    status:"ok",
    payload:{connectorId:"spoofed",targetId:"spoofed",versionRef:"spoofed",candidateId:"spoofed",detail:"kept"},
    ...overrides,
  };
}

describe("Connector webhook Mission binding",()=>{
  it("accepts only exact bound Candidate versions and keeps fixed audit identity authoritative",()=>{
    const event=buildConnectorWebhookEvent({
      mission:mission(),
      connectorId:"workflow-main",
      payload:payload(),
      at:"2026-09-22T06:00:00Z",
    });
    expect(event).toMatchObject({
      missionId:"mission-connector-webhook",
      source:"connector-webhook:workflow-main",
      at:"2026-09-22T06:00:00Z",
      payload:{
        connectorId:"workflow-main",
        targetId:"workflow-42",
        versionRef:"v43",
        candidateId:"C1",
        bindingRole:"champion",
        detail:"kept",
      },
    });
  });

  it("uses a deterministic event id for the same signed delivery fingerprint",()=>{
    const first=buildConnectorWebhookEvent({
      mission:mission(),
      connectorId:"workflow-main",
      payload:payload(),
      deliveryFingerprint:"a".repeat(64),
      at:"2026-09-22T06:00:00Z",
    });
    const retry=buildConnectorWebhookEvent({
      mission:mission(),
      connectorId:"workflow-main",
      payload:payload(),
      deliveryFingerprint:"a".repeat(64),
      at:"2026-09-22T06:01:00Z",
    });
    const different=buildConnectorWebhookEvent({
      mission:mission(),
      connectorId:"workflow-main",
      payload:payload(),
      deliveryFingerprint:"b".repeat(64),
    });
    expect(first.id).toBe("evt-connector-"+"a".repeat(48));
    expect(retry.id).toBe(first.id);
    expect(different.id).not.toBe(first.id);
  });

  it("accepts the locked Target snapshot version for target-level events",()=>{
    const event=buildConnectorWebhookEvent({
      mission:mission(),
      connectorId:"workflow-main",
      payload:payload({versionRef:"v42",event:"snapshot.updated"}),
    });
    expect(event.payload).toMatchObject({versionRef:"v42",bindingRole:"target-snapshot"});
  });

  it("rejects wrong connector or target bindings",()=>{
    expect(()=>buildConnectorWebhookEvent({
      mission:mission(),connectorId:"other",payload:payload(),
    })).toThrow(/target does not match/i);
    expect(()=>buildConnectorWebhookEvent({
      mission:mission(),connectorId:"workflow-main",payload:payload({targetId:"workflow-99"}),
    })).toThrow(/target does not match/i);
  });

  it("rejects missing and stale version refs instead of polluting the Mission event stream",()=>{
    expect(()=>buildConnectorWebhookEvent({
      mission:mission(),connectorId:"workflow-main",payload:payload({versionRef:undefined}),
    })).toThrow(/requires exact versionRef/i);
    expect(()=>buildConnectorWebhookEvent({
      mission:mission(),connectorId:"workflow-main",payload:payload({versionRef:"v-old"}),
    })).toThrow(/not bound to the current Mission/i);
  });
});
