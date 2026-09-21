// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {nextProductionMonitorDelay,productionMonitorIntervalMs} from "./production-monitor";

const previous=process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS;

function project(input?:{status?:string;healthy?:boolean;observationStatus?:string;observations?:number}){
  const at="2026-09-21T04:00:00.000Z";
  const count=input?.observations??1;
  return {
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel"},
    experimentRun:{winnerId:"C1"},
    searchChampion:{candidate:{id:"C1"}},
    release:{
      status:input?.status??"promoted",
      candidateId:"C1",
      deploymentId:"dpl-c1",
      trafficPercent:100,
      kpis:[],
      evidenceMode:"live",
      environment:"production",
      healthy:input?.healthy??true,
      observationStatus:input?.observationStatus??"healthy",
      observedAt:at,
      history:[],
      observations:Array.from({length:count},(_,index)=>({
        id:"obs-"+index,
        at:new Date(Date.parse(at)-index*60_000).toISOString(),
        source:"reconcile" as const,
        action:"reconcile" as const,
        candidateId:"C1",
        deploymentId:"dpl-c1",
        evidenceMode:"live" as const,
        environment:"production",
        healthy:true,
        observationStatus:"healthy" as const,
        reason:"ok",
      })),
    },
  } as unknown as EvolveProject;
}

describe("production durable monitor",()=>{
  beforeEach(()=>{delete process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS;});
  afterEach(()=>{
    if(previous===undefined)delete process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS;
    else process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS=previous;
  });

  it("uses a bounded five-minute default monitor interval",()=>{
    expect(productionMonitorIntervalMs()).toBe(300_000);
    process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS="1";
    expect(productionMonitorIntervalMs()).toBe(60_000);
    process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS="999999";
    expect(productionMonitorIntervalMs()).toBe(3_600_000);
  });

  it("sleeps only after a live terminal decision that still lacks a healthy streak",()=>{
    const decision=nextProductionMonitorDelay(project({observations:1}),"2026-09-21T04:00:00.000Z");
    expect(decision).toMatchObject({delayMs:300_000,trend:{status:"healthy-insufficient"}});
  });

  it("does not sleep after stable healthy evidence is established",()=>{
    expect(nextProductionMonitorDelay(project({observations:2}),"2026-09-21T04:00:00.000Z")).toBeUndefined();
  });

  it("does not delay non-terminal release recovery",()=>{
    const value=project({status:"shadow",observations:1});
    expect(nextProductionMonitorDelay(value,"2026-09-21T04:00:00.000Z")).toBeUndefined();
  });
});
