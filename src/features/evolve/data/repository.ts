import { EvolveProjectSchema, type EvolveProject } from "../schemas";
import { demoProject } from "./mock-project";

export interface EvolveRepository { getProject(id: string): Promise<EvolveProject>; }
class MockRepository implements EvolveRepository { async getProject() { return EvolveProjectSchema.parse(demoProject); } }
class HttpRepository implements EvolveRepository {
  private readonly baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl = baseUrl; }
  async getProject(id: string) { const res = await fetch(`${this.baseUrl}/api/v1/evolve-projects/${id}`, { cache:"no-store" }); if (!res.ok) throw new Error(`Failed to load project: ${res.status}`); return EvolveProjectSchema.parse(await res.json()); }
}
// 原 Next 版读 process.env.EVOLVE_DATA_SOURCE / EVOLVE_API_BASE_URL;
// Vite 浏览器端等价读 import.meta.env.VITE_EVOLVE_*, 默认仍走 Mock。
export function getEvolveRepository(): EvolveRepository {
  const source = import.meta.env.VITE_EVOLVE_DATA_SOURCE;
  const baseUrl = import.meta.env.VITE_EVOLVE_API_BASE_URL;
  return source === "api" && baseUrl ? new HttpRepository(baseUrl) : new MockRepository();
}
