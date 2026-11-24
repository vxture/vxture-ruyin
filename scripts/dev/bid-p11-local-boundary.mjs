// A real loopback HTTP provider, synthetic input, real kernel consent/review,
// encrypted storage and process restart. This is not a deployed domain audit.
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {parseContract} from '../../packages/contract-schema/dist/index.js';
import {ProjectRuntime,MemorySkills} from '../../packages/runtime-core/dist/index.js';
import {SqliteStoragePort} from '../../apps/local-host/dist/storage.js';
import {KeyManager} from '../../apps/local-host/dist/keys.js';
import {LocalModelGateway} from '../../apps/local-host/dist/local-model-gateway.js';
import {nodeClock,nodeCrypto,nodeId} from '../../apps/local-host/dist/host-ports.js';
import {decideRoute,DEFAULT_ROUTING_POLICY,CLOUD_ROUTE_OPEN} from '../../apps/local-host/dist/capability-routing.js';

const output=resolve(process.argv[2]||mkdtempSync(join(tmpdir(),'ruyin-p11-report-'))),data=mkdtempSync(join(tmpdir(),'ruyin-p11-domain-'));mkdirSync(output,{recursive:true});
const contract=parseContract(readFileSync(new URL('../../products/bidproposal/ruyin.product.yaml',import.meta.url),'utf8'));
const type=contract.context.types.find(t=>t.id==='tender_document');type.sources=['project'];type.project_document='synthetic_tender';type.sensitivity='high';
const synthetic='SYNTHETIC ONLY: back up service data daily.',calls=[],network=[];let unavailable=false;
const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;calls.push({path:req.url,body:JSON.parse(text)});res.writeHead(unavailable?503:200,{'content-type':'application/json'});res.end(JSON.stringify(unavailable?{error:{message:'Synthetic local outage'}}:{choices:[{message:{role:'assistant',content:'SYNTHETIC response: daily service-data backup with a retained local audit record.'},finish_reason:'stop'}]}));});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port,originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{network.push(new URL(url).origin);assert.equal(new URL(url).origin,base,'No fallback or other outbound host in this probe');return originalFetch(url,options);};
const keys=await KeyManager.open(data),storage=new SqliteStoragePort(data,keys),gateway=new LocalModelGateway({baseUrl:base+'/v1',model:'synthetic-local',timeoutMs:3000});
const ports={storage,clock:{...nodeClock,sleep:async()=>{}},id:nodeId,crypto:nodeCrypto,gateway,skills:MemorySkills.forContract(contract),tools:{supports:()=>true,execute:async()=>({content:'Synthetic local tool'})},projectDocuments:{get:()=>({markdown:synthetic,revision:1})}};
try{
 const runtime=new ProjectRuntime(ports),project=await runtime.createProject(contract,'P11 local boundary - SYNTHETIC','wsp_synthetic'),h=await runtime.createHarness(project.id);let task=await h.startTask('analyze_tender');task=await h.advance(task.id);assert.equal(task.state,'waiting_human');assert.equal(calls.length,0);assert.equal(task.checkpoints.at(-1).kind,'context_confirm');
 await h.decideCheckpoint(task.id,{choice:'approve'});task=await h.advance(task.id);assert.equal(task.state,'waiting_human');assert.equal(task.checkpoints.at(-1).kind,'verification_review');assert.ok(calls.length);assert.ok(calls.some(call=>JSON.stringify(call.body).includes(synthetic)));
 await h.decideCheckpoint(task.id,{choice:'approve'});task=await h.advance(task.id);assert.equal(task.state,'completed');const before=JSON.stringify(task);storage.closeAll();
 const reopenedStorage=new SqliteStoragePort(data,keys),reopened=new ProjectRuntime({...ports,storage:reopenedStorage});assert.equal(JSON.stringify((await reopened.listTaskInstances(project.id)).find(t=>t.id===task.id)),before);
 const db=readFileSync(join(data,'projects',project.id,'project.db'));assert.notEqual(db.subarray(0,16).toString(),'SQLite format 3\0');assert.equal(db.includes(Buffer.from(synthetic)),false);
 unavailable=true;let failed=await (await reopened.createHarness(project.id)).startTask('analyze_tender');const resumed=await reopened.createHarness(project.id);failed=await resumed.advance(failed.id);await resumed.decideCheckpoint(failed.id,{choice:'approve'});failed=await resumed.advance(failed.id);assert.notEqual(failed.state,'completed');assert.ok(!failed.result);assert.ok(network.every(origin=>origin===base));
 assert.equal(decideRoute(DEFAULT_ROUTING_POLICY,{}, {localAvailable:false,online:true,cloudOpen:true}).route,'unavailable');
 const report={checkedAt:new Date().toISOString(),projectId:project.id,dataDir:data,provider:base,requests:calls.length,networkOrigins:[...new Set(network)],consentBeforeInference:true,oneHumanResultReview:true,encryptedOnDisk:true,reopenedTaskUnchanged:true,providerFailureHasNoCloudFallback:true,cloudToolRouteOpen:CLOUD_ROUTE_OPEN,limitations:['Loopback synthetic provider, not an actual LLM quality test','No deployed cloud execution host or isolated customer network is certified by this probe']};writeFileSync(join(output,'local-boundary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));reopenedStorage.closeAll();
}finally{storage.closeAll();globalThis.fetch=originalFetch;await new Promise(done=>server.close(done));}
