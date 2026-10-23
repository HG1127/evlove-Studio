import {test,expect} from "@playwright/test";

/**
 * Signed-in browser UI uses the durable backend status, not a stale local
 * "waiting to start" projection. The API is mocked here to exercise UX;
 * actual database and Workflow evidence remain separate integration checks.
 */
test("existing HTML Workflow blocks both Start buttons even when local project says idle",async({page})=>{
  const id="audit-existing-html-e2e";
  await page.goto("/#/");
  await page.evaluate(async()=>{
    const {initializeLocalProjects}=await import("/src/features/evolve/runtime/local-store.ts");
    await initializeLocalProjects();
  });
  const project=await page.evaluate(async(missionId)=>{
    const {demoProject}=await import("/src/features/evolve/data/mock-project.ts");
    const {saveLocalProject}=await import("/src/features/evolve/runtime/local-store.ts");
    const source={...demoProject.sourceArtifacts[0]!,id:"html-source",
      role:"target" as const,extension:"html",mimeType:"text/html",
      textContent:"<!doctype html><html><body><input id='search'></body></html>"};
    const project={...demoProject,id:missionId,name:"AUDIT ONLY · Existing HTML Workflow",
      stage:"target" as const,sourceArtifacts:[source],candidates:[],outputArtifacts:[],
      campaign:{...demoProject.campaign,status:"idle" as const,currentRound:0},
      targetConnection:{adapter:"artifact" as const,connectionId:"audited-html",
        status:"connected" as const,label:"Uploaded HTML"},
      gates:demoProject.gates.map(g=>g.id==="target-ready"?{...g,status:"approved" as const}:g),
    };
    saveLocalProject(project);
    return project;
  },id);
  const job={
    schemaVersion:"job-v1",id:"workflow-control-existing",missionId:id,
    type:"campaign",status:"running",label:"Existing HTML workflow",
    idempotencyKey:"workflow-control:"+id+":first-start",
    generation:1,attempts:0,priority:70,
    outputRef:"wrun-already-running",
    createdAt:"2026-10-21T01:00:00Z",updatedAt:"2026-10-21T01:05:00Z",
  };
  const envelope={
    schemaVersion:"mission-v1",missionId:id,revision:7,
    payload:project,createdAt:"2026-10-21T01:00:00Z",updatedAt:"2026-10-21T01:05:00Z",
  };
  let starts=0;
  let missionReads=0;
  let stallNextRead=false;
  let releaseSlowRead:(()=>void)|undefined;
  await page.route("**/api/evolution/missions/"+id,async route=>{
    missionReads++;
    // Arm only after initial load: React Strict Mode can trigger more than
    // one initial request, and must not inadvertently stall hydration.
    const stalled=stallNextRead;
    if(stalled){
      stallNextRead=false;
      await new Promise<void>(resolve=>{releaseSlowRead=resolve;});
    }
    try{
      await route.fulfill({
        status:200,contentType:"application/json",body:JSON.stringify(envelope),
      });
    }catch(error){
      if(!stalled)throw error; // Deliberately aborted stale read cannot fulfill.
    }
  });
  await page.route("**/api/evolution/jobs?missionId="+id,route=>route.fulfill({
    status:200,contentType:"application/json",body:JSON.stringify([job]),
  }));
  await page.route("**/api/evolution/status?**",route=>route.fulfill({
    status:200,contentType:"application/json",
    body:JSON.stringify({workflow:{exists:true,status:"running"},job,events:[]}),
  }));
  await page.route("**/api/evolution/start",route=>{
    starts++;
    return route.fulfill({status:409,contentType:"application/json",
      body:JSON.stringify({code:"MISSION_WORKFLOW_ALREADY_ACTIVE"})});
  });
  await page.evaluate((missionId)=>{window.location.hash="#/projects/"+missionId;},id);
  const status=page.getByRole("region",{name:"真实后端运行状态"});
  await expect(status.getByText("已有后端进化任务")).toBeVisible();
  await expect(status.getByText("后端版本：rev 7")).toBeVisible();
  await expect(status.getByText("Job：running")).toBeVisible();
  await expect(status.getByText("Workflow：running")).toBeVisible();
  await expect(page.getByRole("button",{name:"开始自主进化"})).toBeDisabled();
  const internal=page.getByText("技术人员查看：内部进化过程");
  await internal.click();
  await expect(page.getByRole("button",{name:"继续自动进化"})).toBeDisabled();
  const readsBeforeRefresh=missionReads;
  stallNextRead=true;
  await status.getByRole("button",{name:"刷新后端状态"}).click();
  const restart=status.getByRole("button",{name:"取消当前读取并重新查询后端状态"});
  await expect(restart).toBeVisible();
  await restart.click();
  await expect(status.getByRole("button",{name:"刷新后端状态"})).toBeVisible();
  await expect(status.getByText("已有后端进化任务")).toBeVisible();
  await expect(status.getByText("后端版本：rev 7")).toBeVisible();
  expect(missionReads).toBeGreaterThanOrEqual(readsBeforeRefresh+2);
  releaseSlowRead?.();
  expect(starts).toBe(0);
});

test("backend read failure never enables a new HTML Campaign",async({page})=>{
  const id="audit-fail-read-html";
  await page.goto("/#/");
  await page.evaluate(async()=>{
    const {initializeLocalProjects}=await import("/src/features/evolve/runtime/local-store.ts");
    await initializeLocalProjects();
  });
  await page.evaluate(async(missionId)=>{
    const {demoProject}=await import("/src/features/evolve/data/mock-project.ts");
    const {saveLocalProject}=await import("/src/features/evolve/runtime/local-store.ts");
    saveLocalProject({...demoProject,id:missionId,
      sourceArtifacts:[{...demoProject.sourceArtifacts[0]!,
        role:"target",extension:"html",mimeType:"text/html"}],
      targetConnection:{adapter:"artifact",connectionId:"html",status:"connected",label:"Uploaded HTML"},
      campaign:{...demoProject.campaign,status:"idle",currentRound:0},
    });
  },id);
  await page.route("**/api/evolution/missions/"+id,route=>route.fulfill({
    status:401,contentType:"application/json",body:'{"error":"operator required"}',
  }));
  await page.route("**/api/evolution/jobs?missionId="+id,route=>route.fulfill({
    status:401,contentType:"application/json",body:'{"error":"operator required"}',
  }));
  await page.evaluate((missionId)=>{window.location.hash="#/projects/"+missionId;},id);
  const status=page.getByRole("region",{name:"真实后端运行状态"});
  await expect(status.getByText("后端运行状态未确认")).toBeVisible();
  await expect(status.getByText(/请先在此浏览器连接后端工作区/)).toBeVisible();
  await expect(page.getByRole("button",{name:/开始自主进化|继续自主进化/})).toBeDisabled();
});
