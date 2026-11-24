// Synthetic UI integration acceptance; never opens or modifies a real project.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../apps/ui-workspace/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
if (!process.argv[2]) throw Error('Usage: node scripts/dev/bid-plan-ui-probe.mjs PRODUCT_DESKTOP_DIR');
const source = name => import(pathToFileURL(resolve(process.argv[2], 'src', name)).href);
const { mountPlanning } = await source('plan-ui.mjs');
const { PlanSession } = await source('plan.mjs');
const { Requirements } = await source('requirements.mjs');
const { PlanCandidate } = await source('plan-candidate.mjs');
const dom = new JSDOM('<main></main>', { url: 'http://localhost/?hostOrigin=http://localhost' });
for (const key of ['window', 'document', 'location', 'sessionStorage']) globalThis[key] = dom.window[key];
globalThis.parent=dom.window;
const docs = new Map();
const template = { id: 'file-a', name: 'synthetic.docx', hash: 'a'.repeat(64) };
let files = [template], releaseRead,reads=0,published=0;
const bridge = { request: async (method, path, body) => {
  if (path === '/tasks') throw Error('Applied background work must not reopen a legacy task');
  if (path === '/project') return { ok: true, body: { projectId: 'synthetic' } };
  if (path === '/files') {
    if (releaseRead) await new Promise(resolve => { releaseRead = resolve; });
    return { ok: true, body: { items: files } };
  }
  const doc = docs.get(path);
  if (method === 'GET') {reads++;return doc ? { ok: true, body: doc } : { ok: false, status: 404 };}
  if ((doc?.revision || 0) !== body.revision) return { ok: false, status: 409 };
  const next = { markdown: body.markdown, revision: (doc?.revision || 0) + 1 };
  docs.set(path, next); return { ok: true, body: next };
} };
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const button = text => {
  const result = [...document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(result, text); return result;
};
try {
  const matrix = new Requirements(bridge);
  matrix.add({ text: 'Daily backup', quote: 'Backup daily', location: 'Section 1' });
  matrix.confirm(); await matrix.save();
  const plan = new PlanSession(bridge); await plan.load(); plan.build(matrix);
  plan.change('template', template); await plan.save();
  const candidate = new PlanCandidate(bridge); await candidate.load();
  await candidate.stage(JSON.stringify({ requirementsRevision: matrix.revision, chapters: [{ title: 'Backup strategy', requirementIds: [matrix.rows[0].id] }] }), plan, matrix);
  const echo=()=>window.dispatchEvent(new window.MessageEvent('message',{source:window,origin:'http://localhost',data:{ns:'ruyin.navigation',kind:'navigate',section:'planning'}}));
  const workflow = { states: {}, emit() {published++;if(published>40)throw Error('Planning navigation feedback loop');queueMicrotask(echo);}, async mark(id, complete) { this.states[id] = complete ? 'complete' : 'active'; } };
  docs.set('/documents/bid_plan_request',{markdown:JSON.stringify({applied:true,spec:{id:'finished-background-job'}}),revision:1});
  sessionStorage.setItem('bid-plan-task:synthetic','finished-background-job');
  const mounted = await mountPlanning(bridge, workflow);
  assert.equal(sessionStorage.getItem('bid-plan-task:synthetic'),null);
  await flush();assert.doesNotMatch(document.querySelector('[role=status]').textContent,/legacy|unavailable/);
  const beforeEcho=reads;for(let n=0;n<5;n++)echo();await flush();assert.equal(reads,beforeEcho,'same-route host echoes must not reread planning sources');assert.ok(published<8);
  files = []; button('\u786e\u8ba4\u6b64\u65b9\u6848').click(); await flush();
  assert.notEqual(mounted.value.outline[0].title, 'Backup strategy');
  assert.equal(mounted.value.approved, false);
  assert.match(document.querySelector('[role=status]').textContent, /unavailable/);
  files = [template]; releaseRead = true;
  button('\u786e\u8ba4\u6b64\u65b9\u6848').click();
  assert.ok([...document.querySelectorAll('input,select,button')].every(el => el.disabled), 'all edits lock before awaiting template validation');
  await flush(); assert.equal(typeof releaseRead, 'function'); releaseRead(); releaseRead = null; await flush();
  assert.equal(mounted.value.approved, true);
  const reopened = new PlanSession(bridge); await reopened.load();
  assert.equal(reopened.value.template.hash, template.hash);
  assert.equal(reopened.value.approved, true);
  const tasks = reopened.writingTasks(matrix);
  assert.equal(tasks[0].title, 'Backup strategy');
  assert.equal(tasks[0].requirements[0].quote, 'Backup daily');
  assert.equal(workflow.states.planning, 'complete');
  assert.equal(docs.has('/documents/bid_draft'), false, 'planning must never overwrite chapter drafts');
  assert.equal(document.querySelector('.plan-manual').open,false);assert.equal(document.querySelector('.plan-constraints').open,false);console.log('PASS: model-led candidate -> template gate -> immediate lock -> one confirmation -> reopen -> writing tasks; manual controls secondary; drafts untouched');
} finally { dom.window.close(); }
