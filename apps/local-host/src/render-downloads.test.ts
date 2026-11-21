import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderDownloads,RENDER_DOWNLOAD_TTL_MS,renderFilename,attachmentDisposition} from './render-downloads.js';
const scope={projectId:'p',productId:'bidproposal',renderId:'r',format:'md' as const,bridgeToken:'private-credential'};
test('download tickets are opaque, single-use, time-bounded, isolated and capped',()=>{
 const tickets=new RenderDownloads(),issued=tickets.issue(scope,0),key=issued.path.split('/').pop()!;
 assert.match(key,/^[a-f0-9]{64}$/);assert.ok(!issued.path.includes(scope.bridgeToken));
 assert.equal(new RenderDownloads().consume(key,1),undefined);assert.deepEqual(tickets.consume(key,1),{...scope,expiresAt:RENDER_DOWNLOAD_TTL_MS});assert.equal(tickets.consume(key,2),undefined);
 const expired=tickets.issue(scope,2);assert.equal(tickets.consume(expired.path.split('/').pop()!,2+RENDER_DOWNLOAD_TTL_MS),undefined);
 for(let i=0;i<128;i++)tickets.issue(scope,3);assert.throws(()=>tickets.issue(scope,3),/Too many/);assert.ok(tickets.issue(scope,3+RENDER_DOWNLOAD_TTL_MS));
});
test('attachment names preserve Unicode without header/path injection',()=>{
 const filename=renderFilename('\u6807\u4e66 " / \\ \r\n injected', 'pdf'),header=attachmentDisposition(filename);
 assert.ok(filename.startsWith('\u6807\u4e66'));assert.doesNotMatch(filename,/[\r\n"/\\]/);assert.doesNotMatch(header,/[\r\n]/);assert.match(header,/^attachment; filename="deliverable.pdf"; filename\*=UTF-8''%/);
 assert.equal(renderFilename('... ','md'),'deliverable.md');
});
