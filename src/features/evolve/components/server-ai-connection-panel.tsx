import {useEffect,useRef,useState} from "react";
import {ServerAiConnectionPutSchema,type ServerAiConnectionStatus,type ServerAiConnectionPut,type ServerAiConnectionRole} from "@evolution/contracts";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {readServerAiConnection,saveServerAiConnection,testServerAiConnection} from "../ai/server-connection-client";
import {getPreset,normalizeBaseUrl} from "../ai/providers/byok";
import type {ProviderConnection} from "../ai/providers/registry";

export function ServerAiConnectionPanel({selected,role="generation"}:{selected?:ProviderConnection;role?:ServerAiConnectionRole}){
  const judge=role==="judge";
  const [status,setStatus]=useState<ServerAiConnectionStatus>();
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const statusReadSequence=useRef(0);
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
    const sequence=++statusReadSequence.current;
    readServerAiConnection(role).then((value)=>{
      if(active&&sequence===statusReadSequence.current)setStatus(value);
    }).catch((error:unknown)=>{if(active&&sequence===statusReadSequence.current)setMessage(error instanceof Error?error.message:"无法读取后端模型配置。");});
    return()=>{active=false;};
  },[role]);

  const preset=selected?getPreset(selected.providerId):undefined;
  const compatible=preset?.kind==="openai";
  const draft=selected&&compatible?ServerAiConnectionPutSchema.safeParse({
    connectionId:selected.id,label:selected.label,apiKey:selected.apiKey,
    baseUrl:normalizeBaseUrl(selected.baseUrl?.trim()||preset.defaultBaseUrl),
    model:selected.defaultModel,protocol,responseFormat,
  }):undefined;
  const input=draft?.success?draft.data:undefined;

  async function refreshStatus(){
    const sequence=++statusReadSequence.current;
    setBusy(true);
    setMessage("");
    try{
      const value=await readServerAiConnection(role);
      if(sequence!==statusReadSequence.current)return;
      setStatus(value);
      setMessage(value.connection?`已从后端重新读取：${value.connection.label} · ${value.connection.model}。`:value.storageConfigured?"后端模型保存服务已就绪，可以保存所选连接。":value.message);
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
        ++statusReadSequence.current;
        setStatus(undefined);
        const value=await saveServerAiConnection(input,role);
        setStatus(value);
        setMessage("已保存并从后端回读确认。"+(judge?" 保存和连接测试不代表已具备验收资格。":" 保存不代表模型已测通，请再点击“测试后端调用”。"));
      }else{
        const value=await testServerAiConnection(input);
        setMessage(value.ready&&judge?"验收模型连接测试通过；仍需独立校准，不能据此判定成果合格。":value.ready
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
    <CardHeader><CardTitle>{judge?"独立验收模型":"后端任务使用的模型"}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-slate-600">{judge?"用于评分、成果验收与发布复核，可选择与生成模型不同的连接。每轮评测固定连接，连接测试通过仍需独立校准。":"选择上方连接后，可把它保存给后台任务使用。接口地址和模型名由你填写，后端直接调用所选模型服务。"}</p>
      <p className="text-sm">{status?.connection
        ?<><b>{judge?"当前独立验收：":"当前后端默认："}</b>{status.connection.label} · {status.connection.model}</>
        :status?judge?"尚未配置独立验收模型，当前沿用后端默认模型，验收资格未验证。":"尚未保存后端默认模型。":"后端模型状态尚未确认。"}
      </p>
      {selected&&compatible?<div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">接口协议
          <select aria-label={judge?"验收模型接口协议":"后端模型接口协议"} className="mt-1 block rounded-lg border bg-white px-2 py-2" value={protocol} onChange={(event)=>updateOptions({protocol:event.target.value as typeof protocol})}>
            <option value="chat-completions">Chat Completions（常用）</option><option value="responses">Responses</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">JSON 输出方式
          <select aria-label={judge?"验收模型 JSON 输出方式":"后端模型 JSON 输出方式"} className="mt-1 block rounded-lg border bg-white px-2 py-2" value={responseFormat} onChange={(event)=>updateOptions({responseFormat:event.target.value as typeof responseFormat})}>
            <option value="json-object">JSON 模式（常用）</option><option value="json-schema">JSON Schema</option><option value="prompt-json">仅提示词 JSON</option>
          </select>
        </label>
        <Button disabled={busy||!input||status?.storageConfigured===false} onClick={()=>void act("save")}>{judge?"保存为独立验收模型":"保存为后端默认模型"}</Button>
        <Button variant="secondary" disabled={busy||!input} onClick={()=>void act("test")}>{judge?"测试验收模型连接":"测试后端调用"}</Button>
      </div>:<p className="text-xs text-slate-500">请先添加或选择“自定义中转（OpenAI 格式）”连接，填写 API Key、Base URL 和模型名。</p>}
      {selected&&compatible&&!input&&<p className="text-xs text-amber-700">请补齐 API Key、有效 Base URL 和完整模型 ID。</p>}
      <div className="flex flex-wrap items-center gap-2">
        {status?.storageConfigured===false&&<p className="text-xs text-amber-700">{status.message}</p>}
        {status?.configured&&status.revision!==undefined&&<p className="text-xs text-slate-500">后端保存版本：{status.revision}</p>}
        <Button variant="secondary" size="sm" disabled={busy} onClick={()=>void refreshStatus()}>{judge?"重新检查验收模型保存状态":"重新检查保存状态"}</Button>
      </div>
      {message&&<p role="status" className="rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
      <p className="text-xs text-slate-500">后端密钥加密保存，不会通过配置查询返回。切换后端模型会改变后续评测的模型身份，已有评测仍保留原证据。</p>
    </CardContent>
  </Card>;
}
