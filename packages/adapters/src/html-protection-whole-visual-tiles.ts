import { z } from "zod";
import type { HtmlProtectionOwnedDocument } from "./html-protection-owned-document";
import { HtmlProtectionWholeNativeGap, type HtmlProtectionWholeNativeObserver } from "./html-protection-whole-native-observer";
import { htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";

const View = z.object({ viewport: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  documentSize: z.object({ width: z.number().positive(), height: z.number().positive() }).strict() }).strict();
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 50));
/** All actual page-height intervals, never a first-screen substitute. Unknown/capacity gaps stop with the real pixel prefix preserved. */
export async function collectOwnedHtmlProtectionVisualTiles(args: {
  owned: HtmlProtectionOwnedDocument; native: HtmlProtectionWholeNativeObserver; stateId: string;
  writeTile: (id: string, material: unknown) => Promise<void>;
}) {
  const { owned, native } = args;
  const active = async () => { if (owned.signal.aborted || Date.now() >= owned.deadline) throw new HtmlProtectionWholeNativeGap("visual-sequence-deadline"); await owned.assertCurrent(); };
  const settle = async () => {
    let last = "", quiet = 0, observed: Awaited<ReturnType<typeof native.viewport>> | undefined;
    for (let attempt = 0; attempt < 80 && quiet < 3; attempt++) {
      await active();
      try { observed = await native.viewport(); const current = JSON.stringify(observed.value); quiet = last === current ? quiet + 1 : 0; last = current; }
      catch (error) { if (!(error instanceof HtmlProtectionWholeNativeGap) || error.code !== "native-document-unstable") throw error; quiet = 0; }
      if (quiet < 3) await pause();
    }
    if (!observed || quiet < 3) throw new HtmlProtectionWholeNativeGap("visual-native-scroll-unsettled"); return observed;
  };
  await active(); let current = await settle(); let state = View.parse(current.value);
  let scrollDispatches = 0;
  if (state.scroll.y > 1) { await native.scrollDistance(-state.scroll.y - state.viewport.height); scrollDispatches++; current = await settle(); state = View.parse(current.value); }
  if (Math.abs(state.scroll.y) > 1 || Math.abs(state.scroll.x) > 1) throw new HtmlProtectionWholeNativeGap("visual-full-document-origin-unobserved");
  const initialHeight = state.documentSize.height, initialWidth = state.documentSize.width;
  let coveredUntil = 0, tileIndex = 0;
  while (true) {
    await active();
    if (state.documentSize.height !== initialHeight || state.documentSize.width !== initialWidth
      || state.scroll.y > coveredUntil + 1 || state.scroll.y < -1) throw new HtmlProtectionWholeNativeGap("visual-document-coverage-drift");
    const region = { x: 0, y: Math.max(0, state.scroll.y), width: state.viewport.width,
      height: Math.min(state.viewport.height, initialHeight - Math.max(0, state.scroll.y)) };
    if (region.height <= 0 || tileIndex >= 5000) throw new HtmlProtectionWholeNativeGap("visual-tile-capacity-unavailable");
    // Native screenshot bytes from the exact owned Page. No page canvas/console or model-provided image is accepted.
    const captured = await native.visualCapture(async () => {
      const bytes = await native.screenshot(region); await active();
      return { bytes };
    });
    const { bytes } = captured.value;
    const after = await native.viewport();
    const afterState = View.parse(after.value);
    if (JSON.stringify(afterState) !== JSON.stringify(state)) throw new HtmlProtectionWholeNativeGap("visual-screenshot-document-drift");
    if (bytes.byteLength > 4 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new HtmlProtectionWholeNativeGap("visual-native-pixel-capacity-unavailable");
    await args.writeTile(args.stateId + ":tile:" + tileIndex++, { realm: captured.realm, stability: captured.stability, styleWindow: captured.styleWindow,
      value: { viewport: state.viewport, region, documentSize: state.documentSize, before: current, after,
        nativeScrollDispatches: scrollDispatches, image: { mimeType: "image/png", base64: bytes.toString("base64"), sha256: sha(bytes), byteLength: bytes.byteLength } } });
    coveredUntil = Math.max(coveredUntil, region.y + region.height);
    if (coveredUntil >= initialHeight - 1) break;
    const distance = Math.min(state.viewport.height - 80, initialHeight - coveredUntil);
    await native.scrollDistance(distance); scrollDispatches++;
    current = await settle(); const next = View.parse(current.value);
    if (next.scroll.y <= state.scroll.y + 1) throw new HtmlProtectionWholeNativeGap("visual-native-scroll-made-no-progress");
    state = next;
  }
  // Horizontal overflow is retained, never silently cropped to the viewport-width tile domain.
  if (initialWidth > state.viewport.width + 1) throw new HtmlProtectionWholeNativeGap("visual-horizontal-overflow-uncovered");
  return { tileCount: tileIndex, coveredHeight: coveredUntil, documentHeight: initialHeight, nativeScrollDispatches: scrollDispatches };
}
