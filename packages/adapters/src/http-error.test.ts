import {describe,expect,it} from "vitest";
import {httpApiErrorDetail} from "./http-error";
describe("public API error detail",()=>{
  it("explains a validated data-plane reason without exposing upstream internals",()=>{
    const error={statusMessage:"Server Data Plane 当前不可用",data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"schema-unavailable",service:"private-table",upstreamStatus:404,stack:"secret"}};
    expect(httpApiErrorDetail(error)).toBe("后台数据库表或接口尚未就绪，请管理员检查迁移状态。");
    expect(httpApiErrorDetail({...error,data:{...error.data,reason:"credential-rejected"}})).toContain("服务端数据库凭据与权限");
    expect(httpApiErrorDetail({...error,data:{...error.data,reason:"unknown"}})).toBe(error.statusMessage);
  });
  it("reads the safe H3 data message before a generic wrapper",()=>{
    expect(httpApiErrorDetail({message:"HTTPError",statusMessage:"Server AI operation failed",data:{message:"模型连接中断，请重试。"}})).toBe("模型连接中断，请重试。");
  });
  it("never promotes an internal stack or cause into a user message",()=>{
    expect(httpApiErrorDetail({message:"HTTPError",stack:"private",cause:{message:"private"}})).toBeUndefined();
    expect(httpApiErrorDetail({message:42,data:{message:{private:true}}})).toBeUndefined();
  });
  it("bounds detail length",()=>expect(httpApiErrorDetail({data:{message:"a".repeat(400)}})).toHaveLength(300));
});
