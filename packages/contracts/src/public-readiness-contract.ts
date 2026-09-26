import {z} from "zod";

export const PublicReadinessBlockerSchema=z.object({
  code:z.string().min(1),
  severity:z.enum(["error","warning","info"]),
  area:z.enum(["data-plane","security","ai","release","git","connectors","target","outcome"]),
  message:z.string().min(1),
  action:z.string().min(1),
  configurationOnly:z.literal(true).default(true),
});
export type PublicReadinessBlocker=z.infer<typeof PublicReadinessBlockerSchema>;

export const PublicReadinessSnapshotSchema=z.object({
  probeMode:z.literal("passive-config"),
  checkedAt:z.string(),
  blockers:z.array(PublicReadinessBlockerSchema).default([]),
  workflow:z.object({durable:z.boolean(),cronConfigured:z.boolean().default(false)}),
  dataPlane:z.object({
    configured:z.boolean(),
    secureCredential:z.boolean(),
    database:z.boolean(),
    storage:z.boolean(),
    coreTables:z.boolean(),
    credentialMode:z.enum(["secret","publishable","missing"]),
    urlPresent:z.boolean(),
    secretPresent:z.boolean(),
    publishablePresent:z.boolean(),
    artifactBucketPresent:z.boolean(),
    configValid:z.boolean(),
    issueFields:z.array(z.string()),
  }),
  sourceParse:z.boolean(),
  artifactRenderer:z.boolean(),
  serverAi:z.boolean(),
  sandbox:z.boolean(),
  sandboxPolicy:z.boolean(),
  browser:z.boolean(),
  release:z.object({read:z.boolean(),write:z.boolean()}),
  git:z.object({configured:z.boolean(),webhook:z.boolean()}),
  capability:z.object({database:z.boolean(),semantic:z.boolean(),sharing:z.boolean()}),
  evidence:z.object({database:z.boolean(),signing:z.boolean(),immutable:z.boolean(),export:z.boolean()}),
  outcome:z.object({database:z.boolean(),ingestion:z.boolean(),analysis:z.boolean(),telemetry:z.boolean()}),
  security:z.object({
    configured:z.boolean(),
    browserAccessConfigured:z.boolean().default(false),
    enforced:z.boolean(),
    productionSafe:z.boolean(),
    vault:z.boolean(),
    approvalStore:z.boolean(),
    memberDirectory:z.boolean(),
  }),
  connectors:z.object({configured:z.boolean(),fullLifecycle:z.boolean()}),
  targetProxy:z.object({run:z.boolean(),release:z.boolean(),observe:z.boolean().default(false)}),
});
export type PublicReadinessSnapshot=z.infer<typeof PublicReadinessSnapshotSchema>;
