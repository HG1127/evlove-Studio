import {compileKnownHtmlDerivedMetadata,isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";
import {assertHtmlOriginalCodeRetention} from "@evolution/core";

/** Compilation of model-authored content, before freezing; never a post-acceptance file rewrite. */
export async function compileServerHtmlDerivedMetadata(args:{extension:string;content:string;parentText:string;readOriginal:()=>Promise<string>}){
  if(!/^html?$/i.test(args.extension)||args.content.trim()===args.parentText.trim()||!isKnownHtmlNativeSubject(args.content))return {content:args.content,checks:[] as string[]};
  const original=await args.readOriginal();
  const compiled=compileKnownHtmlDerivedMetadata(original,args.content);
  const retention=assertHtmlOriginalCodeRetention(original,compiled.html);
  return {content:compiled.html,checks:[
    ...(compiled.updatedIds.length?[`HTML 原生编译：${compiled.updatedIds.length} 个正文搜索索引已同步，原始关键词保留；脚本、样式和正文文本未改写。`]:[]),
    ...(compiled.reflowedIds?.length?[`HTML 正文布局编译：${compiled.reflowedIds.length} 个页面的预格式说明保持原块字节，新增文字移至普通正文段落；全文文字保留。`]:[]),
    ...(retention.originalCount?[`HTML 构建前置检查：${retention.retainedCount}/${retention.originalCount} 个原始代码／指令块按既有静态策略保留；不替代原生与语义验收。`]:[]),
  ]};
}
