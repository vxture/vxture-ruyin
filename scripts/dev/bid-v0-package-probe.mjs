import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { createProductUiServer } from "../../apps/local-host/dist/product-ui-server.js";
import { createHash } from "node:crypto";
import { packProduct } from "../../packages/cli/dist/pack.js";
import { makeTestZip } from "../../apps/local-host/dist/pkg-testkit.js";
import { installPackage } from "../../apps/local-host/dist/installer.js";

const output=process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(),"ruyin-v0-package-"));
mkdirSync(output,{recursive:true});
const source=join(output,"source");
mkdirSync(source,{recursive:true});
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V0 文档桥验证</title><h1>V0 包界面加载验证</h1><p>此页为技术探针，使用宿主加密存储。</p><label>章节 Markdown<textarea id="draft" rows="18" cols="90"></textarea></label><p><button id="save">保存章节</button> <button id="reload">重新读取</button> <output id="status">正在读取</output></p><script src="editor.js"></script></html>';
const js = `(() => {
  const pending=new Map();let revision=0;
  const status=document.getElementById('status'),draft=document.getElementById('draft');
  // The host origin is learned from the first valid response; requests carry no secrets.
  let hostOrigin='*';
  window.addEventListener('message',event=>{
    if(event.source!==parent)return;
    const d=event.data;if(!d||d.ns!=='ruyin.bridge'||d.kind!=='response'||!pending.has(d.id))return;
    if(hostOrigin!=='*'&&event.origin!==hostOrigin)return;
    hostOrigin=event.origin;
    const callback=pending.get(d.id);pending.delete(d.id);callback(d);
  });
  function call(method,body){return new Promise(resolve=>{const id=crypto.randomUUID();pending.set(id,resolve);parent.postMessage({ns:'ruyin.bridge',kind:'request',id,method,path:'/documents/v0_chapter',body},hostOrigin);});}
  async function load(){const r=await call('GET');if(r.status===404){revision=0;draft.value='# V0 合成章节\\n待编写正文';status.textContent='新章节';}else if(r.ok){revision=r.body.revision;draft.value=r.body.markdown;status.textContent='已读取 v'+revision;}else status.textContent=r.error?.message||'读取失败';}
  document.getElementById('save').onclick=async()=>{const r=await call('PUT',{markdown:draft.value,revision});if(r.ok){revision=r.body.revision;status.textContent='已保存 v'+revision;}else status.textContent=r.error?.message||'保存失败';};
  document.getElementById('reload').onclick=load;load();
})();`;
const ui=makeTestZip([{name:"index.html",data:Buffer.from(html)},{name:"editor.js",data:Buffer.from(js)}]);
const digest=createHash("sha256").update(ui).digest("hex");
const yaml=readFileSync(new URL("../../products/bidproposal/ruyin.product.yaml",import.meta.url),"utf8")
  .replace('contract: "0.1"','contract: "0.2"')
  .replace("  publisher: vxture","  ui:\n    sha256: "+digest+"\n  publisher: vxture");
writeFileSync(join(source,"ruyin.product.yaml"),yaml);
writeFileSync(join(source,"ui.zip"),ui);
const packed=packProduct(source);
const archive=join(output,packed.fileName);
writeFileSync(archive,packed.buffer);
const store=join(output,"store");
const installed=installPackage(packed.buffer,{storeDir:store,runtimeVersion:"0.2.0",requireSignature:false});
const server=createProductUiServer({root:store,workspaceOrigin:"http://127.0.0.1:7420"});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
let served;
try {
  served=await new Promise((resolve,reject)=>{
    const req=request({hostname:"127.0.0.1",port:server.address().port,path:"/"+digest+"/",headers:{host:"bidproposal.localhost:"+server.address().port}},res=>{
      let body="";res.setEncoding("utf8");res.on("data",chunk=>body+=chunk);res.on("end",()=>resolve({status:res.statusCode,containsEntry:body.includes("V0 包界面加载验证")}));
    });req.on("error",reject);req.end();
  });
} finally { await new Promise(r=>server.close(r)); }
const report={
  archive,
  installed:existsSync(join(installed.dir,"ruyin.product.yaml")),
  packagedUi:existsSync(join(installed.dir,"ui.zip")),
  uiReady:existsSync(join(store,"bidproposal","ui",digest,"index.html")),
  http:served,
  signaturePolicy:"development-only",
};
writeFileSync(join(output,"package-result.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.installed||!report.packagedUi||!report.uiReady||served.status!==200||!served.containsEntry)process.exitCode=1;
