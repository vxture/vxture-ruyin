/**
 * Dev workspace console served by the daemon at GET / - a deliberately plain
 * HTML page so the Local Web access mode (60 section 4.2) works from day one:
 * the Electron shell AND any browser open the same URL. The real Workspace UI
 * (React, apps/ui-workspace) replaces this in a later batch; this page only
 * needs to exercise the Phase A API surface.
 *
 * The session token arrives via ?token= and is held in memory only.
 */

export const DEV_UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Ruyin Dev Console</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: flex; height: 100vh; }
  aside { width: 300px; border-right: 1px solid #ddd; padding: 12px; overflow-y: auto; }
  main { flex: 1; padding: 12px 18px; overflow-y: auto; }
  h1 { font-size: 15px; } h2 { font-size: 13px; margin: 16px 0 6px; color: #555; }
  button { cursor: pointer; margin: 2px; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; margin: 6px 0; }
  .card.sel { border-color: #4a7; background: #f4fbf7; }
  .state { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #eef; font-size: 12px; }
  .state.waiting_human { background: #fe9; } .state.completed { background: #cfc; }
  .state.failed { background: #fcc; }
  textarea { width: 100%; font-family: monospace; font-size: 12px; box-sizing: border-box; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  td, th { border: 1px solid #eee; padding: 2px 6px; text-align: left; vertical-align: top; }
  .muted { color: #888; font-size: 12px; }
  #err { color: #b00; white-space: pre-wrap; }
</style>
</head>
<body>
<aside>
  <h1>Ruyin Dev Console</h1>
  <div class="muted" id="version"></div>
  <h2>创建 Workspace</h2>
  <select id="productSel"></select>
  <input id="wsName" placeholder="workspace 名称" size="14">
  <button onclick="createWs()">创建</button>
  <h2>Workspaces</h2>
  <div id="wsList"></div>
  <div id="err"></div>
</aside>
<main id="main"><p class="muted">选择或创建一个 Workspace。</p></main>
<script>
var token = new URLSearchParams(location.search).get("token") || "";
var current = null;

function headers() {
  return { "authorization": "Bearer " + token, "content-type": "application/json" };
}
async function api(path, method, body) {
  var opts = { method: method || "GET", headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fail(e) { document.getElementById("err").textContent = String(e.message || e); }
function clearErr() { document.getElementById("err").textContent = ""; }

async function boot() {
  try {
    var h = await (await fetch("/health")).json();
    document.getElementById("version").textContent = "runtime " + h.version;
    var products = await api("/products");
    document.getElementById("productSel").innerHTML = products.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + " (" + esc(p.id) + ")</option>";
    }).join("");
    await refreshWs();
  } catch (e) { fail(e); }
}
async function refreshWs() {
  var list = await api("/projects");
  document.getElementById("wsList").innerHTML = list.map(function (w) {
    var cls = current && current.meta.id === w.id ? "card sel" : "card";
    return '<div class="' + cls + '" onclick="openWs(\\'' + w.id + '\\')">'
      + "<b>" + esc(w.name) + "</b><br><span class='muted'>" + esc(w.productId) + "</span></div>";
  }).join("") || '<p class="muted">（无）</p>';
}
async function createWs() {
  clearErr();
  try {
    var product = document.getElementById("productSel").value;
    var name = document.getElementById("wsName").value || product;
    var meta = await api("/projects", "POST", { product: product, name: name });
    await refreshWs();
    await openWs(meta.id);
  } catch (e) { fail(e); }
}
async function openWs(id) {
  clearErr();
  try {
    current = await api("/projects/" + id);
    await render();
    await refreshWs();
  } catch (e) { fail(e); }
}
async function render() {
  var ws = current;
  var instances = await api("/projects/" + ws.meta.id + "/tasks");
  var audit = await api("/projects/" + ws.meta.id + "/audit");
  var grants = await api("/projects/" + ws.meta.id + "/grants");
  var bindings = await api("/projects/" + ws.meta.id + "/bindings");
  var html = "<h1>" + esc(ws.meta.name)
    + ' <span class="state">' + esc(ws.businessState) + "</span></h1>"
    + '<div class="muted">' + esc(ws.product.id) + "@" + esc(ws.product.version)
    + " · " + esc(ws.meta.id) + "</div>";

  html += "<h2>业务状态转换</h2><div>"
    + '<input id="stTo" placeholder="目标状态" size="12"> '
    + '<label><input type="checkbox" id="stConfirm"> 人工确认</label> '
    + '<button onclick="transition()">转换</button></div>';

  html += "<h2>文件授权（Grants）</h2>"
    + grants.map(function (g) {
        return '<div class="card"><code>' + esc(g.path) + "</code> <span class='muted'>" + esc(g.mode) + "</span></div>";
      }).join("")
    + '<div><input id="grantPath" placeholder="文件夹绝对路径" size="40"> '
    + '<button onclick="addGrant()">授权</button></div>';

  html += "<h2>上下文绑定（Bindings）</h2>"
    + bindings.map(function (b) {
        return '<div class="card"><b>' + esc(b.type) + "</b> ← <code>" + esc(b.root) + "</code></div>";
      }).join("")
    + '<div><input id="bindType" placeholder="context type" size="18"> '
    + '<input id="bindRoot" placeholder="已授权文件夹内路径" size="34"> '
    + '<button onclick="addBinding()">绑定并索引</button></div>';

  html += "<h2>任务定义</h2>";
  ws.tasks.forEach(function (t, i) {
    html += '<div class="card"><b>' + esc(t.id) + "</b> — " + esc(t.objective)
      + '<div class="muted">输入类型: ' + esc(t.input_types.join(", ") || "（无）") + "</div>"
      + '<textarea id="in' + i + '" rows="2" placeholder="留空 = 自动选择上下文（经绑定 + 最小化 + 敏感确认）；或填 JSON 手动提供"></textarea>'
      + '<button onclick="runTask(\\'' + esc(t.id) + '\\', ' + i + ')">启动任务</button></div>';
  });

  html += "<h2>任务实例</h2>";
  html += instances.map(function (t) {
    var actions = t.state === "waiting_human"
      ? ' <button onclick="decide(\\'' + t.id + '\\', true)">批准</button>'
        + '<button onclick="decide(\\'' + t.id + '\\', false)">拒绝</button>'
      : "";
    var detail = t.error ? "<br><span class='muted'>" + esc(t.error) + "</span>" : "";
    return '<div class="card">' + esc(t.taskId)
      + ' <span class="state ' + esc(t.state) + '">' + esc(t.state) + "</span>"
      + actions + detail + "</div>";
  }).join("") || '<p class="muted">（无）</p>';

  html += "<h2>审计（" + audit.length + " 条，哈希链）</h2><table><tr><th>#</th><th>kind</th><th>actor</th><th>payload</th></tr>"
    + audit.map(function (e, i) {
        return "<tr><td>" + (i + 1) + "</td><td>" + esc(e.kind) + "</td><td>" + esc(e.actor)
          + "</td><td><code>" + esc(JSON.stringify(e.payload)) + "</code></td></tr>";
      }).join("") + "</table>";

  document.getElementById("main").innerHTML = html;
}
async function transition() {
  clearErr();
  try {
    await api("/projects/" + current.meta.id + "/state", "POST", {
      to: document.getElementById("stTo").value,
      humanConfirmed: document.getElementById("stConfirm").checked
    });
    await openWs(current.meta.id);
  } catch (e) { fail(e); }
}
async function runTask(taskId, i) {
  clearErr();
  try {
    var raw = document.getElementById("in" + i).value.trim();
    var body = { task: taskId };
    if (raw.length > 0) body.inputs = JSON.parse(raw);
    await api("/projects/" + current.meta.id + "/tasks", "POST", body);
    await openWs(current.meta.id);
  } catch (e) { fail(e); }
}
async function addGrant() {
  clearErr();
  try {
    await api("/projects/" + current.meta.id + "/grants", "POST",
      { path: document.getElementById("grantPath").value });
    await openWs(current.meta.id);
  } catch (e) { fail(e); }
}
async function addBinding() {
  clearErr();
  try {
    await api("/projects/" + current.meta.id + "/bindings", "POST", {
      type: document.getElementById("bindType").value,
      root: document.getElementById("bindRoot").value
    });
    await openWs(current.meta.id);
  } catch (e) { fail(e); }
}
async function decide(tid, approve) {
  clearErr();
  try {
    await api("/projects/" + current.meta.id + "/tasks/" + tid + "/decision", "POST", { approve: approve });
    await openWs(current.meta.id);
  } catch (e) { fail(e); }
}
boot();
</script>
</body>
</html>
`;
