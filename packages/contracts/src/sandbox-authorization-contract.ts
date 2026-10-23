import {z} from "zod";
export const SandboxAuthorizationDiagnosticSchema=z.object({
  probeMode:z.literal("passive-config"),
  checkedAt:z.string().datetime(),
  state:z.enum(["expired","invalid","scope-mismatch","not-yet-valid","missing-local-oidc","access-token-incomplete","access-token-unverified","unverified"]),
  oidcPresent:z.boolean(),
  providerVerified:z.literal(false),
  issueCode:z.enum([
    "VERCEL_OIDC_EXPIRED","VERCEL_OIDC_INVALID","VERCEL_OIDC_NOT_YET_VALID",
    "VERCEL_PROJECT_SCOPE_MISMATCH","VERCEL_TEAM_SCOPE_MISMATCH",
    "VERCEL_ACCESS_TOKEN_INCOMPLETE",
  ]).optional(),
  expiresAt:z.string().datetime().optional(),
  message:z.string(),
  nextAction:z.string(),
});
export type SandboxAuthorizationDiagnostic=z.infer<typeof SandboxAuthorizationDiagnosticSchema>;
