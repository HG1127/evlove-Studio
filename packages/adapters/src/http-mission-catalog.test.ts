import {afterEach,expect,it,vi} from "vitest";
import {readHttpMissionCatalog} from "./http-mission-catalog";
afterEach(()=>vi.unstubAllGlobals());
it("uses the authenticated origin without caching and propagates cancellation",async()=>{const fetch=vi.fn(async()=>Response.json({schemaVersion:"mission-catalog-v1",workspaceId:"w",directoryComplete:true,entries:[]}));vi.stubGlobal("fetch",fetch);const controller=new AbortController();expect((await readHttpMissionCatalog("/api/evolution/",controller.signal))?.directoryComplete).toBe(true);expect(fetch).toHaveBeenCalledWith("/api/evolution/mission-catalog",{cache:"no-store",signal:controller.signal});});
it.each([401,403,503])("fails explicitly on HTTP %s",async status=>{vi.stubGlobal("fetch",async()=>Response.json({}, {status}));await expect(readHttpMissionCatalog("/api/evolution")).rejects.toThrow("HTTP "+status);});
it("supports an older backend only on 404",async()=>{vi.stubGlobal("fetch",async()=>Response.json({}, {status:404}));expect(await readHttpMissionCatalog("/api/evolution")).toBeUndefined();});
it("sanitizes malformed private responses",async()=>{vi.stubGlobal("fetch",async()=>new Response('{"private":"do-not-echo'));await expect(readHttpMissionCatalog("/api/evolution")).rejects.toThrow("项目目录数据未通过完整性校验。");});
