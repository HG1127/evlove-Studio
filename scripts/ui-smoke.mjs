import assert from 'node:assert/strict';
import path from 'node:path';
import {getBrowser,closeBrowser} from '../runner-gateway/browser-runner.mjs';
const output=process.argv[2];
assert.ok(output,'截图输出目录必填');
console.log('启动 UI 检查浏览器…');
const browser=await getBrowser();
console.log('浏览器已启动');
const errors=[];
const failedResponses=[];
const rows=[];
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1045}});
 console.log('检查上下文已创建');
 page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text().slice(0,450));});
 page.on('response',response=>{if(response.status()>=400)failedResponses.push({path:new URL(response.url()).pathname,status:response.status()});});
 for(const [name,route,title] of [['home','/','工作台'],['projects','/projects','进化任务'],['project','/projects/demo',''],['settings','/settings',''],['outputs','/outputs',''],['templates','/templates','']]){
  console.log(`检查 ${name}`);
  await page.goto(`http://127.0.0.1:8000/#${route}`);
  await page.locator('.studio-main').waitFor();
  if(title)await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.trim().length>30);
  await page.screenshot({path:path.join(output,`ui-${name}-desktop.png`)});
  rows.push({name,...await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,content:document.querySelector('main').innerText.slice(0,100)}))});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:8000/#/');
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'ui-home-mobile.png'),fullPage:true});
 rows.push({name:'home-mobile',...await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}))});
 await page.getByRole('button',{name:'粘贴内容',exact:true}).click();
 await page.getByPlaceholder('例如：当前 System Prompt、Workflow JSON、报告模板、代码片段……').waitFor();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 assert.equal(errors.length,0,errors.join('\n'));
 assert.ok(rows.every(row=>row.scrollWidth<=row.width+2),JSON.stringify(rows));
 console.log(JSON.stringify({status:'PASS',rows,pageErrors:errors,failedResponses,mobilePaste:'passed'},null,2));
 await context.close();
}catch(error){console.error(JSON.stringify({errors,failedResponses,rows,body:await page?.locator('body').innerText().catch(()=>''),failure:String(error)},null,2));throw error;}finally{await closeBrowser();}
