import {z} from "zod";

export const ProductionBuildInfoSchema=z.object({
  commitSha:z.string().min(1).optional(),
  commitRef:z.string().min(1).optional(),
  vercelEnvironment:z.enum(["production","preview","development"]).optional(),
  deploymentHost:z.string().min(1).optional(),
  checkedAt:z.string().datetime(),
});
export type ProductionBuildInfo=z.infer<typeof ProductionBuildInfoSchema>;
