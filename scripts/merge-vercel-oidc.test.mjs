import test from "node:test";
import assert from "node:assert/strict";
import {mergeOnlyOidc} from "./merge-vercel-oidc.mjs";

test("only replaces the OIDC line, preserving unrelated env values and comments",()=>{
  const original="# Private settings\nSUPABASE_URL=https://db.example.invalid\nVERCEL_OIDC_TOKEN=old.jwt.signature\nMODEL_API_KEY=secret-untouched\n";
  const updated=mergeOnlyOidc(original,"new.jwt.signature");
  assert.equal(updated,original.replace("VERCEL_OIDC_TOKEN=old.jwt.signature",
    "VERCEL_OIDC_TOKEN=new.jwt.signature"));
  assert.ok(updated.includes("MODEL_API_KEY=secret-untouched"));
  assert.ok(!updated.includes("old.jwt.signature"));
});
test("preserves Windows line endings",()=>{
  const original="DB_SECRET=not-shared\r\nVERCEL_OIDC_TOKEN=old.jwt.token\r\nNEXT=value\r\n";
  const merged=mergeOnlyOidc(original,"new.jwt.token");
  assert.equal(merged,"DB_SECRET=not-shared\r\nVERCEL_OIDC_TOKEN=new.jwt.token\r\nNEXT=value\r\n");
});
test("rejects duplicate OIDC keys and appends absent key without overwriting other credentials",()=>{
  assert.throws(()=>mergeOnlyOidc("VERCEL_OIDC_TOKEN=A\nVERCEL_OIDC_TOKEN=B\n","new.jwt.token"),/duplicate/i);
  assert.equal(mergeOnlyOidc("SOME_OTHER_KEY=original\n","new.jwt.token"),
    "SOME_OTHER_KEY=original\nVERCEL_OIDC_TOKEN=new.jwt.token\n");
});
