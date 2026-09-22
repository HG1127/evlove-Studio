// @vitest-environment node
import {describe,expect,it} from "vitest";
import {connectorOperationPermission} from "./connector-permission";

describe("connector operation permissions",()=>{
  it.each([
    ["read","data.read"],
    ["snapshot","data.read"],
    ["observe","data.read"],
    ["validate","target.execute"],
    ["mutate","target.write"],
    ["deploy","release.execute"],
    ["rollback","release.execute"],
  ] as const)("%s requires %s",(operation,permission)=>{
    expect(connectorOperationPermission(operation)).toBe(permission);
  });
});
