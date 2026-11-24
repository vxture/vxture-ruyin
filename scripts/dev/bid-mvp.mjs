import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const [template, heading, workdir] = process.argv.slice(2);
if (!template || !heading) throw new Error("Usage: node scripts/dev/bid-mvp.mjs TEMPLATE.docx HEADING [WORKDIR]");
const run = promisify(execFile);
const script = fileURLToPath(new URL("./bid-markdown-preview.ps1", import.meta.url));
const root = workdir ? resolve(workdir) : await mkdtemp(join(tmpdir(), "ruyin-bid-mvp-"));
const templateDigest=createHash("sha256").update(await readFile(resolve(template))).digest("hex");
await mkdir(root,{recursive:true});
async function saveFile(path, content) {
  const staged=path+"."+randomBytes(8).toString("hex")+".tmp";
  await writeFile(staged,content);
  await rename(staged,path);
}
const key = randomBytes(24).toString("hex");
const prefix = "/" + key;
let revision = 0;
let ready = 0;
let busy = false;
let totalPages = 0;
let chapterPage = 1;
let draftSaved = false;
try { await readFile(join(root,"draft.md")); draftSaved=true; } catch(error) { if(error.code!=="ENOENT")throw error; }
revision = Math.max(0,...(await readdir(root)).filter(name=>/^\d+$/.test(name)).map(Number));
try {
  const previous=JSON.parse(await readFile(join(root,"preview-state.json"),"utf8"));
  if(Number.isInteger(previous.version)&&previous.version>0&&Number.isInteger(previous.pages)&&previous.pages>0&&previous.templateDigest===templateDigest&&previous.template===resolve(template)&&previous.heading===heading) {
    ready=previous.version;totalPages=previous.pages;chapterPage=previous.page;
  }
} catch(error) { if(error.code!=="ENOENT")throw error; }
const pageJobs = new Map();
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>标书章节试排</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px system-ui,sans-serif;color:#20312d;background:#f4f7f5}header{background:white;padding:16px 24px;border-bottom:1px solid #dce4df;display:flex;gap:16px;align-items:center;flex-wrap:wrap}h1{margin:0;font-size:19px}button,a{padding:8px 12px;border-radius:6px;border:1px solid #c8d5ce;background:white;color:#1b493b;text-decoration:none}button{background:#1b493b;color:white;cursor:pointer}button:disabled{opacity:.6}main{display:grid;grid-template-columns:minmax(260px,36%) 1fr;gap:12px;padding:12px;min-height:calc(100vh - 74px)}section{display:flex;flex-direction:column;gap:8px;padding:14px;background:white;border:1px solid #dce4df;border-radius:8px}textarea,iframe{width:100%;min-height:70vh;flex:1;border:1px solid #c8d5ce;border-radius:5px}textarea{resize:vertical;padding:12px;font:15px/1.7 Consolas,monospace}small{color:#536760}@media(max-width:760px){main{grid-template-columns:1fr}}</style>
<header><h1>标书章节试排</h1><button id="save">保存草稿</button><button id="render">生成分页预览</button><a id="source" download="章节.md">下载 Markdown</a><a id="docx" hidden download="标书.docx">下载 DOCX</a><a id="pdf" hidden download="标书.pdf">下载 PDF</a><small id="status" role="status">${workdir ? "本机工作目录 · 已保存内容可重启恢复" : "本机临时草稿 · 结束服务后清除"}</small></header>
<main><section><label for="draft"><strong>章节 Markdown</strong></label><textarea id="draft">梳理项目工作范围和交付要求。

