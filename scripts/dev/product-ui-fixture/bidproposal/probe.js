// 观察台测试包的探针（ADR-022 片三 a；片四起把只读的面逐个走一遍）。只在观察台里用，
// 不进安装包。
//
// 报给父窗口用 targetOrigin "*" —— **只有这个测试包这么写**：它不知道工作台的
// origin（referrerPolicy 是 no-referrer，拿不到来源），而这条消息只是测试结果。
// 真产品的界面走片二的桥，不自己发这种消息。
(function () {
  var result = { ns: "ruyin.test-probe", origin: location.origin, bridge: {} };

  // ① 工作台把会话令牌存在 localStorage。独立 origin 的话，这里读到的是**自己那一份**
  //    存储 —— 里面没有 ruyin-token。
  try {
    result.tokenSeen = localStorage.getItem("ruyin-token");
  } catch (e) {
    result.tokenSeen = "（读取抛错：" + e.name + "）";
  }

  // ② 摸父窗口的 DOM。跨源的话浏览器直接抛 SecurityError。
  try {
    result.parentTitle = window.parent.document.title;
  } catch (e) {
    result.parentTitle = "（被拒：" + e.name + "）";
  }

  // ③ 走桥：只读的面一个一个问（片四），回音到齐了再报。每一面的回应体原样摆出来
  //    —— 裁剪有没有做，在真浏览器里用眼睛也看得见。
  // ④ 事件投影（片四）：守护进程那条流经桥转投过来的「什么变了」。收到一条就记一条、
  //    报一次 —— 观察台据此验证事件真的穿过了沙箱。
  result.events = [];
  window.addEventListener("message", function (ev) {
    var d = ev.data || {};
    if (d.ns !== "ruyin.bridge" || d.kind !== "event") return;
    result.events.push({ topic: d.topic, payload: d.payload });
    document.getElementById("out").textContent = JSON.stringify(result, null, 2);
    window.parent.postMessage({ ns: "ruyin.test-probe", event: { topic: d.topic, payload: d.payload } }, "*");
  });

  var paths = ["/context", "/project", "/tasks"];
  var pending = {};
  window.addEventListener("message", function (ev) {
    var d = ev.data || {};
    if (d.ns !== "ruyin.bridge" || !pending[d.id]) return;
    result.bridge[pending[d.id]] = { ok: d.ok, status: d.status, body: d.body, error: d.error };
    delete pending[d.id];
    if (Object.keys(pending).length > 0) return;
    document.getElementById("out").textContent = JSON.stringify(result, null, 2);
    window.parent.postMessage(result, "*");
  });
  paths.forEach(function (path, i) {
    var id = "probe-" + Date.now() + "-" + i;
    pending[id] = path;
    window.parent.postMessage({ ns: "ruyin.bridge", kind: "request", id: id, method: "GET", path: path }, "*");
  });
})();
