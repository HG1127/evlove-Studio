import {test,expect} from "@playwright/test";

// Explicitly stub only active metered probes. These are UX/fail-closed tests,
// not evidence that a real Vercel Sandbox account has been authorized.
test("HTML Target explicitly reports unavailable Sandbox and never launches Chromium after failed preflight",async({page,request})=>{
  const policyResponse=await request.get("/api/evolution/sandbox-capabilities");
  expect(policyResponse.ok()).toBe(true);
  const policy=await policyResponse.json();
  expect(policy.codeReady).toBe(true);
  await page.route("**/api/evolution/sandbox-auth-status",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify({
      probeMode:"passive-config",checkedAt:"2026-10-20T10:00:00Z",
      state:"unverified",oidcPresent:true,providerVerified:false,
      message:"配置初检未发现明确阻断，云端授权仍须验证",
      nextAction:"继续真实 Sandbox Health",
    }),
  }));
  let sandboxCalls=0,browserCalls=0;
  await page.route("**/api/evolution/sandbox-health",async route=>{
    sandboxCalls++;
    await route.fulfill({
      status:200,contentType:"application/json",
      body:JSON.stringify({ready:false,message:"Sandbox 无可用授权（隔离 UI 测试）",policy}),
    });
  });
  await page.route("**/api/evolution/browser-health",async route=>{
    browserCalls++;
    await route.fulfill({status:500,body:"must not reach Browser Runtime"});
  });
  await page.goto("/#/readiness");
  await expect(page.getByRole("heading",{name:"进化闭环完整性中心"})).toBeVisible();
  await page.getByRole("tab",{name:/Target Adapter/}).click();
  const htmlRow=page.getByText("HTML / Web 页面",{exact:true}).locator("..");
  await expect(htmlRow.getByText("待后端",{exact:true})).toBeVisible();
  await expect(htmlRow.getByText("服务端未验证")).toBeVisible();
  await page.getByRole("button",{name:"验证云端 Browser"}).click();
  await expect(page.getByText("Sandbox 无可用授权（隔离 UI 测试）",{exact:false}).first()).toBeVisible();
  await expect(htmlRow.getByText("待后端",{exact:true})).toBeVisible();
  expect(sandboxCalls).toBe(1);
  expect(browserCalls).toBe(0);
});

test("expired OIDC is displayed passively and stops paid Sandbox and Browser probes",async({page})=>{
  let authReads=0,sandboxCalls=0,browserCalls=0;
  await page.route("**/api/evolution/sandbox-auth-status",route=>{
    authReads++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      probeMode:"passive-config",checkedAt:"2026-10-20T10:00:00Z",
      state:"expired",oidcPresent:true,providerVerified:false,
      issueCode:"VERCEL_OIDC_EXPIRED",
      expiresAt:"2026-09-20T12:46:17Z",
      message:"OIDC 配置阻断：凭证过期",
      nextAction:"使用正确团队 Vercel CLI 重新执行 vercel env pull 并重启 Nitro。",
    })});
  });
  await page.route("**/api/evolution/sandbox-health",route=>{
    sandboxCalls++;
    return route.fulfill({status:500,body:"unexpected metered Sandbox probe"});
  });
  await page.route("**/api/evolution/browser-health",route=>{
    browserCalls++;
    return route.fulfill({status:500,body:"unexpected Browser probe"});
  });
  await page.goto("/#/readiness");
  await page.getByRole("tab",{name:/Target Adapter/}).click();
  await expect(page.getByText("OIDC 已过期")).toBeVisible();
  await expect(page.getByText("2026-09-20T12:46:17Z")).toBeVisible();
  await expect(page.getByText(/使用正确团队 Vercel CLI/)).toBeVisible();
  await page.getByRole("button",{name:"验证云端 Browser"}).click();
  await expect(page.getByText("凭证配置阻断；不会启动云端 Sandbox 或 Browser。")).toBeVisible();
  expect(authReads).toBeGreaterThanOrEqual(2); // passive mount + explicit refresh
  expect(sandboxCalls).toBe(0);
  expect(browserCalls).toBe(0);
});

test("a configured Access Token still requires real cloud permission and cannot mark HTML ready by itself",async({page,request})=>{
  const policy=(await (await request.get("/api/evolution/sandbox-capabilities")).json());
  let authorizationReads=0,sandboxCalls=0,browserCalls=0;
  await page.route("**/api/evolution/sandbox-auth-status",route=>{
    authorizationReads++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      probeMode:"passive-config",checkedAt:"2026-10-20T10:00:00Z",
      state:"access-token-unverified",oidcPresent:true,providerVerified:false,
      message:"Access Token 参数已完整，但云端权限未验证",
      nextAction:"具有目标项目权限的操作者执行真实 Sandbox Health",
    })});
  });
  await page.route("**/api/evolution/sandbox-health",route=>{
    sandboxCalls++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      ready:false,message:"HTTP 403：目标 Vercel Team 无 Sandbox 权限",
      latencyMs:120,policy,
    })});
  });
  await page.route("**/api/evolution/browser-health",route=>{
    browserCalls++;
    return route.fulfill({status:500,body:"must not launch Browser on 403"});
  });
  await page.goto("/#/readiness");
  await page.getByRole("tab",{name:/Target Adapter/}).click();
  await expect(page.getByText("Access Token 配置完整，等待云端验证")).toBeVisible();
  await page.getByRole("button",{name:"验证云端 Browser"}).click();
  await expect(page.getByText(/HTTP 403：目标 Vercel Team 无 Sandbox 权限/).first()).toBeVisible();
  const htmlRow=page.getByText("HTML / Web 页面",{exact:true}).locator("..");
  await expect(htmlRow.getByText("可用",{exact:true})).toHaveCount(0);
  expect(authorizationReads).toBeGreaterThanOrEqual(2);
  expect(sandboxCalls).toBe(1);
  expect(browserCalls).toBe(0);
});

test("local browser smoke and Target Proxy capabilities cannot produce a false HTML server READY",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("evolve-runner-capabilities",JSON.stringify({
      capabilities:{htmlBrowser:true,e2e:true,screenshots:true},
    }));
  });
  await page.goto("/#/readiness");
  await page.getByRole("tab",{name:/Target Adapter/}).click();
  const htmlRow=page.getByText("HTML / Web 页面",{exact:true}).locator("..");
  // The app may refresh its local Runner cache from the Target Proxy and
  // show either PARTIAL or BACKEND. Neither state establishes cloud readiness.
  await expect(htmlRow.getByText(/仅本地 E2E|服务端未验证/)).toBeVisible();
  await expect(htmlRow.getByText("无服务端交互证据")).toBeVisible();
  await expect(htmlRow.getByText("可用",{exact:true})).toHaveCount(0);
});
