import {useEffect,useState} from "react";
import {ServerAiConnectionPutSchema,type ServerAiConnectionStatus,type ServerAiConnectionPut} from "@evolution/contracts";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {readServerAiConnection,saveServerAiConnection,testServerAiConnection} from "../ai/server-connection-client";
import {getPreset,normalizeBaseUrl} from "../ai/providers/byok";
import type {ProviderConnection} from "../ai/providers/registry";

export function ServerAiConnectionPanel({selected}:{selected?:ProviderConnection}){
  const [status,setStatus]=useState<ServerAiConnectionStatus>();
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  type Options=Pick<ServerAiConnectionPut,"protocol"|"responseFormat">;
  const [draftOptions,setDraftOptions]=useState<Record<string,Options>>({});
  const saved=status?.connection;
  const savedOptions=saved?.connectionId===selected?.id?saved:undefined;
  const options=selected?draftOptions[selected.id]??savedOptions:undefined;
  const protocol=options?.protocol??"chat-completions";
  const responseFormat=options?.responseFormat??"json-object";

  function updateOptions(change:Partial<Options>){
    if(!selected)return;
    setDraftOptions((current)=>({...current,[selected.id]:{protocol,responseFormat,...change}}));
  }

  useEffect(()=>{
    let active=true;
    readServerAiConnection().then((value)=>{
      if(active)setStatus(value);
    }).catch((error:unknown)=>{if(active)setMessage(error instanceof Error?error.message:"无法读取后端模型配置。");});
    return()=>{active=false;};
  },[]);

  const preset=selected?getPreset(selected.providerId):undefined;
  const compatible=preset?.kind==="openai";
  const draft=selected&&compatible?ServerAiConnectionPutSchema.safeParse({
    connectionId:selected.id,label:selected.label,apiKey:selected.apiKey,
    baseUrl:normalizeBaseUrl(selected.baseUrl?.trim()||preset.defaultBaseUrl),
    model:selected.defaultModel,protocol,responseFormat,
  }):undefined;
  const input=draft?.success?draft.data:undefined;

  async function refreshStatus(){
    setBusy(true);
    setMessage("");
    try{
      const value=await readServerAiConnection();
      setStatus(value);
      setMessage(value.storageConfigured?"后端模型保存服务已就绪，可以保存所选连接。":value.message);
    }catch(error){
      setMessage(error instanceof Error?error.message:"无法读取后端模型配置。");
    }finally{setBusy(false);}
  }

  async function act(action:"save"|"test"){
    if(!input)return;
    setBusy(true);
    setMessage("");
    try{
      if(action==="save"){
        const value=await saveServerAiConnection(input);
        setStatus(value);
        setMessage(value.message+" 保存不代表模型已测通，请再点击“测试后端调用”。");
      }else{
        const value=await testServerAiConnection(input);
        setMessage(value.ready
          ?status?.storageConfigured===false
            ?"后端真实模型调用通过。加密保存服务启用后，可设为后台任务的默认模型。"
            :"后端真实模型调用通过；可将此连接保存为后端默认模型。"
          :value.message);
      }
    }catch(error){
      setMessage(error instanceof Error?error.message:"后端模型操作未完成。");
    }finally{setBusy(false);}
  }

  return <Card>
    <CardHeader><CardTitle>后端任务使用的模型</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-slate-600">选择上方连接后，可把它保存给后台任务使用。接口地址和模型名由你填写，后端直接调用所选模型服务。</p>
      <p className="text-sm">{status?.connection
        ?<><b>当前后端默认：</b>{status.connection.label} · {status.connection.model}</>
        :status?"尚未保存后端默认模型。":"后端模型状态尚未确认。"}
      </p>
      {selected&&compatible?<div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">接口协议
          <select aria-label="后端模型接口协议" className="mt-1 block rounded-lg border bg-white px-2 py-2" value={protocol} onChange={(event)=>updateOptions({protocol:event.target.value as typeof protocol})}>
            <option value="chat-completions">Chat Completions（常用）</option><option value="responses">Responses</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">JSON 输出方式
          <select aria-label="后端模型 JSON 输出方式" className="mt-1 block rounded-lg border bg-white px-2 py-2" value={responseFormat} onChange={(event)=>updateOptions({responseFormat:event.target.value as typeof responseFormat})}>
            <option value="json-object">JSON 模式（常用）</option><option value="json-schema">JSON Schema</option><option value="prompt-json">仅提示词 JSON</option>
          </select>
        </label>
        <Button disabled={busy||!input||status?.storageConfigured===false} onClick={()=>void act("save")}>保存为后端默认模型</Button>
        <Button variant="secondary" disabled={busy||!input} onClick={()=>void act("test")}>测试后端调用</Button>
      </div>:<p className="text-xs text-slate-500">请先添加或选择“自定义中转（OpenAI 格式）”连接，填写 API Key、Base URL 和模型名。</p>}
      {selected&&compatible&&!input&&<p className="text-xs text-amber-700">请补齐 API Key、有效 Base URL 和完整模型 ID。</p>}
      {status?.storageConfigured===false&&<div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-amber-700">{status.message}</p>
        <Button variant="secondary" size="sm" disabled={busy} onClick={()=>void refreshStatus()}>重新检查保存状态</Button>
      </div>}
      {message&&<p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
      <p className="text-xs text-slate-500">后端密钥加密保存，不会通过配置查询返回。切换后端模型会改变后续评测的模型身份，已有评测仍保留原证据。</p>
    </CardContent>
  </Card>;
}
