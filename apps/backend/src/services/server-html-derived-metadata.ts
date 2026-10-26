import {compileKnownHtmlDerivedMetadata,isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";

/** Compilation of model-authored content, before freezing; never a post-acceptance file rewrite. */
export async function compileServerHtmlDerivedMetadata(args:{extension:string;content:string;parentText:string;readOriginal:()=>Promise<string>}){
  if(!/^html?$/i.test(args.extension)||args.content.trim()===args.parentText.trim()||!isKnownHtmlNativeSubject(args.content))return {content:args.content,checks:[] as string[]};
  const compiled=compileKnownHtmlDerivedMetadata(await args.readOriginal(),args.content);
  return {content:compiled.html,checks:[
    ...(compiled.updatedIds.length?[`HTML 原生编译：${compiled.updatedIds.length} 个正文搜索索引已同步，原始关键词保留；脚本、样式和正文文本未改写。`]:[]),
    ...(compiled.reflowedIds?.length?[`HTML 正文布局编译：${compiled.reflowedIds.length} 个页面的预格式说明保持原块字节，新增文字移至普通正文段落；全文文字保留。`]:[]),
  ]};
}
