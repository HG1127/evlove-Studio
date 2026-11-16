// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {BuildIdentityBadge} from "./build-identity-badge";

let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});
const render=()=>act(async()=>root.render(<BuildIdentityBadge/>));

it("shows an exact verified Lab Preview SHA from the read-only server endpoint",async()=>{
  const sha="cb90e50f4ec3ccb56d344a9886e28b1f120ed832";
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({
    commitSha:sha,commitRef:"codex/artifact-evolution-governance-p0",vercelEnvironment:"preview",
    deploymentHost:"evlove-studio-evolution-7zq0v0cv4-1248279806-7692s-projects.vercel.app",
    checkedAt:"2026-11-16T00:00:00.000Z",
  })});
  vi.stubGlobal("fetch",fetcher);
  await render();
  expect(fetcher).toHaveBeenCalledWith("/api/evolution/build-info",expect.objectContaining({cache:"no-store"}));
  const badge=host.querySelector('[role="status"]')!;
  expect(badge.textContent).toContain("Lab Preview · cb90e50f");
  expect(badge.getAttribute("title")).toContain(sha);
  expect(badge.getAttribute("title")).toContain("非功能验收通过证明");
});
it("never fabricates build identity when the API is unavailable or malformed",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("network unavailable")));
  await render();
  expect(host.textContent).toContain("版本未确认");
});
