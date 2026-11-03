import {expect,test} from "@playwright/test";
import {demoProject} from "../src/features/evolve/data/mock-project";

test("workbench resumes an interrupted project page before publishing task totals",async({page},testInfo)=>{
  const projects=[{...demoProject,id:"transport-a",name:"Transport first preserved"},{...demoProject,id:"transport-b",name:"Transport second recovered"}];
  const envelope=(project:typeof demoProject)=>({schemaVersion:"mission-v1",missionId:project.id,revision:8,payload:project,createdAt:project.updatedAt,updatedAt:project.updatedAt});
  let unblock=()=>{};const held=new Promise<void>(resolve=>{unblock=resolve;});
  const retries:number[]=[];
  await page.route("**/api/evolution/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith("/mission-index")||path.endsWith("/mission-catalog")){await route.fulfill({status:404,json:{statusMessage:"Not Found"}});return;}
    if(path.endsWith("/operator-session")){await route.fulfill({json:{configured:true,authenticated:true}});return;}
    if(path.endsWith("/missions")){
      const cursor=url.searchParams.get("cursor"),limit=Number(url.searchParams.get("pageLimit"));
      if(!cursor){await route.fulfill({json:{items:[envelope(projects[0])],nextCursor:"transport-a"}});return;}
      if(cursor==="transport-a"){
        retries.push(limit);
        if(limit===10)await held;
        if(limit>2){await route.abort("connectionreset");return;}
        await route.fulfill({json:{items:[envelope(projects[1])],nextCursor:"transport-b"}});return;
      }
      await route.fulfill({json:{items:[]}});return;
    }
    if(path.endsWith("/events"))await route.fulfill({json:[]});else await route.fulfill({json:{items:[]}});
  });
  try{
    await page.goto("/#/");
    await expect(page.locator(".tabular-nums")).toHaveText(["—","—","—","—"]);
    await expect(page.getByText(projects[0].name,{exact:true})).toHaveCount(0);
  }finally{unblock();}
  await expect(page.getByText("项目与任务同步正常",{exact:true})).toBeVisible();
  await expect(page.getByText(projects[0].name,{exact:true}).first()).toBeVisible();
  await expect(page.getByText(projects[1].name,{exact:true}).first()).toBeVisible();
  expect(retries.slice(0,3)).toEqual([10,5,2]);
  await page.screenshot({path:testInfo.outputPath("recovered-project-read.png"),fullPage:true});
});

test("workbench keeps task totals unknown while the project service is unavailable",async({page},testInfo)=>{
  await page.route("**/api/evolution/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/mission-index")||path.endsWith("/mission-catalog")){await route.fulfill({status:404,json:{statusMessage:"Not Found"}});return;}
    if(path.endsWith("/operator-session"))await route.fulfill({json:{configured:true,authenticated:true}});
    else if(path.endsWith("/missions"))await route.fulfill({status:503,json:{statusMessage:"Server Data Plane 当前不可用",data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"upstream-unavailable"}}});
    else if(path.endsWith("/events"))await route.fulfill({json:[]});
    else await route.fulfill({json:{items:[]}});
  });
  await page.goto("/#/");
  await expect(page.getByText("任务数量尚未确认，连接恢复后会自动更新。",{exact:false})).toBeVisible();
  await expect(page.locator(".tabular-nums")).toHaveText(["—","—","—","—"]);
  await expect(page.getByText("目前没有需要你处理的事项。Evolve 会继续自主运行。",{exact:true})).toHaveCount(0);
  await expect(page.getByText("当前没有运行中的任务。",{exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("unavailable-project-service.png"),fullPage:true});
});

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
    if(path.endsWith("/mission-index")||path.endsWith("/mission-catalog")){await route.fulfill({status:404,json:{statusMessage:"Not Found"}});return;}
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


