import {z} from "zod";

const ApiErrorDetailSchema=z.object({
  statusMessage:z.string().optional(),message:z.string().optional(),error:z.unknown().optional(),
  data:z.object({message:z.string().optional()}).passthrough().optional(),
}).passthrough();
const DataPlaneFailureSchema=z.object({
  code:z.literal("SERVER_DATA_PLANE_UNAVAILABLE"),
  reason:z.enum(["credential-rejected","schema-unavailable","rate-limited-or-timeout","upstream-unavailable","network-error","invalid-response"]),
});
const dataPlaneMessages={
  "credential-rejected":"后台数据库拒绝访问，请管理员检查服务端数据库凭据与权限。",
  "schema-unavailable":"后台数据库表或接口尚未就绪，请管理员检查迁移状态。",
  "rate-limited-or-timeout":"后台数据服务限流或超时，正在自动重试。",
  "upstream-unavailable":"后台数据服务暂不可用，正在自动重试。",
  "network-error":"后端无法连接数据服务，正在自动重试。",
  "invalid-response":"后台返回的数据不完整，本次同步未完成。",
} as const;

/** Read only public error fields; never surface stack traces or an internal cause. */
export function httpApiErrorDetail(value:unknown):string|undefined{
  const parsed=ApiErrorDetailSchema.safeParse(value);
  if(!parsed.success)return undefined;
  const record=parsed.data;
  const failure=DataPlaneFailureSchema.safeParse(record.data);
  if(failure.success)return dataPlaneMessages[failure.data.reason];
  for(const detail of [record.data?.message,record.statusMessage,record.message,record.error]){
    if(typeof detail==="string"&&detail.trim()&&!/^(?:HTTPError|Internal Server Error|Error)$/i.test(detail.trim())){
      return detail.trim().slice(0,300);
    }
  }
  return undefined;
}
