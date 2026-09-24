// @vitest-environment node
import {describe,expect,it} from "vitest";
import {assertBodySize,mockEvent,readMultipartFormData,readRawBody} from "nitro/h3";
import evolutionSecurity from "../../server/middleware/evolution-security";

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

  it("rejects an unknown-length multipart body before it is parsed",async()=>{
    const boundary="test-boundary";
    const body=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\n\r\n${"x".repeat(100)}\r\n--${boundary}--\r\n`;
    const request=new Request("http://localhost/upload",{
      method:"POST",
      headers:{"content-type":`multipart/form-data; boundary=${boundary}`},
      body:new ReadableStream<Uint8Array>({
        start(controller){
          const encoder=new TextEncoder();
          controller.enqueue(encoder.encode(body.slice(0,50)));
          controller.enqueue(encoder.encode(body.slice(50)));
          controller.close();
        },
      }),
      duplex:"half",
    } as RequestInit & {duplex:"half"});
    const event=mockEvent(request);
    assertBodySize(event,80);
    await expect(readMultipartFormData(event)).rejects.toMatchObject({status:413});
  });

  it("rejects oversized Evolution API requests at the middleware boundary",async()=>{
    const event=mockEvent(new Request("http://localhost/api/evolution/git-webhook",{
      method:"POST",
      headers:{"content-length":String(33*1024*1024)},
      body:"x",
    }));
    await expect(async()=>evolutionSecurity(event)).rejects.toMatchObject({status:413});
  });
});
