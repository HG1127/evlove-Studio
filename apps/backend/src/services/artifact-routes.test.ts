// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { H3 } from "nitro/h3";
import put from "../../server/api/evolution/artifacts/[id].put";
import get from "../../server/api/evolution/artifacts/[id].get";
import remove from "../../server/api/evolution/artifacts/[id].delete";
const store = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock("./security-policy", () => ({ requireGovernedEvolutionPermission: vi.fn(async () => undefined) }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => store }));
const app = new H3().put("/artifacts/:id", put).get("/artifacts/:id", get).delete("/artifacts/:id", remove);
beforeEach(() => { vi.clearAllMocks(); store.get.mockResolvedValue(new Blob(["exact bytes"], { type: "text/plain" })); });
describe("Artifact HTTP identity", () => {
  it.each(["visual-evidence:mission:自动验证.png", "literal%2Fid", "folder/asset", "a#b?c"])("preserves ID through PUT/GET/DELETE: %s", async (id) => {
    const url = "http://localhost/artifacts/" + encodeURIComponent(id);
    const upload = await app.fetch(new Request(url, { method: "PUT", headers: { "content-type": "text/plain" }, body: "exact bytes" }));
    expect(upload.status).toBe(200);
    expect(await upload.json()).toMatchObject({ artifactId: id, size: 11 });
    expect(store.put).toHaveBeenCalledWith(id, expect.any(Blob));
    const download = await app.fetch(new Request(url));
    expect(await download.text()).toBe("exact bytes");
    expect(store.get).toHaveBeenCalledWith(id);
    const deletion = await app.fetch(new Request(url, { method: "DELETE" }));
    expect(await deletion.json()).toMatchObject({ artifactId: id });
    expect(store.delete).toHaveBeenCalledWith(id);
  });
  it.each(["%ZZ", "%E8", "a".repeat(201)])("rejects invalid encoded ID before storage: %s", async (segment) => {
    const response = await app.fetch(new Request("http://localhost/artifacts/" + segment));
    expect(response.status).toBe(400);
    expect(store.get).not.toHaveBeenCalled();
  });
});
