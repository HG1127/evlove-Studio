import { createError, getRouterParam, type H3Event } from "nitro/h3";
import { ArtifactIdSchema } from "@evolution/contracts";

/** Decode the transport segment exactly once; Artifact IDs are logical keys, not paths. */
export function artifactRouteId(event: H3Event) {
  const encoded = getRouterParam(event, "id");
  let id: string | undefined;
  try { id = encoded === undefined ? undefined : decodeURIComponent(encoded); }
  catch { throw createError({ statusCode: 400, statusMessage: "Invalid encoded Artifact id" }); }
  const parsed = ArtifactIdSchema.safeParse(id);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Invalid Artifact id" });
  return parsed.data;
}
