import {describe,expect,it} from "vitest";
import {httpApiErrorDetail} from "./http-error";
describe("public API error detail",()=>{
  it("reads the safe H3 data message before a generic wrapper",()=>{
    expect(httpApiErrorDetail({message:"HTTPError",statusMessage:"Server AI operation failed",data:{message:"模型连接中断，请重试。"}})).toBe("模型连接中断，请重试。");
  });
  it("never promotes an internal stack or cause into a user message",()=>{
    expect(httpApiErrorDetail({message:"HTTPError",stack:"private",cause:{message:"private"}})).toBeUndefined();
    expect(httpApiErrorDetail({message:42,data:{message:{private:true}}})).toBeUndefined();
  });
  it("bounds detail length",()=>expect(httpApiErrorDetail({data:{message:"a".repeat(400)}})).toHaveLength(300));
});
