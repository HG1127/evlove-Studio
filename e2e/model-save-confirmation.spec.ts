import {expect,test} from "@playwright/test";

test("settings confirms persisted models after reload and detects conflicting readback",async({page},testInfo)=>{
  const selected={id:"synthetic-connection",providerId:"custom",label:"Synthetic provider",enabled:true,apiKey:"synthetic-only",baseUrl:"https://provider.test/v1",defaultModel:"selected-generator",models:["selected-generator"],createdAt:"2026-11-03T00:00:00Z",updatedAt:"2026-11-03T00:00:00Z"};
  await page.addInitScript(connection=>{
    localStorage.setItem("evolve-studio:provider-connections:v2",JSON.stringify([connection]));
    localStorage.setItem("evolve-studio:provider-migration:v2","1");
  },selected);
  const connection={connectionId:selected.id,label:selected.label,baseUrl:selected.baseUrl,model:"previous-generator",protocol:"chat-completions",responseFormat:"json-object"};
  let generation={configured:true,storageConfigured:true,revision:2,message:"saved",connection};
  const judge={...generation,connection:{...connection,model:"independent-reviewer"}};
  let reads=0,writes=0,conflict=false,legacyBackend=false;
  const generationStatus=page.getByText("当前后端默认：",{exact:true}).locator("..");
  const judgeStatus=page.getByText("当前独立验收：",{exact:true}).locator("..");
  await page.route("**/api/evolution/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/operator-session"))await route.fulfill({json:{configured:true,authenticated:true}});
    else if(path.endsWith("/events"))await route.fulfill({json:[]});
    else await route.fulfill({json:{items:[]}});
  });
  await page.route(/\/api\/evolution\/ai-(?:judge-)?connection(?:\?|$)/,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(legacyBackend&&url.pathname.endsWith("ai-judge-connection")){
      await route.fulfill({status:404,json:{statusMessage:"Not Found"}});return;
    }
    if(request.method()==="PUT"){
      writes++;
      const {apiKey:discardedKey,...settings}=request.postDataJSON();
      expect(discardedKey).toBe("synthetic-only");
      generation={...generation,revision:generation.revision+1,connection:settings};
      const receipt=structuredClone(generation);
      if(conflict)generation={...generation,revision:generation.revision+1,connection:{...generation.connection,model:"concurrent-change"}};
      await route.fulfill({json:receipt});return;
    }
    reads++;
    await route.fulfill({json:url.pathname.endsWith("ai-judge-connection")||!legacyBackend&&url.searchParams.get("role")==="judge"?judge:generation});
  });
  await page.goto("/#/settings");
  await expect(generationStatus).toContainText("previous-generator");
  await expect(judgeStatus).toContainText("independent-reviewer");
  await page.getByRole("button",{name:"保存为后端默认模型",exact:true}).click();
  await expect(page.getByText("已保存并从后端回读确认。",{exact:false})).toBeVisible();
  await expect(generationStatus).toContainText("selected-generator");
  expect(writes).toBe(1);expect(reads).toBeGreaterThanOrEqual(3);
  await page.reload();
  await expect(generationStatus).toContainText("selected-generator");
  await expect(judgeStatus).toContainText("independent-reviewer");
  await page.screenshot({path:testInfo.outputPath("confirmed-models.png"),fullPage:true});
  conflict=true;
  await page.getByRole("button",{name:"保存为后端默认模型",exact:true}).click();
  await expect(page.getByText("保存请求已提交，但后端回读与本次配置不一致。",{exact:false})).toBeVisible();
  await expect(generationStatus).toHaveCount(0);
  await page.getByRole("button",{name:"重新检查保存状态",exact:true}).click();
  await expect(generationStatus).toContainText("concurrent-change");
  expect(writes).toBe(2);
  legacyBackend=true;
  await page.reload();
  await expect(page.getByText("当前后端尚不支持独立验收模型，请先更新后端。",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"保存为独立验收模型",exact:true}).click();
  await expect(page.getByText("当前后端尚不支持独立验收模型，请先更新后端。",{exact:true})).toBeVisible();
  await expect(generationStatus).toContainText("concurrent-change");
  expect(writes).toBe(2);
  await page.screenshot({path:testInfo.outputPath("unsupported-judge-backend.png"),fullPage:true});
});
