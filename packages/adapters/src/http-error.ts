import {z} from "zod";

const ApiErrorDetailSchema=z.object({
  statusMessage:z.string().optional(),message:z.string().optional(),error:z.unknown().optional(),
  data:z.object({message:z.string().optional()}).passthrough().optional(),
}).passthrough();

/** Read only public error fields; never surface stack traces or an internal cause. */
export function httpApiErrorDetail(value:unknown):string|undefined{
  const parsed=ApiErrorDetailSchema.safeParse(value);
  if(!parsed.success)return undefined;
  const record=parsed.data;
  for(const detail of [record.data?.message,record.statusMessage,record.message,record.error]){
    if(typeof detail==="string"&&detail.trim()&&!/^(?:HTTPError|Internal Server Error|Error)$/i.test(detail.trim())){
      return detail.trim().slice(0,300);
    }
  }
  return undefined;
}
