import test from "node:test";
import assert from "node:assert/strict";
import {assertAgentPayload} from "./agent-payload.js";

test('native headers are rejected even when renamed; ordinary data and browser code remain valid',()=>{
 for(const magic of [0x7f454c46,0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca]){
  const bytes=Buffer.alloc(4);bytes.writeUInt32BE(magic);assert.throws(()=>assertAgentPayload(new Map([['assets/data.bin',bytes]])),/native executables/);
 }
 for(const name of ['worker.so.1.2','install.sh','plugin.dylib','resources/dir./asset.txt','resources/tool.py'])assert.throws(()=>assertAgentPayload(new Map([[name,Buffer.from('data')]])));
 const fakeMZ=Buffer.alloc(64);fakeMZ.write('MZ');fakeMZ.writeUInt32LE(0xffffffff,60);
 assert.doesNotThrow(()=>assertAgentPayload(new Map([['guide.md',Buffer.from('# guide')],['app.js',Buffer.from('export const version=1;')],['tiny.txt',Buffer.from('x')],['empty.txt',Buffer.alloc(0)],['dos-example.bin',fakeMZ]])));
});
