/** Opt-in SDK reference probe. Dependencies stay outside the RUYIN installation. */
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const [keyFile,sdkDirectory,outputArg]=process.argv.slice(2);
if(!keyFile||!sdkDirectory||!outputArg)throw Error('Usage: KEY_FILE SDK_DIRECTORY OUTPUT');
const output=resolve(outputArg);mkdirSync(output,{recursive:true});
const source=readFileSync(keyFile,'utf8');
const keys=[...new Set(source.match(/sk-[A-Za-z0-9_-]{16,}/g)||[])];assert.equal(keys.length,1);
const credential=keys[0];
const {DeepSeekHarness}=await import(pathToFileURL(resolve(sdkDirectory,'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')).href);
const manifest=JSON.parse(readFileSync(resolve(sdkDirectory,'node_modules/@deepseek-ai/dsh-sdk-client/package.json'),'utf8'));assert.equal(manifest.version,'0.2.2-rc.4');
const patch=join(output,'text-only.patch.yml');
writeFileSync(patch,`# V0 synthetic text-only probe; no shell or filesystem tools.
- id: persistent-bash
  disabled: true
- id: persistent-pwsh
  disabled: true
- id: terminal-bash
  disabled: true
- id: terminal-pwsh
  disabled: true
- id: tool-fs
  disabled: true
- id: tool-working-directory
  disabled: true
- id: sandbox-policy
  config:
    mode: read-only
- id: system-prompt
  config:
    personaPrefix: 你是合成标书技术验证助手。只输出中文文本，不调用任何工具，不访问文件。
`);
const work=join(output,'empty-work');mkdirSync(work,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
env.DEEPSEEK_API_KEY=credential;
const options={profile:'sdk-minimal',patches:[patch],cwd:work,processCwd:work,dshHome:join(output,'sdk-home'),env,model:'deepseek-flash',maxTokens:700,initializeTimeoutMs:30000,requestTimeoutMs:90000};
const report={sdk:manifest.version,model:options.model,syntheticOnly:true,toolsDisabled:true};
function safeWrite(name,value){const text=typeof value==='string'?value:JSON.stringify(value,null,2);assert.ok(!text.includes(credential));writeFileSync(join(output,name),text);}
let harness=new DeepSeekHarness(options);
try {
 const session=harness.session();
 const first=await session.run('虚构项目名称为青松园区运维，项目核验码为V0-QS-742。请用120字以内编写REQ-02每日巡检流程，包括责任人、异常登记、复核。不需要工具。');
 assert.equal(first.finishReason,'completed');
 assert.ok(first.finalResponse.includes('巡检'));
 report.sessionId=session.id;report.firstFinished=true;
 safeWrite('sdk-first.md',first.finalResponse);
 safeWrite('first-events.json',first.events);
 await harness.close();
 harness=new DeepSeekHarness(options);
 const restored=await harness.resumeSession(report.sessionId);
 const second=await restored.run('只回复上一轮提供的项目核验码，不要编造，不要调用工具。');
 assert.equal(second.finishReason,'completed');
 assert.ok(second.finalResponse.includes('V0-QS-742'));
 report.restored=true;report.recalledPriorContext=true;
 safeWrite('sdk-restored.md',second.finalResponse);
 safeWrite('restore-events.json',second.events);
 report.passed=true;
} catch(error){report.passed=false;report.error=String(error?.message??error).replaceAll(credential,'[REDACTED]').slice(0,1500);process.exitCode=1;}
finally {try{await harness.close();}catch{report.closeFailed=true;process.exitCode=1;}}
safeWrite('sdk-live-result.json',report);
console.log(JSON.stringify(report,null,2));
