import {compileKnownHtmlDerivedMetadata,isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";
import {assertHtmlOriginalCodeRetention,assertHtmlParagraphConstruction,assertHtmlNumberedListConstruction,HtmlSemanticLayoutError} from "@evolution/core";
import {isServerHtmlConstructionCheckError,ServerHtmlConstructionPreflightError,type ServerHtmlConstructionFailure} from "./server-html-construction-preflight";

/** Compilation of model-authored content, before freezing; never a post-acceptance file rewrite. */
export async function compileServerHtmlDerivedMetadata(args:{extension:string;content:string;parentText:string;readOriginal:()=>Promise<string>}){
  if(!/^html?$/i.test(args.extension)||args.content.trim()===args.parentText.trim()||!isKnownHtmlNativeSubject(args.content))return {content:args.content,checks:[] as string[]};
  const original=await args.readOriginal();
  const failures:ServerHtmlConstructionFailure[]=[];
  let compiled,stage:ServerHtmlConstructionFailure["stage"]="after-layout";
  try{compiled=compileKnownHtmlDerivedMetadata(original,args.content);}
  catch(error){
    if(!(error instanceof HtmlSemanticLayoutError))throw error;
    // No layout result exists. Other observations are explicitly preliminary;
    // successful correction must still pass compilation and every final check.
    stage="before-layout";failures.push({stage,error});compiled={html:args.content,updatedIds:[] as string[],reflowedIds:[] as string[]};
  }
  const check=<T>(run:()=>T)=>{try{return run();}catch(error){if(!isServerHtmlConstructionCheckError(error))throw error;failures.push({stage,error});return undefined;}};
  const retention=check(()=>assertHtmlOriginalCodeRetention(original,compiled.html));
  const paragraphs=check(()=>assertHtmlParagraphConstruction(original,compiled.html));
  const numbered=check(()=>assertHtmlNumberedListConstruction(original,compiled.html));
  if(failures.length>1)throw new ServerHtmlConstructionPreflightError(failures);
  if(failures.length)throw failures[0]!.error;
  return {content:compiled.html,checks:[
    ...(compiled.updatedIds.length?[`HTML 原生编译：${compiled.updatedIds.length} 个正文搜索索引已同步，原始关键词保留；脚本、样式和正文文本未改写。`]:[]),
    ...(compiled.reflowedIds?.length?[`HTML 正文布局编译：${compiled.reflowedIds.length} 个页面的预格式说明保持原块字节，新增文字移至普通正文段落；全文文字保留。`]:[]),
    ...(compiled.projectedToolCardIds?.length?[`HTML 工具卡片正文编译：${compiled.projectedToolCardIds.length} 个页面的原始代码块说明补入单个可见段落槽；保持原块字节，显示槽不重复已匹配的自动序号，不代表语义或验收通过。`]:[]),
    ...(retention?.originalCount?[`HTML 构建前置检查：${retention.retainedCount}/${retention.originalCount} 个原始代码／指令块按既有静态策略保留；不替代原生与语义验收。`]:[]),
    ...(paragraphs?.checkedParagraphs?[`HTML 新段落构建预算：${paragraphs.checkedParagraphs} 个新增或修改段落通过静态长度检查；不代表渲染可读性或验收通过。`]:[]),
    ...(numbered?.checkedLists?[`HTML 编号列表构建检查（${numbered.policy}）：${numbered.checkedLists} 个修改列表的显式编号连续；不证明操作含义保留或验收通过。`]:[]),
  ]};
}
