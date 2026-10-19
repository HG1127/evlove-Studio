import {createHash} from "node:crypto";
import {z} from "zod";
import {
  AiModelIdSchema,ServerAiBaseUrlSchema,ServerAiConnectionSettingsSchema,VaultSecretMetadataSchema,
  type ServerAiConnectionSettings,type VaultSecretMetadata,
} from "@evolution/contracts";

export const SERVER_AI_CONNECTION_VAULT_ID="server-ai-default-connection-v1";
export const SERVER_AI_CONNECTION_VAULT_SCOPE="ai:default-connection";

/** Public material only; execution credentials and deadlines are never fingerprint inputs. */
export const ServerAiPublicScoringRouteSchema=z.discriminatedUnion("mode",[
  z.object({mode:z.literal("openai-compatible"),baseUrl:ServerAiBaseUrlSchema,model:AiModelIdSchema,
    protocol:z.enum(["chat-completions","responses"]).optional(),
    responseFormat:z.enum(["json-schema","json-object","prompt-json"]).optional()}).strict(),
  z.object({mode:z.literal("vercel-gateway"),model:AiModelIdSchema}).strict(),
]);
export type ServerAiPublicScoringRoute=z.infer<typeof ServerAiPublicScoringRouteSchema>;

const publicMetadata=VaultSecretMetadataSchema.extend({
  version:z.number().int().positive().safe(),scopes:z.array(z.string()).max(30),
  createdAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),
}).strict();
export const ServerAiPublicSelectionSchema=z.object({
  version:z.literal("server-ai-public-selection-v1"),source:z.literal("vault"),
  settings:ServerAiConnectionSettingsSchema.strict(),metadata:publicMetadata,
  sealedRecordSha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(selection=>selection.metadata.id===SERVER_AI_CONNECTION_VAULT_ID,
  {message:"Wrong default AI Vault identity"});
export type ServerAiPublicSelection=z.infer<typeof ServerAiPublicSelectionSchema>;
export type ServerAiPublicSelectionUnavailableReason=
  |"public-selection-unbound"|"public-selection-invalid"|"public-selection-metadata-unavailable"
  |"public-selection-metadata-drift"|"public-selection-workspace-drift"
  |"environment-credential-epoch-unavailable"|"current-route-unconfigured";
export type ServerAiPublicSelectionResult=
  |{availability:"available";selection:ServerAiPublicSelection;selectionIdentitySha256:string}
  |{availability:"unavailable";reason:ServerAiPublicSelectionUnavailableReason};

function canonical(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value)
    .sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([key,item])=>JSON.stringify(key)+":"+canonical(item)).join(",")+"}";
  return JSON.stringify(value);
}

export function serverAiPublicSelectionIdentity(raw:ServerAiPublicSelection):string{
  return createHash("sha256").update(canonical(ServerAiPublicSelectionSchema.parse(raw))).digest("hex");
}

/** Called only with public settings extracted from the same authenticated execution row. */
export function serverAiPublicSelectionFromResolvedRecord(
  settings:ServerAiConnectionSettings,record:{metadata:VaultSecretMetadata;sealedRecordSha256:string},
):ServerAiPublicSelection{
  return ServerAiPublicSelectionSchema.parse({version:"server-ai-public-selection-v1",source:"vault",
    settings:ServerAiConnectionSettingsSchema.parse(settings),metadata:VaultSecretMetadataSchema.parse(record.metadata),
    sealedRecordSha256:record.sealedRecordSha256});
}

export function serverAiPublicSelectionRoute(raw:ServerAiPublicSelection):ServerAiPublicScoringRoute{
  const selection=ServerAiPublicSelectionSchema.parse(raw);
  const {baseUrl,model,protocol,responseFormat}=selection.settings;
  return ServerAiPublicScoringRouteSchema.parse({mode:"openai-compatible",baseUrl,model,protocol,responseFormat});
}

/**
 * Independent current-state check, not an authority constructor. Historical callers must first
 * authenticate their signed selection and complete owner/input context. Every invocation reads
 * current sealed-row identity; it never decrypts another key or consumes an AsyncLocalStorage config.
 */
export async function readCurrentServerAiPublicSelection(
  raw:unknown,ports:{workspaceId():string|undefined;readRecordIdentity(id:string):Promise<unknown>},
):Promise<ServerAiPublicSelectionResult>{
  const parsed=ServerAiPublicSelectionSchema.safeParse(raw);
  if(!parsed.success)return {availability:"unavailable",reason:"public-selection-invalid"};
  const selection=parsed.data;
  if(ports.workspaceId()!==selection.metadata.workspaceId)
    return {availability:"unavailable",reason:"public-selection-workspace-drift"};
  let current:{metadata:VaultSecretMetadata;sealedRecordSha256:string};
  try{
    current=z.object({metadata:publicMetadata,sealedRecordSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
      .parse(await ports.readRecordIdentity(SERVER_AI_CONNECTION_VAULT_ID));
  }catch{return {availability:"unavailable",reason:"public-selection-metadata-unavailable"};}
  // Read workspace again after I/O, rather than trusting a value captured before the request.
  if(ports.workspaceId()!==selection.metadata.workspaceId||current.metadata.workspaceId!==selection.metadata.workspaceId)
    return {availability:"unavailable",reason:"public-selection-workspace-drift"};
  if(canonical(current.metadata)!==canonical(selection.metadata)||current.sealedRecordSha256!==selection.sealedRecordSha256)
    return {availability:"unavailable",reason:"public-selection-metadata-drift"};
  return {availability:"available",selection,selectionIdentitySha256:serverAiPublicSelectionIdentity(selection)};
}
