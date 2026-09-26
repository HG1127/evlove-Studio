import {createError} from "nitro/h3";
import {z} from "zod";

const CollectionPageQuerySchema=z.object({
  pageLimit:z.coerce.number().int().min(1).max(100).default(100),
  cursor:z.string().min(1).max(512).optional(),
});
const MissionScopeSchema=z.string().trim().min(1).max(200);

export function collectionPageQuery(query:Record<string,unknown>){
  if(query.pageLimit===undefined&&query.cursor===undefined)return undefined;
  const parsed=CollectionPageQuerySchema.safeParse(query);
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid collection page query"});
  return parsed.data;
}

export function collectionMissionId(query:Record<string,unknown>){
  if(query.missionId===undefined)return undefined;
  const parsed=MissionScopeSchema.safeParse(query.missionId);
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Mission scope"});
  return parsed.data;
}
