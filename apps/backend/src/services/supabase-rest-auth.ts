/** New Supabase API keys are not JWTs and belong only in the apikey header. */
export function supabaseRestAuthHeaders(key:string):Record<string,string>{
  return {
    apikey:key,
    ...(!key.startsWith("sb_")?{Authorization:`Bearer ${key}`}:{})
  };
}
