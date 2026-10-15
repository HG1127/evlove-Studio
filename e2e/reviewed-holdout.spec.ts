import {expect,test} from "@playwright/test";

test("synthetic human-review panel preserves consent and request identity in a real browser",async({page},testInfo)=>{
  test.setTimeout(150_000);
  page.setDefaultTimeout(20_000);
  const binding={schemaVersion:"reviewed-holdout-binding-v1",missionId:"synthetic-only",sourceUpdatedAt:"2026-10-15T08:00:00.000Z",
    baselineId:"review-baseline",baselineSha256:"a".repeat(64),candidateId:"same-frozen",snapshotSha256:"b".repeat(64),
    frozenSha256:"c".repeat(64),originalSha256:"d".repeat(64),hiddenSha256:"e".repeat(64),inputSha256:"f".repeat(64),
    physicalSha256:"1".repeat(64),scoringRouteFingerprint:"synthetic-route"};
  const posts:unknown[]=[];let previews=0;let releaseFirst!:()=>void;
  const firstRelease=new Promise<void>(resolve=>{releaseFirst=resolve;});
  await page.route("**/reviewed-fixture.html",async route=>{
    const response=await route.fetch({url:new URL("/",route.request().url()).href});
    let html=await response.text();
    expect(html).toContain("/src/main.tsx");
    html=html.replace(/<script\b[^>]*\bsrc="\/src\/main\.tsx[^"]*"[^>]*>\s*<\/script>/,"");
    expect(html).not.toMatch(/src="\/src\/main\.tsx/);
    html=html.replace('id="root"','id="reviewed-fixture"');
    await route.fulfill({response,body:html});
  });
  await page.route("**/api/evolution/**",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname!=="/api/evolution/reviewed-holdout"){
      throw new Error("Unexpected synthetic panel request: "+url.pathname);
    }
    if(req.method()==="GET"){
      previews++;await route.fulfill({json:{binding,reviewNotes:["未观察到安全约束违规；安全配置细节不足。"],
        preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"}});return;
    }
    posts.push(req.postDataJSON());
    if(posts.length===1){await firstRelease;await route.fulfill({status:503,json:{error:"启动结果尚未确认"}});return;}
    await route.fulfill({json:{missionId:binding.missionId,controlJobId:"synthetic-job",runId:"synthetic-run",status:"queued",reused:true}});
  });
  await page.goto("/reviewed-fixture.html");
  const bootstrapStarted=Date.now();
  await page.evaluate(async project=>{
    const modulePath="/e2e/reviewed-holdout-fixture.tsx";
    const fixture=await import(/* @vite-ignore */ modulePath) as typeof import("./reviewed-holdout-fixture");
    fixture.mountReviewedHoldoutFixture(project);
  },{id:binding.missionId,updatedAt:binding.sourceUpdatedAt,baselineRun:{result:{safety:"REVIEW"}},
    experimentRun:{winnerId:binding.candidateId},artifactAcceptance:{status:"idle"}});
  testInfo.annotations.push({type:"synthetic-panel-bootstrap-ms",description:String(Date.now()-bootstrapStarted)});
  await expect(page.getByRole("heading",{name:"人工复核后继续隔离验证"})).toBeVisible();
  expect(previews).toBe(0);expect(posts).toEqual([]);
  await page.getByRole("button",{name:"读取当前复核信息"}).click();
  await expect(page.getByText("文件 SHA-256："+binding.frozenSha256)).toBeVisible();
  const confirm=page.getByRole("button",{name:"确认并继续同一冻结文件"});
  await expect(confirm).toBeDisabled();
  await page.getByLabel("人工复核说明").fill("已核对原 REVIEW，仅继续同一冻结文件和同一隐藏卷。");
  await page.getByRole("checkbox",{name:"我已复核原因，确认保留原 REVIEW 和历史结果。"}).check();
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox",{name:"仅继续同一冻结文件的隔离验证，不豁免验收门槛。"}).check();
  await expect(confirm).toBeEnabled();await confirm.click();
  await expect(confirm).toBeDisabled();await expect.poll(()=>posts.length).toBe(1);
  releaseFirst();
  await expect(page.getByRole("alert")).toContainText("相同请求键");
  await confirm.click();
  await expect(page.getByRole("status")).toContainText("完整验收尚未完成");
  expect(posts).toHaveLength(2);expect(posts[0]).toEqual(posts[1]);
  expect(posts[0]).toMatchObject({binding,preserveReview:true,preserveAcceptanceGates:true});
  expect(previews).toBe(1);
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("heading",{name:"人工复核后继续隔离验证"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
