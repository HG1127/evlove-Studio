import {htmlSnapshotReview} from "@evolution/harness";

/** Review the document text without spending the evidence budget on presentation code. */
export function serverStaticArtifactReviewText(extension:string,text:string,maxChars:number){
  const review=/^(html|htm)$/.test(extension)&&text.length>maxChars?htmlSnapshotReview(text):undefined;
  return review?`${review.summary}\n正文全文（静态文本投影）：\n${review.text}\n证据边界：正文投影不包含脚本、样式、视觉和实际交互。`:text;
}
