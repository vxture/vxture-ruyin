/** Explicit, opt-in live V0 probe. Never run in CI or with customer content. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProjectRuntime, verifyAuditChain } from '../../packages/runtime-core/dist/index.js';
import { parseContract } from '../../packages/contract-schema/dist/index.js';
import { SqliteStoragePort } from '../../apps/local-host/dist/storage.js';
import { KeyManager } from '../../apps/local-host/dist/keys.js';
import { LocalModelGateway } from '../../apps/local-host/dist/local-model-gateway.js';
import { nodeClock, nodeId, nodeCrypto } from '../../apps/local-host/dist/host-ports.js';

const [keyFile, outputArg, phase] = process.argv.slice(2);
if (!keyFile || !outputArg) throw Error('Usage: node bid-v0-model-probe.mjs KEY_FILE OUTPUT');
const output=resolve(outputArg);mkdirSync(output,{recursive:true});
if (!phase) {
  for(const p of ['first','resume']) {
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),keyFile,output,p],{encoding:'utf8',timeout:240000,windowsHide:true});
    if(child.status!==0) { console.error('Live probe phase failed:',p,'(raw errors suppressed to protect credentials)');process.exit(1); }
    console.log('Live probe phase passed:',p);
  }
  console.log(readFileSync(join(output,'model-result.json'),'utf8'));
  process.exit(0);
}
const keys=[...new Set(readFileSync(keyFile,'utf8').match(/sk-[A-Za-z0-9_-]{16,}/g)||[])];
assert.equal(keys.length,1,'Expected exactly one credential');
const credential=keys[0];
const model='deepseek-flash';
const gateway=new LocalModelGateway({baseUrl:'https://api.deepseek.com',model,apiKey:credential,timeoutMs:90000});
let turns=0;
const observed={turn:async req=>{turns++;return gateway.turn(req);}};
const data=join(output,'encrypted-data');
const storage=new SqliteStoragePort(data,await KeyManager.open(data));
const runtime=new ProjectRuntime({storage,clock:nodeClock,id:nodeId,crypto:nodeCrypto,gateway:observed});
const contract=parseContract(readFileSync(new URL('../../products/bidproposal/ruyin.product.yaml',import.meta.url),'utf8'));
const common='这是完全虚构的V0验证项目。统一方案名为“青松园区运维”，不出现供应商品牌，不虚构企业资质。只输出纯文本Markdown正文，120至220个汉字；必须出现本章需求编号，明确责任、流程、交付记录。';
const specs=[['chapter1','REQ-01 项目组织','明确项目经理、值班责任和交接记录'],['chapter2','REQ-02 巡检方案','每日巡检并记录异常，处置后复核'],['chapter3','REQ-03 验收交付','逐项检查需求并形成验收记录'],['rewrite2','REQ-02 巡检方案修订','保留每日巡检，增加每周抽检，必须写明“每周抽检”和“抽检记录”']];
contract.tasks=specs.map(([id,title,instruction])=>({id,objective:common+title+'。'+instruction,input_types:[],output_types:['technical_proposal'],constraints:['只编写指定章节，禁止读写文件、调用工具或请求额外信息'],capabilities:['proposal_generation'],tools:[],verification:[{id:'chapter_review',kind:'human'}]}));
async function waiting(h,id){const t=await h.startTask(id,{});const state=await h.advance(t.id);assert.equal(state.state,'waiting_human');return state;}
async function approve(h,t){await h.decideCheckpoint(t.id,true);const done=await h.advance(t.id);assert.equal(done.state,'completed');const md=done.result.content.proposal_generation;assert.equal(typeof md,'string');assert.ok(md.length>60);assert.ok(!md.includes(credential));return md;}
try {
 if(phase==='first') {
  const project=await runtime.createProject(contract,'V0合成标书真实模型验证','v0-synthetic');
  const h=await runtime.createHarness(project.id);
  const ch1=await approve(h,await waiting(h,'chapter1'));
  assert.ok(ch1.includes('REQ-01'));
  const store=storage.openHostStore(project.id);
  store.putProductDocument(contract.product.id,'chapter1',ch1,0);
  const ch2=await waiting(h,'chapter2');
  assert.ok(ch2.capabilityOutputs.proposal_generation.includes('REQ-02'));
  assert.equal(turns,2);
  writeFileSync(join(output,'handoff.json'),JSON.stringify({projectId:project.id,taskId:ch2.id,firstPid:process.pid,turns}));
 } else {
  const saved=JSON.parse(readFileSync(join(output,'handoff.json'),'utf8'));
  assert.notEqual(saved.firstPid,process.pid);
  const h=await runtime.createHarness(saved.projectId);
  const persisted=JSON.parse(await (await storage.openProjectStore(saved.projectId)).getTaskInstance(saved.taskId));
  assert.equal(persisted.state,'waiting_human');
  const ch2=await approve(h,persisted);
  assert.equal(turns,0,'resume must not replay completed model turn');
  const store=storage.openHostStore(saved.projectId),product=contract.product.id;
  store.putProductDocument(product,'chapter2',ch2,0);
  const ch3=await approve(h,await waiting(h,'chapter3'));
  assert.ok(ch3.includes('REQ-03'));store.putProductDocument(product,'chapter3',ch3,0);
  const first=store.getProductDocument(product,'chapter1');
  const manual=first.markdown+'\n\n人工补充：项目经理每周组织例会。';
  store.putProductDocument(product,'chapter1',manual,first.revision);
  const before1=JSON.stringify(store.getProductDocument(product,'chapter1'));
  const before2=store.getProductDocument(product,'chapter2');
  const before3=JSON.stringify(store.getProductDocument(product,'chapter3'));
  const rewrite=await approve(h,await waiting(h,'rewrite2'));
  assert.ok(rewrite.includes('每周抽检')&&rewrite.includes('抽检记录'));
  // A rewrite is a separate candidate until the user adopts it.
  store.putProductDocument(product,'chapter2_candidate',rewrite,0);
  assert.deepEqual(store.getProductDocument(product,'chapter2'),before2);
  assert.ok(store.putProductDocument(product,'chapter2',rewrite,before2.revision));
  assert.equal(JSON.stringify(store.getProductDocument(product,'chapter1')),before1);
  assert.equal(JSON.stringify(store.getProductDocument(product,'chapter3')),before3);
  assert.equal(store.putProductDocument(product,'chapter1','stale overwrite',first.revision),undefined);
  const audit=await runtime.listAuditEvents(saved.projectId);
  assert.ok(verifyAuditChain(nodeCrypto,saved.projectId,audit));
  for(const id of ['chapter1','chapter2','chapter3','chapter2_candidate'])writeFileSync(join(output,id+'.md'),store.getProductDocument(product,id).markdown);
  writeFileSync(join(output,'model-result.json'),JSON.stringify({passed:true,provider:'DeepSeek official',model,syntheticOnly:true,chapters:3,modelTurns:saved.turns+turns,separateProcessRecovery:true,replayedModelTurns:0,manualEditPreserved:true,untouchedChapterPreserved:true,candidateBeforeAdoption:true,staleWriteRejected:true,auditChainValid:true,scope:'completed model turn checkpoint recovery; not mid-stream token recovery'},null,2));
 }
} catch(error) {
 writeFileSync(join(output,'failure.json'),JSON.stringify({phase,name:error?.name??'Error',message:String(error?.message??'failed').replaceAll(credential,'[REDACTED]').slice(0,1000)}));
 process.exitCode=1;
} finally {storage.closeAll();}
