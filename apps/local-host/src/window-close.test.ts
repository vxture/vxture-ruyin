import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {readWindowClose,writeWindowClose,type WindowCloseAction} from "./window-close.js";

test("close preference defaults safely, persists in the selected data directory and refuses invalid actions",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ruyin-window-close-"));
 try{
  assert.equal(readWindowClose(dir),"background");
  writeWindowClose(dir,"exit");assert.equal(readWindowClose(dir),"exit");
  assert.throws(()=>writeWindowClose(dir,"invalid" as WindowCloseAction));assert.equal(readWindowClose(dir),"exit");
  writeWindowClose(dir,"background");assert.equal(readWindowClose(dir),"background");
  for(const text of ['{bad','null','{}','{"closeAction":"unknown"}']){writeFileSync(join(dir,"desktop.json"),text);assert.equal(readWindowClose(dir),"background");}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