1. 核对招标依据，记录待确认的条款。
2. 按工作单元落实安排，逐项记录实施成果。
3. 汇总复核意见，确认交付资料齐全。</textarea></section><section><strong>Word 正式分页</strong><iframe title="正式分页预览" id="pages" hidden></iframe></section></main>
<script>
const el=id=>document.getElementById(id);
const draft=el('draft'), status=el('status'), button=el('render');
const base=location.pathname;
const links=['docx','pdf'].map(el);
let sourceUrl;
function updateSource(){if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=URL.createObjectURL(new Blob([draft.value],{type:'text/markdown;charset=utf-8'}));el('source').href=sourceUrl;}
updateSource();
let changes=0;
async function saveDraft(){
  const version=changes;
  const res=await fetch(base+'/draft',{method:'PUT',headers:{'Content-Type':'text/plain; charset=utf-8'},body:draft.value});
  const data=await res.json();if(!res.ok)throw Error(data.error);
  if(version===changes)status.textContent='草稿已保存到本机';
}
el('save').onclick=async()=>{try{await saveDraft();}catch(e){status.textContent='保存失败：'+e.message;}};
fetch(base+'/draft').then(r=>r.json()).then(data=>{if(changes!==0)return;if(data.markdown!==null)draft.value=data.markdown;updateSource();if(data.preview){el('pages').src=base+'/'+data.preview.version+'/pages';el('pages').hidden=false;links.forEach(x=>{x.href=base+'/'+data.preview.version+'/'+x.id;x.hidden=false;});}}).catch(()=>{status.textContent='读取草稿失败';});
draft.oninput=()=>{changes++;updateSource();links.forEach(x=>x.hidden=true);el('pages').hidden=true;status.textContent='正文未保存，预览已过期。'};
button.onclick=async()=>{
  button.disabled=true;draft.readOnly=true;links.forEach(x=>x.hidden=true);
  status.textContent='正在调用 Word 排版…';
  try{
    await saveDraft();status.textContent='草稿已保存，正在调用 Word 排版…';
    const res=await fetch(base+'/render',{method:'POST',headers:{'Content-Type':'text/plain; charset=utf-8'},body:draft.value});
    const data=await res.json();if(!res.ok)throw Error(data.error);
    const page=el('pages');page.src=base+'/'+data.version+'/pages';page.hidden=false;
    links.forEach(x=>{x.href=base+'/'+data.version+'/'+x.id;x.hidden=false});
    status.textContent='预览已更新 · 两种下载均来自本次排版';
  }catch(e){status.textContent=e.message;}finally{button.disabled=false;draft.readOnly=false;}
};
</script></html>`;
function json(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
const server = createServer(async (req,res) => {
  const path = req.url ?? "";
  const origin = "http://127.0.0.1:" + server.address().port;
  if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
  res.setHeader("Cache-Control","no-store");
  try {
    if (req.method === "GET" && path === prefix) {
      res.writeHead(200,{ "content-type":"text/html; charset=utf-8" }).end(html);
    } else if (req.method === "GET" && path === prefix+"/draft") {
      const markdown=draftSaved ? await readFile(join(root,"draft.md"),"utf8") : null;
      const rendered=ready ? await readFile(join(root,ready+".md"),"utf8") : null;
      json(res,200,{markdown,preview:ready&&rendered===markdown ? {version:ready} : null});
    } else if (req.method === "PUT" && path === prefix+"/draft" && req.headers.origin === origin) {
      const chunks=[];let size=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        size+=chunk.length;
        if(size>64*1024){res.setHeader("Connection","close");return json(res,413,{error:"章节超过 64 KiB 试排限制。"});}
        chunks.push(chunk);
      }
      await saveFile(join(root,"draft.md"),Buffer.concat(chunks));
      draftSaved=true;json(res,200,{saved:true});
    } else if (req.method === "POST" && path === prefix + "/render" && req.headers.origin === origin) {
      if (busy) return json(res,409,{error:"正在排版，请稍后重试。"});
      busy = true;
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req.iterator({destroyOnReturn:false})) {
          size += chunk.length;
          if (size > 64 * 1024) {
            res.setHeader("Connection","close");
            return json(res,413,{error:"章节超过试排的 64 KiB 限制。"});
          }
          chunks.push(chunk);
        }
        const next = ++revision;
        const input = join(root, next + ".md");
        await writeFile(input, Buffer.concat(chunks));
        const {stdout} = await run("pwsh",["-NoProfile","-File",script,"-Template",resolve(template),"-Markdown",input,"-Heading",heading,"-OutputDirectory",join(root,String(next))],{timeout:120_000});
        const page = Number(stdout.match(/ChapterPage\s*:\s*(\d+)/)?.[1] ?? 1);
        const count = Number(stdout.match(/\bPages\s*:\s*(\d+)/)?.[1]);
        if (!Number.isInteger(count) || count < 1) throw new Error("Missing page count");
        const output = join(root, String(next));
        await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-r", "115", "-png", join(output, "preview.pdf"), join(output, "page")], {timeout:30_000});
        ready = next;
        totalPages = count;
        chapterPage = page;
        await saveFile(join(root,"preview-state.json"),JSON.stringify({version:next,pages:count,page,template:resolve(template),templateDigest,heading}));
        json(res,200,{version:next,page});
      } finally { busy = false; }
    } else if (req.method === "GET" && ready && path === prefix+"/"+ready+"/pages") {
      const images = Array.from({length:totalPages},(_,i)=>`<section id="p${i+1}"><p>第 ${i+1} / ${totalPages} 页</p><img loading="lazy" width="794" height="1123" src="${prefix}/${ready}/page/${i+1}" alt="第 ${i+1} 页"></section>`).join("");
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"}).end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e7eae8;font:14px system-ui}nav{position:sticky;top:0;background:white;padding:12px}section{margin:16px auto;width:min(96%,794px)}img{width:100%;height:auto;background:white}a{margin-right:16px}</style><nav>共 ${totalPages} 页 <a href="#p1">首页</a><a href="#p${chapterPage}">当前章节</a><a href="${prefix}/${ready}/pdf" target="_blank">完整 PDF</a></nav>${images}<script>location.hash='p${chapterPage}'</script>`);
    } else if (req.method === "GET" && ready && path.startsWith(prefix+"/"+ready+"/page/")) {
      const number = Number(path.slice((prefix+"/"+ready+"/page/").length));
      if (!Number.isInteger(number) || number < 1 || number > totalPages) {res.writeHead(404).end();return;}
      const output = join(root,String(ready));
      const file = join(output,"render-"+number);
      if (!pageJobs.has(file)) pageJobs.set(file, run("pdftoppm",["-f",String(number),"-l",String(number),"-singlefile","-r","96","-png",join(output,"preview.pdf"),file],{timeout:30_000}).catch(error=>{pageJobs.delete(file);throw error;}));
      await pageJobs.get(file);
      res.writeHead(200,{"content-type":"image/png"}).end(await readFile(file+".png"));
    } else if (req.method === "GET" && ready && [prefix+"/"+ready+"/pdf",prefix+"/"+ready+"/docx"].includes(path)) {
      const type = path.endsWith("/pdf") ? "pdf" : "docx";
      res.setHeader("Content-Type",type==="pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.end(await readFile(join(root,String(ready),"preview."+type)));
    } else if (req.method === "POST" && path === prefix+"/render") json(res,403,{error:"请直接在本机浏览器打开试排链接后重试。"});
    else res.writeHead(404).end();
  } catch (error) {
    const detail = String(error.stderr || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
    console.error(error.stderr || error.stdout || error.message);
    const reason = error.killed ? "Word 排版超时。请检查 Word 是否有待处理的弹窗。" :
      detail ? detail.slice(0,500) : "Word 或页面渲染未完成，请重试。";
    if (!res.headersSent) json(res,422,{error:"试排失败："+reason});
    else res.destroy();
  }
});
server.listen(0,"127.0.0.1",()=>console.log("http://127.0.0.1:"+server.address().port+prefix));
process.on("SIGINT",()=>server.close(async()=>{if(!workdir)await rm(root,{recursive:true,force:true});}));