test("workbench resumes a private full-state cache and polls only the version index",async({page},testInfo)=>{
  const projects=[{...demoProject,id:"indexed-a",name:"Indexed first preserved"},{...demoProject,id:"indexed-b",name:"Indexed second recovered"}];
  const reads:string[]=[];let allowSecond=false,indexReads=0;
  await page.route("**/api/evolution/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/operator-session")){await route.fulfill({json:{configured:true,authenticated:true}});return;}
    if(path.endsWith("/mission-catalog")){await route.fulfill({status:404,json:{}});return;}
    if(path.endsWith("/mission-index")){
      indexReads++;await route.fulfill({json:{schemaVersion:"mission-index-v1",workspaceId:"synthetic-workspace",complete:true,items:projects.map(project=>({missionId:project.id,revision:8}))}});return;
    }
    if(path.includes("/missions/")){
      const id=path.endsWith("/read")?path.split("/").at(-2)!:path.split("/").pop()!;reads.push(id);
      if(id==="indexed-b"&&!allowSecond){await route.abort("connectionreset");return;}
      const project=projects.find(item=>item.id===id)!;
      const envelope={schemaVersion:"mission-v1",missionId:id,revision:8,payload:project,createdAt:project.updatedAt,updatedAt:project.updatedAt};
      await route.fulfill({headers:{"Content-Type":"application/x-ndjson"},body:JSON.stringify({schemaVersion:"mission-read-stream-v1",type:"pending"})+"\n"+JSON.stringify({schemaVersion:"mission-read-stream-v1",type:"complete",envelope})+"\n"});return;
    }
    if(path.endsWith("/missions"))throw new Error("Indexed sync unexpectedly requested full legacy collection");
    await route.fulfill({json:path.endsWith("/events")?[]:{items:[]}});
  });
  await page.goto("/#/");
  await expect.poll(()=>reads.includes("indexed-b")).toBe(true);
  await expect(page.locator(".tabular-nums")).toHaveText(["—","—","—","—"]);
  await expect(page.getByText(projects[0].name,{exact:true})).toHaveCount(0);
  allowSecond=true;
  await expect(page.getByText("项目与任务同步正常",{exact:true})).toBeVisible();
  for(const project of projects)await expect(page.getByText(project.name,{exact:true}).first()).toBeVisible();
  expect(reads.filter(id=>id==="indexed-a")).toHaveLength(1);
  const afterRecovery=indexReads;
  await expect.poll(()=>indexReads).toBeGreaterThan(afterRecovery);
  expect(reads.filter(id=>id==="indexed-a")).toHaveLength(1);
  expect(reads.filter(id=>id==="indexed-b")).toHaveLength(2);
  await page.screenshot({path:testInfo.outputPath("indexed-complete-recovery.png"),fullPage:true});
});


test("directory opens one complete project while another full receipt is held",async({page},testInfo)=>{
 const projects=[{...demoProject,id:"directory-a",name:"Directory waiting full state"},{...demoProject,id:"directory-b",name:"Directory point opened"}];
 let unblock=()=>{};const held=new Promise<void>(resolve=>{unblock=resolve;});const writes:string[]=[],reads:string[]=[];
 await page.route("**/api/evolution/**",async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(!["GET","HEAD"].includes(request.method())){writes.push(path);await route.fulfill({status:403,json:{}});return;}
  if(path.endsWith("/operator-session")){await route.fulfill({json:{configured:true,authenticated:true}});return;}
  if(path.endsWith("/mission-catalog")){await route.fulfill({json:{schemaVersion:"mission-catalog-v1",workspaceId:"synthetic-workspace",directoryComplete:true,entries:projects.map(project=>({missionId:project.id,revision:8,title:project.name,updatedAt:project.updatedAt}))}});return;}
  if(path.endsWith("/mission-index")){await route.fulfill({json:{schemaVersion:"mission-index-v1",workspaceId:"synthetic-workspace",complete:true,items:projects.map(project=>({missionId:project.id,revision:8}))}});return;}
  if(path.includes("/missions/")){
   const id=path.endsWith("/read")?path.split("/").at(-2)!:path.split("/").pop()!;reads.push(id);
   if(id==="directory-a")await held;
   const project=projects.find(item=>item.id===id)!;
   await route.fulfill({headers:{"Content-Type":"application/x-ndjson"},body:JSON.stringify({schemaVersion:"mission-read-stream-v1",type:"pending"})+"\n"+JSON.stringify({schemaVersion:"mission-read-stream-v1",type:"complete",envelope:{schemaVersion:"mission-v1",missionId:id,revision:8,payload:project,createdAt:project.updatedAt,updatedAt:project.updatedAt}})+"\n"});return;
  }
  if(path.endsWith("/missions"))throw new Error("Directory flow requested a full legacy list");
  await route.fulfill({json:path.endsWith("/events")?[]:{items:[]}});
 });
 try{
  await page.goto("/#/");
  await expect(page.getByText("完整状态待核对",{exact:true})).toHaveCount(2);
  await expect(page.locator(".tabular-nums")).toHaveText(["—","—","—","—"]);
  await page.screenshot({path:testInfo.outputPath("directory-before-full-state.png"),fullPage:true});
  await page.getByRole("link").filter({hasText:"Directory point opened"}).click();
  await expect(page.getByRole("heading",{name:"Directory point opened",exact:true})).toBeVisible();
  expect(reads).toContain("directory-b");expect(writes).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("point-project-without-global-wait.png"),fullPage:true});
 }finally{unblock();}
});
