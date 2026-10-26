// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {createVercelHtmlNativeRuntime} from "./vercel-runtime";
const mocks=vi.hoisted(()=>({create:vi.fn(),snapshot:vi.fn(),issue:vi.fn(),credentials:vi.fn()}));
vi.mock("@vercel/sandbox",()=>({Sandbox:{create:mocks.create}}));
vi.mock("../vercel-sandbox-adapter",()=>({ensureBrowserRuntimeSnapshot:mocks.snapshot}));
vi.mock("../vercel-sandbox-credentials",()=>({sandboxCredentialIssue:mocks.issue,getExplicitSandboxCredentials:mocks.credentials}));
beforeEach(()=>{
  vi.clearAllMocks();mocks.issue.mockReturnValue(undefined);mocks.snapshot.mockResolvedValue("synthetic-trusted-runtime");
  mocks.credentials.mockReturnValue({token:"synthetic-token",teamId:"team-synthetic",projectId:"project-synthetic"});
  mocks.create.mockResolvedValue({name:"synthetic-only"});
});
describe("ephemeral native HTML VM composition",()=>{
  it("forks the trusted browser runtime with no guest credentials, network access, persistence or public ports",async()=>{
    await createVercelHtmlNativeRuntime();
    const options=mocks.create.mock.calls[0]![0];
    expect(options).toMatchObject({source:{type:"snapshot",snapshotId:"synthetic-trusted-runtime"},networkPolicy:"deny-all",persistent:false,timeout:180_000,resources:{vcpus:2}});
    expect(options).not.toHaveProperty("env");expect(options).not.toHaveProperty("ports");
    expect(options.name).toMatch(/^evolution-html-native-/);
  });
  it("does not resume or create a VM when project credentials are expired",async()=>{
    mocks.issue.mockReturnValue({code:"VERCEL_OIDC_EXPIRED",message:"Expired synthetic credential"});
    await expect(createVercelHtmlNativeRuntime()).rejects.toThrow("Expired synthetic credential");
    expect(mocks.snapshot).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
  });
});
