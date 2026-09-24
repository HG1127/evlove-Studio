// @vitest-environment node
import {describe,expect,it} from "vitest";
import {assertBodySize,mockEvent,readRawBody} from "nitro/h3";

function streamingEvent(parts:string[]){
  const encoder=new TextEncoder();
  const body=new ReadableStream<Uint8Array>({
    start(controller){
      for(const part of parts)controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  const request=new Request("http://localhost/upload",{
    method:"POST",body,duplex:"half",
  } as RequestInit & {duplex:"half"});
  return mockEvent(request);
}

describe("streaming request body limits",()=>{
  it("rejects an unknown-length body as soon as its bytes exceed the limit",async()=>{
    const event=streamingEvent(["abc","def"]);
    assertBodySize(event,5);
    await expect(readRawBody(event,false)).rejects.toMatchObject({status:413});
  });

  it("accepts a body exactly at the byte limit",async()=>{
    const event=streamingEvent(["abc","de"]);
    assertBodySize(event,5);
    await expect(readRawBody(event,false)).resolves.toEqual(new TextEncoder().encode("abcde"));
  });

  it("rejects an oversized declared length before reading",()=>{
    const event=mockEvent(new Request("http://localhost/upload",{
      method:"POST",headers:{"content-length":"6"},body:"abcdef",
    }));
    expect(()=>assertBodySize(event,5)).toThrow();
  });
});
