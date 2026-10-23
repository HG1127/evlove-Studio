import {compileKnownHtmlDerivedMetadata,isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";

/** Compilation of model-authored content, before freezing; never a post-acceptance file rewrite. */
export async function compileServerHtmlDerivedMetadata(args:{extension:string;content:string;parentText:string;readOriginal:()=>Promise<string>}){
  if(!/^html?$/i.test(args.extension)||args.content.trim()===args.parentText.trim()||!isKnownHtmlNativeSubject(args.content))return {content:args.content,checks:[] as string[]};
  const compiled=compileKnownHtmlDerivedMetadata(await args.readOriginal(),args.content);
  return {content:compiled.html,checks:compiled.updatedIds.length
    ?[`HTML 原生编译：${compiled.updatedIds.length} 个正文搜索索引已同步，原始关键词保留；脚本、样式和正文未由编译器改写。`]:[]};
}
