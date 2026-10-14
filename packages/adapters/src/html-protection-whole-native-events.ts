import { z } from "zod";
import type { CDPSession } from "@playwright/test";
/** Isolated native DOM identity program only; it does not evaluate handlers or access page-realm properties. */
const program = String.raw`function nativeListenerReceivers(selector) {
  const apply=Reflect.apply, query=Document.prototype.querySelectorAll, desc=Object.getOwnPropertyDescriptor;
  const parent=desc(Node.prototype,"parentNode").get, nodeType=desc(Node.prototype,"nodeType").get;
  const found=Array.from(apply(query,document,[selector]));if(found.length!==1)throw Error("listener-target-unavailable");
  const receivers=[];let n=found[0];while(n){receivers.push(n);n=apply(parent,n,[]);if(receivers.length>128)throw Error("listener-scope-unavailable");}
  if(!receivers.some(n=>apply(nodeType,n,[])===9))throw Error("listener-document-unavailable");receivers.push(window);return receivers;
}`;
const RemoteObject = z.object({ objectId: z.string().min(1), type: z.literal("object"), subtype: z.string().optional() }).passthrough();
const Listener = z.object({ type: z.string().min(1), useCapture: z.boolean(), passive: z.boolean(), once: z.boolean(), scriptId: z.string().min(1),
  lineNumber: z.number().int().nonnegative(), columnNumber: z.number().int().nonnegative(), handler: z.object({ objectId: z.string().optional() }).passthrough().optional(),
  originalHandler: z.object({ objectId: z.string().optional() }).passthrough().optional(), backendNodeId: z.number().int().positive().optional() }).passthrough();
export async function collectHtmlProtectionWholeNativeEventListeners(args: { cdp: CDPSession; contextUniqueId: string; objectGroup: string; defaultContext: { id: number; uniqueId: string; frameId: string }; selector: string; active: () => Promise<void> }) {
  await args.active();
  const result = z.object({ result: RemoteObject, exceptionDetails: z.unknown().optional() }).passthrough().parse(await args.cdp.send("Runtime.callFunctionOn", {
    uniqueContextId: args.contextUniqueId, objectGroup: args.objectGroup, functionDeclaration: program, arguments: [{ value: args.selector }], returnByValue: false, silent: true,
  }));
  if (result.exceptionDetails) throw Error("Native listener receiver unavailable");
  const release = new Set<string>([result.result.objectId]), receivers: Array<{ index: number; backendNodeId: number | null; kind: "node" | "window"; listeners: Array<Omit<z.infer<typeof Listener>, "handler" | "originalHandler">> }> = [];
  try {
    const properties = z.object({ result: z.array(z.object({ name: z.string(), value: z.unknown().optional() }).passthrough()) }).passthrough().parse(await args.cdp.send("Runtime.getProperties", { objectId: result.result.objectId, ownProperties: true, generatePreview: false }));
    const length = z.object({ value: z.number().int().min(2).max(129) }).passthrough().parse(properties.result.find(item => item.name === "length")?.value).value;
    const rows = properties.result.filter(item => /^\d+$/.test(item.name)).sort((a, b) => Number(a.name) - Number(b.name));
    if (rows.length !== length || rows.some((item, index) => Number(item.name) !== index)) throw Error("Native listener receiver scope incomplete");
    for (const [index, row] of rows.entries()) {
      await args.active(); const object = RemoteObject.parse(row.value); release.add(object.objectId);
      const kind = index + 1 === length ? "window" as const : "node" as const;
      if ((kind === "node") !== (object.subtype === "node")) throw Error("Native listener receiver identity differs");
      const backendNodeId = kind === "node" ? z.object({ node: z.object({ backendNodeId: z.number().int().positive() }) }).passthrough().parse(await args.cdp.send("DOM.describeNode", { objectId: object.objectId })).node.backendNodeId : null;
      let receiver = object;
      if (backendNodeId !== null) {
        // Resolve the exact physical backend node in its native handler realm. No page property/getter/JSON is executed.
        receiver = RemoteObject.parse(z.object({ object: z.unknown() }).strict().parse(await args.cdp.send("DOM.resolveNode", { backendNodeId, executionContextId: args.defaultContext.id, objectGroup: args.objectGroup })).object);
        const rebound = z.object({ node: z.object({ backendNodeId: z.number().int().positive() }) }).passthrough().parse(await args.cdp.send("DOM.describeNode", { objectId: receiver.objectId })).node.backendNodeId;
        if (rebound !== backendNodeId) throw Error("Native handler realm resolved another physical node");
        release.add(receiver.objectId);
      }
      const observed = z.object({ listeners: z.array(Listener).max(5000) }).strict().parse(await args.cdp.send("DOMDebugger.getEventListeners", { objectId: receiver.objectId, depth: 1, pierce: false }));
      const listeners = observed.listeners.map(listener => {
        for (const handler of [listener.handler, listener.originalHandler]) if (handler?.objectId) release.add(handler.objectId);
        return { type: listener.type, useCapture: listener.useCapture, passive: listener.passive, once: listener.once, scriptId: listener.scriptId,
          lineNumber: listener.lineNumber, columnNumber: listener.columnNumber, ...(listener.backendNodeId === undefined ? {} : { backendNodeId: listener.backendNodeId }) };
      });
      receivers.push({ index, kind, backendNodeId, listeners });
    }
    await args.active();
    if (new Set(receivers.filter(item => item.kind === "node").map(item => item.backendNodeId)).size !== receivers.length - 1) throw Error("Native listener receiver repeated");
    return { producer: "chromium-native-complete-propagation-listeners-v1" as const, handlerRealm: { frameId: args.defaultContext.frameId, uniqueContextId: args.defaultContext.uniqueId }, receivers,
      limitations: ["This is the exact listener registry at the observed boundary, not evidence that the handler executed successfully or that every future event sequence is covered."] };
  } finally { /* Keep inspector receiver/handler leases in the owned group until terminal readback. Early disposal can invalidate precise coverage metadata; browser shutdown destroys the group. */ }
}
