import type {SandboxStepResult,TargetRunResult,TestCase} from "@evolution/contracts";

// A TestCase can bind a *specific* package.json script, e.g.
// tags:["npm-script:verify:checkout"]. This is not a shell command; the
// Sandbox executes only an actual package script by literal argv.
const SCRIPT_TAG_PREFIX="npm-script:";
const SAFE_SCRIPT_NAME=/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,99}$/;
export function sandboxTestScriptBindings(testCase:TestCase){
  const valid:string[]=[];
  const invalid:string[]=[];
  for(const tag of testCase.tags){
    if(!tag.startsWith(SCRIPT_TAG_PREFIX))continue;
    const name=tag.slice(SCRIPT_TAG_PREFIX.length);
    if(!SAFE_SCRIPT_NAME.test(name))invalid.push(tag);
    else if(!valid.includes(name))valid.push(name);
  }
  return{valid,invalid};
}
export function sandboxExecutedScripts(steps:readonly SandboxStepResult[]){
  const attempted:string[]=[];
  const outcome=new Map<string,boolean>();
  for(const step of steps){
    if(!step.id.startsWith("script-"))continue;
    const name=step.id.slice("script-".length);
    if(!attempted.includes(name))attempted.push(name);
    // A later failed retry must not borrow an earlier successful exit code.
    outcome.set(name,(outcome.get(name)??true)&&step.exitCode===0);
  }
  return{
    attempted,
    passed:attempted.filter(name=>outcome.get(name)===true),
    failed:attempted.filter(name=>outcome.get(name)===false),
  };
}

/** Attribute failed process steps to the exact TestCase that requested them.
 * Shared setup/runtime failure is NOT evidence that every target assertion failed. */
export function classifySandboxCaseFailure(args:{
  testCase:TestCase;
  steps:readonly SandboxStepResult[];
  error?:string;
}):{verificationStatus:"failed"|"unverified";reason:string}|undefined{
  const intent=sandboxTestIntent(args.testCase);
  const bindings=sandboxTestScriptBindings(args.testCase);
  const failed=args.steps.filter(step=>step.exitCode!==0);
  const failedNames=new Set(failed.filter(step=>step.id.startsWith("script-"))
    .map(step=>step.id.slice("script-".length)));
  const failedBound=bindings.valid.find(name=>failedNames.has(name));
  if(failedBound)return{
    verificationStatus:"failed",
    reason:`TestCase ${args.testCase.id} 的绑定脚本 ${failedBound} 实际执行失败。`,
  };
  const requiredFailure=failed.find(step=>{
    const name=step.id.startsWith("script-")?step.id.slice("script-".length):"";
    if(step.phase==="install")return false;
    if(name==="build"&&intent.build)return true;
    if((name==="typecheck"||name==="type-check"||name==="check-types"||name==="check:types"||name==="tsc")&&intent.typecheck)return true;
    if(name==="test"&&intent.test)return true;
    if(name==="integration"&&intent.integration)return true;
    if(step.phase==="e2e"&&intent.e2e)return true;
    return false;
  });
  if(requiredFailure)return{
    verificationStatus:"failed",
    reason:`TestCase ${args.testCase.id} 要求的 ${requiredFailure.phase} 验收步骤实际执行失败。`,
  };
  if(failed.length){
    const blocker=failed[0]!;
    return{
      verificationStatus:"unverified",
      reason:blocker.phase==="install"
        ?"依赖安装未通过，当前 TestCase 的目标脚本尚未执行，不能判定目标本身失败。"
        :`共享前置步骤 ${blocker.phase} 未通过，当前 TestCase 的专属断言未形成有效结果。`,
    };
  }
  if(args.error)return{
    verificationStatus:"unverified",
    reason:`Sandbox/Runner 在生成该 TestCase 的可判定证据前发生错误：${args.error}`,
  };
  return undefined;
}

export function sandboxCaseScriptTrace(
  testCase:TestCase,steps:readonly SandboxStepResult[],artifactHash:string,
):TargetRunResult["trace"]{
  const bindings=sandboxTestScriptBindings(testCase);
  const executed=sandboxExecutedScripts(steps);
  const passed=new Set(executed.passed);
  return[
    ...bindings.valid.map(name=>{
      const attempts=steps.filter(step=>step.id==="script-"+name);
      const status:TargetRunResult["trace"][number]["status"] =
        passed.has(name)?"pass":attempts.length?"fail":"warning";
      return{
        id:`sandbox-case-${testCase.id}-script-${name}`,stage:"script-binding",
        summary:`TestCase ${testCase.id} ↔ package.json script ${name}`,status,
        detail:JSON.stringify({testCaseId:testCase.id,scriptName:name,
          artifactHash,stepId:"script-"+name,exitCodes:attempts.map(step=>step.exitCode)}),
      };
    }),
    ...bindings.invalid.map(tag=>({
      id:`sandbox-case-${testCase.id}-invalid-binding`,stage:"script-binding",
      summary:"TestCase contains invalid or unsafe npm-script binding",status:"warning" as const,
      detail:tag.slice(0,128),
    })),
  ];
}

