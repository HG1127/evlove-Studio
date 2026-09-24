import {createError} from "nitro/h3";
import {z} from "zod";

const CollectionPageQuerySchema=z.object({
  pageLimit:z.coerce.number().int().min(1).max(100).default(100),
  cursor:z.string().min(1).max(512).optional(),
});

export function collectionPageQuery(query:Record<string,unknown>){
  if(query.pageLimit===undefined&&query.cursor===undefined)return undefined;
  const parsed=CollectionPageQuerySchema.safeParse(query);
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid collection page query"});
  return parsed.data;
}
