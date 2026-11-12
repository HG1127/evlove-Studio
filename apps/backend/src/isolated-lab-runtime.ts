/** Strict runtime isolation for an explicitly opted-in P3 experiment.
 * Metadata and presence checks only: successful inspection is NOT a proof that a
 * supplied server secret belongs to the test project or that spend is capped.
 */
type Env=Record<string,string|undefined>;
const text=(value:string|undefined)=>value?.trim()??"";
const projectRef=(value:string)=>/^[a-z0-9]{12,32}$/.test(value);
const isTrue=(value:string)=>/^(1|true|yes|on)$/i.test(value);
function supabaseRef(raw:string){
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.pathname!=="/"||url.search||url.hash||url.username||url.password)return undefined;
    return /^([a-z0-9]{12,32})\.supabase\.co$/.exec(url.hostname)?.[1];
  }catch{return undefined;}
}

export function inspectIsolatedLabRuntime(env:Env){
  if(text(env.EVOLUTION_EXPERIMENT_MODE)!=="isolated")return {isolated:false,ready:true,codes:[] as string[]};
  const codes:string[]=[];
  const add=(code:string)=>{if(!codes.includes(code))codes.push(code);};
  const labRef=text(env.EVOLUTION_TEST_SUPABASE_PROJECT_REF);
  const productionRef=text(env.EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF);
  const boundRef=supabaseRef(text(env.SUPABASE_URL));
  const declaredRef=supabaseRef(text(env.EVOLUTION_TEST_SUPABASE_URL));

  if(text(env.VERCEL_ENV)==="production"||text(env.EVOLUTION_EXPERIMENT_TARGET)==="production")add("LAB_PRODUCTION_DEPLOYMENT_FORBIDDEN");
  if(!projectRef(labRef)||!projectRef(productionRef)||labRef===productionRef)add("LAB_DISTINCT_PROJECT_REFS_REQUIRED");
  if(!boundRef||boundRef!==labRef||boundRef===productionRef||!declaredRef||declaredRef!==labRef)add("LAB_DATA_PLANE_BINDING_MISMATCH");
  const viteUrl=text(env.VITE_SUPABASE_URL);
  if(viteUrl&&supabaseRef(viteUrl)!==labRef)add("LAB_FRONTEND_DATA_PLANE_MISMATCH");

  const secret=text(env.SUPABASE_SECRET_KEY);
  if(!secret||secret.length<24||secret===text(env.SUPABASE_PUBLISHABLE_KEY)||secret===text(env.VITE_SUPABASE_ANON_KEY))add("LAB_SERVER_SECRET_REQUIRED");
  if(text(env.SUPABASE_SERVICE_ROLE_KEY)&&text(env.SUPABASE_SERVICE_ROLE_KEY)!==secret)add("LAB_AMBIGUOUS_SERVICE_CREDENTIALS");
  const bucket=text(env.SUPABASE_ARTIFACT_BUCKET);
  if(!/^evolve-audit-[a-z0-9-]{4,48}$/.test(bucket)
    ||text(env.EVOLUTION_TEST_ARTIFACT_BUCKET)!==bucket)add("LAB_DEDICATED_BUCKET_REQUIRED");
  if(!/^lab-[a-z0-9-]{6,80}$/.test(text(env.EVOLUTION_WORKSPACE_ID)))add("LAB_WORKSPACE_REQUIRED");
  if(text(env.EVOLUTION_IDENTITY_HMAC_SECRET).length<32||isTrue(text(env.EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH))
    ||isTrue(text(env.EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH)))add("LAB_TRUSTED_IDENTITY_REQUIRED");
  if(text(env.EVOLUTION_VAULT_MASTER_KEY).length<32
    ||!/^lab-[a-z0-9-]{4,80}$/.test(text(env.EVOLUTION_VAULT_KEY_ID)))add("LAB_DISTINCT_VAULT_REQUIRED");
  if(!/^[a-f0-9]{64}$/i.test(text(env.EVOLUTION_OPERATOR_ACCESS_KEY)))add("LAB_OPERATOR_ACCESS_REQUIRED");
  if(text(env.EVOLUTION_EVIDENCE_SIGNING_KEY).length<32
    ||!/^lab-[a-z0-9-]{4,80}$/.test(text(env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID)))add("LAB_EVIDENCE_SIGNING_REQUIRED");
  return {isolated:true,ready:codes.length===0,codes};
}