export function sandboxTestIntent(testCase:TestCase){
  // Script bindings are literal identifiers, not additional prose requirements.
  const text=[testCase.title,testCase.input,...testCase.expected,
    ...testCase.tags.filter(tag=>!tag.startsWith(SCRIPT_TAG_PREFIX))].join(" ");
  // "端到端测试"/"integration tests" specifies its own kind of test.
  // Do not invent an additional unit-test requirement just because a generic
  // word for testing occurs inside that more specific phrase.
  const standaloneTests=text
    .replace(/(?:\be2e\b|end.?to.?end|端到端|\bintegration\b|集成)[\s:：-]*(?:test(?:s)?|spec(?:s)?|测试|用例)/gi," ")
    .replace(/(?:test(?:s)?|spec(?:s)?|测试|用例)[\s:：-]*(?:\be2e\b|end.?to.?end|端到端|\bintegration\b|集成)/gi," ");
  return{
    build:/\b(build|compile|bundle)\b|构建|编译/i.test(text),
    typecheck:/\b(type.?check|check.?types|tsc)\b|类型检查/i.test(text),
    test:/\b(test|tests|spec|specs|unit)\b|测试|用例/i.test(standaloneTests),
    integration:/\bintegration\b|集成测试|集成验收/i.test(text),
    // A Browser Step is not automatically the repository's own E2E script.
    // Only an explicit end-to-end requirement mandates the project E2E command.
    e2e:/\be2e\b|end.?to.?end|端到端/i.test(text),
    browser:Boolean(testCase.browserSteps?.length),
  };
}
export function selectSandboxScriptPlan(scripts:Record<string,unknown>,testCases:TestCase[]){
  const has=(name:string)=>typeof scripts[name]==="string"&&Boolean((scripts[name] as string).trim());
  const intents=testCases.map(sandboxTestIntent);
  const scriptsToRun:string[]=[];
  if(has("build"))scriptsToRun.push("build");
  if(has("test")&&!/no test specified/i.test(String(scripts.test)))scriptsToRun.push("test");
  const typecheckScript=intents.some(item=>item.typecheck)
    ?["typecheck","type-check","check-types","check:types","tsc"].find(has):undefined;
  const integrationScript=intents.some(item=>item.integration)&&has("integration")?"integration":undefined;
  if(typecheckScript&&!scriptsToRun.includes(typecheckScript))scriptsToRun.push(typecheckScript);
  if(integrationScript&&!scriptsToRun.includes(integrationScript))scriptsToRun.push(integrationScript);
  const needsBehavior=testCases.some(needsSandboxBehaviorExecution);
  const boundE2EScript=testCases
    .flatMap(testCase=>sandboxTestScriptBindings(testCase).valid)
    .find(name=>has(name)&&/(?:^|[:_-])e2e(?:$|[:_-])/i.test(name));
  const explicitE2E=intents.some(item=>item.e2e)||Boolean(boundE2EScript);
  const e2eScript=needsBehavior
    ?(explicitE2E?boundE2EScript??["test:e2e","e2e"].find(has)
      :["test:e2e","e2e",...(integrationScript?[]:["integration"])].find(has))
    :undefined;
  for(const testCase of testCases){
    for(const script of sandboxTestScriptBindings(testCase).valid){
      // The specifically selected project E2E script runs in its own phase.
      if(has(script)&&script!==e2eScript&&!scriptsToRun.includes(script))scriptsToRun.push(script);
    }
  }
  return{scriptsToRun,typecheckScript,integrationScript,e2eScript,needsBehavior};
}

