import {beforeEach,describe,expect,it} from "vitest";
import {clearComposerParseSessionId,clearDismissedParseArtifacts,composerParseSessionId,dismissParseArtifact,readDismissedParseArtifacts} from "./composer-parse-dismissal";

describe("composer Parse dismissal",()=>{
  beforeEach(()=>{window.sessionStorage.clear();clearComposerParseSessionId();clearDismissedParseArtifacts();});

  it("keeps a removed source hidden after refresh within the same draft",()=>{
    expect([...dismissParseArtifact("draft-1","artifact-1")]).toEqual(["artifact-1"]);
    expect(readDismissedParseArtifacts("draft-1").has("artifact-1")).toBe(true);
    expect(readDismissedParseArtifacts("draft-2").size).toBe(0);
    clearDismissedParseArtifacts();
    expect(readDismissedParseArtifacts("draft-1").size).toBe(0);
  });

  it("does not trust malformed browser storage",()=>{
    window.sessionStorage.setItem("evolve-studio:composer-dismissed-parse:v1",'{"sessionId":"draft-1","artifactIds":[5]}');
    expect(readDismissedParseArtifacts("draft-1").size).toBe(0);
    window.sessionStorage.setItem("evolve-studio:composer-dismissed-parse:v1","not json");
    expect(readDismissedParseArtifacts("draft-1").size).toBe(0);
  });

  it("bounds saved dismissals while retaining the newest IDs",()=>{
    for(let index=0;index<205;index++)dismissParseArtifact("draft-1",`artifact-${index}`);
    const ids=readDismissedParseArtifacts("draft-1");
    expect(ids.size).toBe(200);
    expect(ids.has("artifact-0")).toBe(false);
    expect(ids.has("artifact-204")).toBe(true);
  });

  it("uses a memory fallback when session storage rejects access",()=>{
    const denied={
      getItem(){throw new Error("storage denied");},
      setItem(){throw new Error("storage denied");},
      removeItem(){throw new Error("storage denied");},
    } as unknown as Storage;
    const sessionId=composerParseSessionId(denied);
    expect(composerParseSessionId(denied)).toBe(sessionId);
    dismissParseArtifact(sessionId,"artifact-1",denied);
    dismissParseArtifact(sessionId,"artifact-2",denied);
    expect([...readDismissedParseArtifacts(sessionId,denied)]).toEqual(["artifact-1","artifact-2"]);
    clearDismissedParseArtifacts(denied);
    expect(readDismissedParseArtifacts(sessionId,denied).size).toBe(0);
    clearComposerParseSessionId(denied);
    expect(composerParseSessionId(denied)).not.toBe(sessionId);
  });
});
