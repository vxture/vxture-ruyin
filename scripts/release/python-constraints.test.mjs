import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePythonConstraints,readPythonConstraints} from './python-constraints.mjs';

const seeds=[{package:'excel-mcp-server',version:'0.1.8'}];
test('Python seed locks reject floating versions, stale roots and duplicates before acquisition',()=>{
 assert.equal(validatePythonConstraints('# exact pins\nExcel_MCP_Server==0.1.8\npydantic-core==2.50.5\n',seeds).get('excel-mcp-server'),'0.1.8');
 for(const text of ['', 'excel-mcp-server>=0.1.8','excel-mcp-server==0.1.7','pydantic-core==2.50.5','excel-mcp-server==0.1.8\nExcel_MCP_Server==0.1.8','excel-mcp-server==0.1.8\n-r other.txt'])assert.throws(()=>validatePythonConstraints(text,seeds));
});
test('checked-in Windows constraints include each pinned MCP seed and its native dependency',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../resources/skill-manifest.json',import.meta.url),'utf8'));
 const roots=manifest.pythonRuntime.seed.map(id=>manifest.servers.find(s=>s.id===id).launch);
 const pins=readPythonConstraints(new URL('../../resources/python-runtime/requirements.txt',import.meta.url),roots);
 assert.ok(pins.size>roots.length);assert.ok(pins.has('pydantic-core'));
});
