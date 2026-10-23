import {expect,it} from "vitest";
import {LessonSchema} from "@evolution/contracts";
import {selectPlanningLessons} from "./planning-lessons";

const lesson=(id:string)=>LessonSchema.parse({id,title:id,summary:"measured",reusable:true,effect:"improved",limit:"same context"});
it("keeps the latest integrated lesson when more than six exist",()=>{
  const lessons=Array.from({length:9},(_,i)=>lesson("newest-first-"+i));
  expect(selectPlanningLessons(lessons).map(item=>item.id)).toEqual(lessons.slice(0,6).map(item=>item.id));
});
it("excludes revoked knowledge and non-reusable methods but retains anti-pattern warnings",()=>{
  const revoked=lesson("revoked");revoked.governance={status:"revoked",reason:"rollback",updatedAt:"now",history:[]};
  const warning={...lesson("warning"),reusable:false,status:"anti-pattern" as const};
  expect(selectPlanningLessons([revoked,{...lesson("no-reuse"),reusable:false},warning,lesson("current")]).map(item=>item.id)).toEqual(["warning","current"]);
});
it("does not resurrect an older duplicate of revoked knowledge",()=>{
  const old=lesson("same");const current={...old,governance:{status:"superseded" as const,reason:"replaced",updatedAt:"now",history:[]}};
  expect(selectPlanningLessons([current,old])).toEqual([]);
});
