import assert from 'node:assert/strict';
import {getBrowser,closeBrowser} from '../runner-gateway/browser-runner.mjs';

const baseUrl=process.env.PRODUCTION_URL??'https://500ipo-evolve-studio.vercel.app';
const routes=[
  ['home','/','工作台'],
  ['projects','/projects','进化任务'],
  ['releases','/releases','发布治理'],
  ['settings','/settings',undefined],
  ['outputs','/outputs',undefined],
];
async function enterLocalModeIfNeeded(page){
  const choice=page.getByRole('button',{name:'仅在此浏览器继续',exact:true});
  const app=page.locator('.studio-main');
  await Promise.race([choice.waitFor({state:'visible'}),app.waitFor({state:'visible'})]);
  const selectedLocalMode=await choice.isVisible();
  if(selectedLocalMode)await choice.click();
  await app.waitFor();
  return selectedLocalMode;
}

const browser=await getBrowser();
const errors=[];
const blockedWrites=[];
const rendered=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  await context.route('**/*',async(route)=>{
    const request=route.request();
    if(request.method()==='GET'||request.method()==='HEAD'){
      await route.continue();
      return;
    }
    blockedWrites.push({method:request.method(),path:new URL(request.url()).pathname});
    await route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.on('pageerror',(error)=>errors.push(error.message));
  for(const [name,route,title] of routes){
    await page.goto(`${baseUrl}/#${route}`,{waitUntil:'domcontentloaded'});
    const selectedLocalMode=await enterLocalModeIfNeeded(page);
    if(title)await page.getByRole('heading',{name:title,exact:true}).waitFor();
    if(selectedLocalMode)await page.getByText('本地模式 · 数据仅保存在此浏览器',{exact:true}).waitFor();
    const body=await page.locator('main').innerText();
    assert.ok(body.trim().length>30,`${name} did not render meaningful content`);
    rendered.push(name);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${baseUrl}/#/`,{waitUntil:'domcontentloaded'});
  await enterLocalModeIfNeeded(page);
  await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.ok(mobile.scrollWidth<=mobile.width+2,`Mobile horizontal overflow: ${JSON.stringify(mobile)}`);
  const deniedStoragePage=await context.newPage();
  deniedStoragePage.on('pageerror',(error)=>errors.push(error.message));
  await deniedStoragePage.addInitScript(()=>{
    Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage denied');}});
  });
  await deniedStoragePage.goto(`${baseUrl}/#/`,{waitUntil:'domcontentloaded'});
  await enterLocalModeIfNeeded(deniedStoragePage);
  await deniedStoragePage.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  await deniedStoragePage.close();
  assert.deepEqual(errors,[],'Production page errors');
  assert.deepEqual(blockedWrites,[],'Production UI attempted a write during read-only smoke');
  console.log(JSON.stringify({status:'PASS',rendered,mobile,deniedLocalStorage:'passed',pageErrors:errors,productionWrites:blockedWrites}));
  await context.close();
}finally{
  await closeBrowser();
}
