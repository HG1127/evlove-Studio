/** Trusted browser setup. Document bytes never become host-side JavaScript. */
export async function createLocalNativePage(browser,html){
 const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,reducedMotion:'reduce',viewport:{width:1440,height:960}});
 const blocked=[],pageErrors=[];let page;
 try{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  await context.routeWebSocket('**/*',route=>{blocked.push('websocket');route.close();});
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin==='http://127.0.0.1:4173'&&url.pathname==='/'&&request.method()==='GET'&&request.isNavigationRequest()&&request.frame().page()===page&&!request.frame().parentFrame())return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:Buffer.from(html),headers:{'X-DNS-Prefetch-Control':'off','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'"}});
   blocked.push(url.origin);return route.abort();
  });
  page=await context.newPage();page.setDefaultTimeout(3500);
  context.on('page',popup=>{if(popup!==page){blocked.push('popup');void popup.close();}});
  page.on('dialog',dialog=>{pageErrors.push('unexpected-dialog');void dialog.dismiss();});
  page.on('pageerror',error=>pageErrors.push(error.name+': '+error.message.slice(0,180)));
  return {context,page,blocked,pageErrors};
 }catch(error){await context.close();throw error;}
}
