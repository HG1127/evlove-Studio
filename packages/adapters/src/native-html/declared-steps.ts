// Trusted VM-only function source. Host tests supply a synthetic page port; no user HTML is evaluated here.
export const HTML_NATIVE_DECLARED_STEPS_SOURCE=`async function runDeclaredBrowserPlans(page, assertions, record) {
  for (const [planIndex, plan] of (assertions?.plans ?? []).entries()) {
    await page.reload({waitUntil:'domcontentloaded',timeout:12000});
    for (const [stepIndex, step] of plan.entries()) {
      let pass=false;
      try {
        const locator=page.locator(step.selector);
        if(step.action==='fill'){await locator.fill(step.value);pass=true;}
        else if(step.action==='visible')pass=await locator.isVisible();
        else if(step.action==='text')pass=(await locator.innerText()).includes(step.value);
        else if(step.action==='count')pass=await locator.count()===step.count;
      } catch { pass=false; }
      record('declared-browser-'+planIndex+'-'+stepIndex,pass,{tested:1,failed:pass?0:1});
    }
  }
  if(assertions?.plans.length)await page.reload({waitUntil:'domcontentloaded',timeout:12000});
}`;
