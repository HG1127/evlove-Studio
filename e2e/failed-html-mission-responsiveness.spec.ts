import {test,expect} from "@playwright/test";

/** Browser-only isolation: no real Mission, Workflow or provider writes. */
test("failed HTML Mission stays responsive across ordinary controls without retrying Workflow",async({page})=>{
  const id="e2e-failed-html-no-restart";
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/#/");
  await page.evaluate(async()=>{
    const {initializeLocalProjects}=await import("/src/features/evolve/runtime/local-store.ts");
    await initializeLocalProjects();
  });
  const project=await page.evaluate(async missionId=>{
    const {demoProject}=await import("/src/features/evolve/data/mock-project.ts");
    const {saveLocalProject}=await import("/src/features/evolve/runtime/local-store.ts");
    const p={...demoProject,id:missionId,
      name:"AUDIT ONLY · failed HTML Mission UX test",
      stage:"target" as const,
      sourceArtifacts:[{...demoProject.sourceArtifacts[0]!,id:"html-main",
        role:"target" as const,extension:"html",mimeType:"text/html",
        textContent:"<!doctype html><html><body>Original local fixture</body></html>"}],
      targetConnection:{adapter:"artifact" as const,connectionId:"html-main",
        status:"connected" as const,label:"Uploaded HTML"},
      campaign:{...demoProject.campaign,status:"paused" as const,
        currentRound:0,stopReason:"[server-workflow-step-failed] 后台执行节点失败，原有成果和检查点已保留"},
      candidates:[],outputArtifacts:[],
    };
    saveLocalProject(p);
    return p;
  },id);
  const job={schemaVersion:"job-v1",id:"workflow-control-failed",
    missionId:id,type:"campaign",status:"failed",label:"Old Workflow",
    idempotencyKey:"workflow-control:"+id+":existing",generation:1,
    attempts:1,priority:70,outputRef:"wrun-original-failed",
    error:"server-workflow-step-failed",
    createdAt:"2026-10-21T01:00:00Z",updatedAt:"2026-10-21T01:05:00Z"};
  const envelope={schemaVersion:"mission-v1",missionId:id,revision:1,
    payload:project,createdAt:"2026-10-21T01:00:00Z",
    updatedAt:"2026-10-21T01:05:00Z"};
  let startCalls=0;
  await page.route("**/api/evolution/missions/"+id,route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify(envelope),
  }));
  await page.route("**/api/evolution/jobs?missionId="+id,route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify([job]),
  }));
  await page.route("**/api/evolution/status?**",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify({workflow:{exists:true,status:"completed"},job,events:[]}),
  }));
  await page.route("**/api/evolution/start",route=>{
    startCalls++;
    return route.fulfill({status:409,body:'{"code":"MISSION_WORKFLOW_ALREADY_ACTIVE"}'});
  });
  await page.evaluate(missionId=>{window.location.hash="#/projects/"+missionId;},id);
  const server=page.getByRole("region",{name:"真实后端运行状态"});
  await expect(server.getByText("后端断点需要检查")).toBeVisible();
  await expect(server.getByText("Job：failed")).toBeVisible();
  await expect(server.getByText("Workflow：completed")).toBeVisible();
  const retry=page.getByRole("button",{name:"按当前设置重试"});
  await expect(retry).toBeDisabled();
  await expect(page.getByText(/后端旧 Job \/ Workflow 状态尚待核验/)).toBeVisible();

  const start=Date.now();
  await server.getByRole("button",{name:"技术运行记录"}).click();
  await expect(page.getByText(/技术诊断入口/)).toBeVisible();
  expect(Date.now()-start).toBeLessThan(12_000);

  await page.getByRole("button",{name:"高级设置",exact:true}).click();
  await expect(page.getByRole("button",{name:"高级设置",exact:true})).toHaveAttribute("aria-pressed","true");

  await page.getByRole("button",{name:"2 · 自动进化"}).click();
  await expect(retry).toBeDisabled();
  await server.getByRole("button",{name:"刷新后端状态"}).click();
  await expect(server.getByText("后端断点需要检查")).toBeVisible();
  expect(startCalls).toBe(0);
  expect(errors).toEqual([]);
});