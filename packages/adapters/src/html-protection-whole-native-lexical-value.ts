import { z } from "zod";
import type { CDPSession } from "@playwright/test";
const Properties = z.object({ result: z.array(z.object({ name: z.string(), value: z.unknown().optional(), get: z.unknown().optional(), set: z.unknown().optional() }).passthrough()).max(5000), internalProperties: z.array(z.object({ name: z.string(), value: z.unknown() }).passthrough()).max(32).optional(), exceptionDetails: z.unknown().optional() }).passthrough();
const ObjectId = z.object({ objectId: z.string().min(1) }).passthrough();
const Handler = z.object({ scriptId: z.string().min(1), lineNumber: z.number().int().nonnegative(), columnNumber: z.number().int().nonnegative() }).strict();
/** Native inspector data descriptors only. No subject getter, handler, eval, function replay or page JSON is executed. */
export async function readHtmlProtectionWholeNativeLexicalString(args: {
 cdp: CDPSession; backendNodeId: number; defaultContext: { id: number; uniqueId: string; frameId: string }; objectGroup: string;
 handler: z.infer<typeof Handler>; bindingName: string; active: () => Promise<void>;
}) {
 const handler = Handler.parse(args.handler); z.string().min(1).max(512).parse(args.bindingName); await args.active();
 const object = ObjectId.parse(z.object({ object: z.unknown() }).strict().parse(await args.cdp.send("DOM.resolveNode", { backendNodeId: args.backendNodeId, executionContextId: args.defaultContext.id, objectGroup: args.objectGroup })).object);
 const identity = z.object({ node: z.object({ backendNodeId: z.number().int().positive() }) }).passthrough().parse(await args.cdp.send("DOM.describeNode", { objectId: object.objectId }));
 if (identity.node.backendNodeId !== args.backendNodeId) throw Error("native-clipboard-lexical-target-drift");
 const listeners = z.object({ listeners: z.array(z.object({ type: z.string(), scriptId: z.string(), lineNumber: z.number().int(), columnNumber: z.number().int(), backendNodeId: z.number().int().positive().optional(), handler: ObjectId.optional(), originalHandler: ObjectId.optional() }).passthrough()).max(5000) }).strict().parse(await args.cdp.send("DOMDebugger.getEventListeners", { objectId: object.objectId, depth: 1, pierce: false }));
 const selected = listeners.listeners.filter(listener => listener.type === "click" && listener.scriptId === handler.scriptId && listener.lineNumber === handler.lineNumber && listener.columnNumber === handler.columnNumber);
 if (selected.length !== 1 || selected[0]!.backendNodeId !== args.backendNodeId) throw Error("native-clipboard-lexical-handler-unavailable");
 const functionId = selected[0]!.originalHandler?.objectId ?? selected[0]!.handler?.objectId;
 if (!functionId) throw Error("native-clipboard-lexical-function-unavailable");
 const properties = async (objectId: string) => { await args.active(); const value = Properties.parse(await args.cdp.send("Runtime.getProperties", { objectId, ownProperties: true, generatePreview: false })); await args.active(); if (value.exceptionDetails) throw Error("native-clipboard-lexical-inspector-unavailable"); return value; };
 const fn = await properties(functionId), location = z.object({ value: Handler }).passthrough().parse(fn.internalProperties?.find(property => property.name === "[[FunctionLocation]]")?.value).value;
 if (JSON.stringify(location) !== JSON.stringify(handler)) throw Error("native-clipboard-lexical-function-location-drift");
 const scopeList = ObjectId.parse(fn.internalProperties?.find(property => property.name === "[[Scopes]]")?.value), scopeValues = (await properties(scopeList.objectId)).result.filter(property => /^\d+$/.test(property.name)).sort((a,b) => Number(a.name)-Number(b.name));
 if (!scopeValues.length || scopeValues.length > 129 || scopeValues.some((scope,index) => Number(scope.name) !== index)) throw Error("native-clipboard-lexical-scope-domain-unavailable");
 for (const [scopeIndex,scope] of scopeValues.entries()) {
  const value = await properties(ObjectId.parse(scope.value).objectId), binding = value.result.find(property => property.name === args.bindingName);
  if (!binding) continue;
  if (binding.get !== undefined || binding.set !== undefined) throw Error("native-clipboard-lexical-accessor-forbidden");
  const text = z.object({ type: z.literal("string"), value: z.string().max(2*1024*1024) }).passthrough().parse(binding.value).value;
  await args.active();
  return { text, sourceElement: null, lexical: { producer: "chromium-native-lexical-string-binding-v1" as const, backendNodeId: args.backendNodeId, handlerRealm: { frameId: args.defaultContext.frameId, uniqueContextId: args.defaultContext.uniqueId }, handler, bindingName: args.bindingName, scopeIndex } };
 }
 throw Error("native-clipboard-lexical-binding-not-found");
}
