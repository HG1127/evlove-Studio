/** Preserve the existing JSON contract while streaming the transport. A single
 * complete Mission can exceed the platform's buffered-response size limit. */
export function missionJsonResponse(value:unknown){
  const bytes=new TextEncoder().encode(JSON.stringify(value));let offset=0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller){
      if(offset>=bytes.length){controller.close();return;}
      const end=Math.min(offset+64*1024,bytes.length);
      controller.enqueue(bytes.subarray(offset,end));offset=end;
    },
  }),{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
