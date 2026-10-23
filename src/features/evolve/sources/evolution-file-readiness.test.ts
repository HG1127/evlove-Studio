import {describe,expect,it} from "vitest";
import {assessFileReadiness} from "./extract";

describe("file upload explains evolution, not only parsing",()=>{
  it("calls out formats with no native deliverable renderer",()=>{
    for(const [name,mime] of [
      ["report.pdf","application/pdf"],["image.png","image/png"],["notes.rtf","text/rtf"],["slides.odp","application/vnd.oasis.opendocument.presentation"],
      ["old.doc","application/msword"],["audio.wav","audio/wav"],
    ] as const){
      expect(assessFileReadiness(name,mime).level,name).toBe("caution");
      expect(assessFileReadiness(name,mime).note.length).toBeGreaterThan(5);
    }
  });
  it("describes supported structure-preserving edits and their limitations",()=>{
    for(const [name,mime] of [
      ["report.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["slides.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["book.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["rows.csv","text/csv"],
      ["source.zip","application/zip"],
    ] as const){
      const result=assessFileReadiness(name,mime);
      expect(result.level,name).toBe("ok");
      expect(result.note.length,name).toBeGreaterThan(5);
    }
  });
});