export function classifySandboxExecutionEvidence(args:{
  testCase:TestCase;
  buildRan:boolean;
  testRan:boolean;
  e2eRan:boolean;
  typecheckRan?:boolean;
  integrationRan?:boolean;
  passedScriptNames?:readonly string[];
}):{verificationStatus:TargetRunResult["verificationStatus"];proof:string}{
  const intent=sandboxTestIntent(args.testCase);
  const bindings=sandboxTestScriptBindings(args.testCase);
  const passed=new Set(args.passedScriptNames??[]);
  const missing=[...bindings.invalid.map(name=>"invalid "+name),
    ...bindings.valid.filter(name=>!passed.has(name))];
  if(intent.browser)return{
    verificationStatus:"unverified",
    proof:"本题要求逐步浏览器交互，但当前结果没有绑定浏览器断言；构建/测试通过不能代替 Browser Steps。",
  };
  if(args.testCase.evidenceScope==="implementation"){
    const hasExplicitExecutionIntent=intent.build||intent.typecheck||intent.test||intent.integration
      ||intent.e2e||bindings.valid.length>0||bindings.invalid.length>0;
    const requestedSatisfied=(!intent.build||args.buildRan)
      &&(!intent.typecheck||args.typecheckRan===true)
      &&(!intent.test||args.testRan)
      &&(!intent.integration||args.integrationRan===true)
      &&(!intent.e2e||args.e2eRan);
    const anyExecution=args.buildRan||args.typecheckRan===true||args.testRan||args.integrationRan===true||args.e2eRan;
    // The project's E2E command alone is a suite-wide smoke test. It does
    // not establish that THIS TestCase's scenario/assertions were exercised.
    // A case-specific Browser assertion may be VERIFIED by the separate port.
    // A generic passing E2E suite cannot verify a *specific* scenario. An
    // exact E2E-named script explicitly bound to this TestCase can do so.
    const specificE2E=bindings.valid.some(name=>/(?:^|[:_-])e2e(?:$|[:_-])/i.test(name)&&passed.has(name));
    const verified=hasExplicitExecutionIntent&&requestedSatisfied&&missing.length===0
      &&(anyExecution||bindings.valid.length>0)&&(!intent.e2e||specificE2E);
    return{
      verificationStatus:verified?"verified":"partial",
      proof:missing.length?"当前 TestCase 缺少精确 package.json 脚本凭证："+missing.join(", ")
        :intent.e2e&&args.e2eRan&&!specificE2E
          ?"工程 E2E 脚本通过，但缺少与当前 TestCase 绑定的独立 E2E 脚本/断言；只能记为 PARTIAL"
          :verified
            ?"实现级验收要求的指定脚本及 Build/Typecheck/Test/Integration 均成功执行"
            :"缺少明确验证目标，或要求的 Build/Typecheck/Test/Integration/E2E 没有对应成功凭证",
    };
  }
  if(args.e2eRan)return{
    verificationStatus:"partial",
    proof:"工程自带 E2E 脚本已通过，但未证明该项目专属 TestCase 与脚本逐项绑定",
  };
  return{verificationStatus:"partial",proof:"已运行工程检查，但尚未建立与本题验收目标绑定的独立行为证据"};
}
export function needsSandboxBehaviorExecution(testCase:TestCase){
  const intent=sandboxTestIntent(testCase);
  return testCase.evidenceScope==="product-behavior"
    ||testCase.executionMode==="visual-review"
    ||Boolean(testCase.browserSteps?.length)
    ||intent.e2e
    ||sandboxTestScriptBindings(testCase).valid.some(name=>/(?:^|[:_-])e2e(?:$|[:_-])/i.test(name));
}

/** A successful Browser assertion is not sufficient if the same TestCase also
 * requires Build, Typecheck, Test, Integration, or an E2E script. Keep the
 * browser evidence, but downgrade the *combined* acceptance to PARTIAL until
 * every explicitly requested script has actually completed successfully. */
export function classifySandboxBrowserWithScripts(args:{
  testCase:TestCase;
  browserStatus:TargetRunResult["verificationStatus"];
  buildRan:boolean;
  typecheckRan:boolean;
  testRan:boolean;
  integrationRan:boolean;
  e2eRan:boolean;
  e2eFailed:boolean;
  passedScriptNames?:readonly string[];
  failedScriptNames?:readonly string[];
}):{verificationStatus:TargetRunResult["verificationStatus"];missing:string[]}{
  const intent=sandboxTestIntent(args.testCase);
  const bindings=sandboxTestScriptBindings(args.testCase);
  const passed=new Set(args.passedScriptNames??[]);
  const failed=new Set(args.failedScriptNames??[]);
  const failedBound=bindings.valid.find(name=>failed.has(name));
  if(failedBound)return{verificationStatus:"failed",missing:["failed script "+failedBound]};
  if(args.browserStatus!=="verified")return{verificationStatus:args.browserStatus,missing:[]};
  const missing=[
    ...bindings.invalid.map(name=>"invalid "+name),
    ...bindings.valid.filter(name=>!passed.has(name)),
    intent.build&&!args.buildRan?"build":undefined,
    intent.typecheck&&!args.typecheckRan?"typecheck":undefined,
    intent.test&&!args.testRan?"test":undefined,
    intent.integration&&!args.integrationRan?"integration":undefined,
    intent.e2e&&!args.e2eRan?"e2e":undefined,
    args.e2eFailed?"failed e2e":undefined,
  ].filter((value):value is string=>Boolean(value));
  return{verificationStatus:missing.length?"partial":"verified",missing};
}
