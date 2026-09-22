// @vitest-environment node
import {describe,expect,it} from "vitest";
import {gitActionPermission} from "./git-permission";

describe("Git action permissions",()=>{
  it.each([
    ["snapshot","data.read"],
    ["validate","data.read"],
    ["observe","data.read"],
    ["mutate","target.write"],
    ["open-pr","target.write"],
    ["merge","release.execute"],
    ["rollback","release.execute"],
  ] as const)("%s requires %s",(action,permission)=>{
    expect(gitActionPermission(action)).toBe(permission);
  });
});
