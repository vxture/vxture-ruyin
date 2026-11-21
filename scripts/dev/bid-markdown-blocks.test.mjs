import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const parser=new URL('./bid-markdown-blocks.mjs',import.meta.url);
test('Markdown mapping preserves table/image blocks and rejects remote or escaping assets',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ruyin-md-blocks-'));
 try {
  // Synthetic one-pixel PNG; the test validates mapping, Word handles decoding separately.
  writeFileSync(join(dir,'image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=','base64'));
  const run=(md)=>{const path=join(dir,'chapter.md');writeFileSync(path,md);return spawnSync(process.execPath,[parser.pathname.replace(/^\/([A-Za-z]:)/,'$1'),path],{encoding:'utf8'});};
  const good=run('正文\n\n| 要求 | 响应 |\n| --- | --- |\n| 保密 | 本地 |\n\n![示意](image.png)');
  assert.equal(good.status,0,good.stderr);
  const plan=JSON.parse(good.stdout);assert.equal(plan.tables.length,1);assert.equal(plan.images.length,1);assert.equal(plan.tables[0].rows[1][1],'本地');
  for(const md of ['![remote](https://example.com/a.png)','![escape](../outside.png)','<script>alert(1)</script>','正文 **不得静默丢失加粗**'])assert.notEqual(run(md).status,0,md);
  writeFileSync(join(dir,'fake.png'),'not an image');assert.notEqual(run('![fake](fake.png)').status,0);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
