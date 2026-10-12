/** Decode actual Artifact bytes without dropping a UTF-8 BOM or normalizing text.
 * Invalid UTF-8 is rejected; re-encoding valid text must reproduce the input. */
export function decodeArtifactUtf8(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}