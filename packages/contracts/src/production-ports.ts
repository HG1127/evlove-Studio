import type { EvolveProject } from "./evolve-schemas";
import type { EvolutionEvent, EventStorePort } from "./event-contract";
import type { EvolutionJob, JobStorePort } from "./job-contract";
import type {ArtifactBinding,ArtifactMetadata} from "./artifact-contract";

export interface MissionStorePort {
  initialize(): Promise<void>;
  list(): Promise<EvolveProject[]>;
  get(id:string): Promise<EvolveProject|undefined>;
  save(project:EvolveProject): Promise<void>;
  delete(id:string): Promise<void>;
  flush(): Promise<void>;
}

export interface ArtifactStorePort {
  put(id:string,blob:Blob,binding?:ArtifactBinding):Promise<void>;
  get(id:string):Promise<Blob|undefined>;
  getMetadata?(id:string):Promise<ArtifactMetadata|undefined>;
  delete(id:string):Promise<void>;
}

export interface ProductionRuntimePorts {
  missions: MissionStorePort;
  jobs: JobStorePort;
  events: EventStorePort;
  artifacts: ArtifactStorePort;
}

export type ProductionRuntimePortName = keyof ProductionRuntimePorts;

export const PRODUCTION_PORTS = [
  {id:"missions",label:"Mission Store",backend:"Supabase PostgreSQL / API"},
  {id:"jobs",label:"Job Store",backend:"Vercel Workflow + Supabase job metadata"},
  {id:"events",label:"Event Store",backend:"Supabase append-only events + Realtime"},
  {id:"artifacts",label:"Artifact Store",backend:"Supabase Storage"},
] as const;

export type { EvolutionEvent, EvolutionJob };
