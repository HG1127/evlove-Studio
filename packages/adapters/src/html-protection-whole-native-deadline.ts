import type { CDPSession } from "@playwright/test";
/** Bound every owned inspector command independently. A late response cannot become successful evidence after timeout. */
export function boundHtmlProtectionWholeNativeSession(session: CDPSession, deadline: number, signal: AbortSignal, gap: (code: string) => Error): CDPSession {
  let invalid = false;
  return new Proxy(session, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "detach") return async () => { let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([target.detach(), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]); } finally { if (timer) clearTimeout(timer); } };
      if (property !== "send") return typeof value === "function" ? value.bind(target) : value;
      return async (method: string, parameters: unknown) => {
        if (invalid || signal.aborted || Date.now() >= deadline) throw gap("native-inspector-owner-expired");
        const timeout = Math.max(1, Math.min(5000, deadline - Date.now()));
        let timer: ReturnType<typeof setTimeout> | undefined, expired = false;
        try {
          const result = await Promise.race([
            Reflect.apply(target.send, target, [method, parameters]),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; invalid = true; reject(gap("native-inspector-command-deadline:" + method)); }, timeout); }),
          ]);
          if (expired || signal.aborted || Date.now() >= deadline) throw gap("native-inspector-late-response-refused");
          return result;
        } finally { if (timer) clearTimeout(timer); }
      };
    },
  });
}
