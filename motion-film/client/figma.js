/*
 * Mótion Film — "Mótion Figma Layers" satellite window
 *
 * A separate CEP extension (com.motionfilm.figma) in the same bundle. Two
 * jobs:
 *
 * 1. Local bridge server (Node http, 127.0.0.1/::1 port 47811 only, never
 *    the LAN). The Figma plugin (figma-plugin/ in this repo) talks to it:
 *      GET  /ping  -> who am I (plugin shows "conectado")
 *      GET  /poll  -> long-poll; held open until this window has a command
 *                     for Figma (a click on one of the buttons here) or
 *                     ~15s pass. Doubles as the "plugin is open" heartbeat.
 *      POST /push  -> the extracted selection: payload JSON + PNGs as
 *                     base64. Sent as text/plain so the browser treats it
 *                     as a "simple" request (no CORS preflight).
 *    PNGs are written next to the .aep ("Figma Assets/…") or, for an
 *    unsaved project, to Documents/Mótion Figma Layers/Assets; the payload
 *    goes to a temp JSON file and host/figma.jsx mflBuild() reads it (no
 *    multi-MB strings through evalScript).
 *
 * 2. The two buttons (Camadas / Rasterizar): they don't read anything
 *    themselves; they queue a command that the Figma plugin picks up on
 *    its next poll, and the plugin answers with a /push.
 *
 * host/figma.jsx is loaded here with $.evalFile (shared ExtendScript
 * engine), re-loaded on every window load so edits apply without
 * restarting AE.
 */
(function () {
  "use strict";

  var PORT = 47811;
  var POLL_HOLD_MS = 15000;
  var COMMAND_TIMEOUT_MS = 90000;

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------
  // Host bridge
  // ---------------------------------------------------------------
  function evalHost(expression, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(expression, callback || function () {});
      return;
    }
    if (callback) {
      callback(JSON.stringify({ ok: false, error: "Esta janela precisa rodar dentro do After Effects." }));
    }
  }

  function hostCall(name, args, callback) {
    var serialized = [];
    for (var i = 0; i < args.length; i += 1) {
      serialized.push(JSON.stringify(args[i]));
    }
    evalHost(name + "(" + serialized.join(",") + ")", function (raw) {
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        parsed = { ok: false, error: raw || "Sem resposta do After Effects." };
      }
      if (callback) {
        callback(parsed);
      }
    });
  }

  function hostCallAsync(name, args) {
    return new Promise(function (resolve) { hostCall(name, args, resolve); });
  }

  function nodeRequire(name) {
    // Same bridge rule as panel.js: cep_node.require is the one that works.
    var req = (window.cep_node && window.cep_node.require) || window.require || (typeof require !== "undefined" ? require : null);
    if (!req) {
      throw new Error("Node.js não está disponível nesta janela (falta --enable-nodejs).");
    }
    return req(name);
  }

  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; } // macOS
    return p;
  }

  function loadHostScript(callback) {
    var path = extensionDir() + "/host/figma.jsx";
    evalHost("$.evalFile(" + JSON.stringify(path) + "); typeof mflBuild", function (res) {
      if (callback) { callback(res === "function"); }
    });
  }

  function ensureHostScript() {
    return new Promise(function (resolve) {
      evalHost("typeof mflBuild", function (res) {
        if (res === "function") { resolve(true); return; }
        loadHostScript(resolve);
      });
    });
  }

  // ---------------------------------------------------------------
  // Compositing keep-alive (see layers.html / palette.html)
  // ---------------------------------------------------------------
  function startPaintKeepAlive() {
    var canvas = $("paint-keepalive");
    var ctx = null;
    try { ctx = canvas && canvas.getContext("2d"); } catch (ctxError) {}
    if (!ctx) { return; }
    var tick = 0;
    function paint() {
      tick = (tick + 1) % 256;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(" + tick + "," + ((tick * 2) % 256) + ",0,0.02)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    paint();
    window.setInterval(paint, 120);
    if (typeof window.requestAnimationFrame === "function") {
      var rafLoop = function () { paint(); window.requestAnimationFrame(rafLoop); };
      window.requestAnimationFrame(rafLoop);
    }
  }

  // ---------------------------------------------------------------
  // Status toast (lean copy of panel.js setStatus)
  // ---------------------------------------------------------------
  var statusHideTimer = null;

  function hideStatus() {
    if (statusHideTimer) { clearTimeout(statusHideTimer); statusHideTimer = null; }
    var status = $("status");
    status.classList.remove("is-visible");
    window.setTimeout(function () {
      if (!status.classList.contains("is-visible")) { status.hidden = true; }
    }, 200);
  }

  function setStatus(message, type, holdMs) {
    if (!message) { hideStatus(); return; }
    var status = $("status");
    status.style.top = "10px";
    status.hidden = false;
    status.textContent = message;
    status.className = "status" + (type ? " is-" + type : "");
    void status.offsetHeight;
    status.classList.add("is-visible");
    if (statusHideTimer) { clearTimeout(statusHideTimer); }
    statusHideTimer = window.setTimeout(hideStatus, holdMs || 3200);
  }

  // ---------------------------------------------------------------
  // Settings (PNG scale) -- per-window localStorage is fine here.
  // ---------------------------------------------------------------
  var settings = { scale: 2 };
  try {
    var savedScale = Number(window.localStorage.getItem("mfl-scale"));
    if (savedScale >= 1 && savedScale <= 4) { settings.scale = savedScale; }
  } catch (readError) {}

  function renderScale() {
    var btns = $("mfl-scale").querySelectorAll("button");
    for (var i = 0; i < btns.length; i += 1) {
      btns[i].classList.toggle("is-on", Number(btns[i].getAttribute("data-v")) === settings.scale);
    }
  }

  // ---------------------------------------------------------------
  // Bridge state
  // ---------------------------------------------------------------
  var bridge = {
    listening: false,
    error: null,
    waiters: [],      // long-poll responses held open
    queue: [],        // commands waiting for the next poll
    commands: {},     // id -> { mode, timer }
    lastPoll: 0,
    aeVersion: "",
    buildChain: Promise.resolve()
  };
  window.__mfl = bridge; // debug handle (port 8095 bridge)

  function figmaConnected() {
    return bridge.waiters.length > 0 || (Date.now() - bridge.lastPoll) < 4000;
  }

  function renderConnection() {
    var el = $("mfl-conn");
    var text = $("mfl-conn-text");
    el.classList.remove("is-on", "is-wait");
    if (bridge.error) {
      text.textContent = bridge.error;
      el.title = bridge.error;
    } else if (!bridge.listening) {
      text.textContent = "Iniciando ponte…";
    } else if (figmaConnected()) {
      el.classList.add("is-on");
      text.textContent = "Figma conectado";
      el.title = "Plugin Mótion Figma Layers aberto no Figma (porta " + PORT + ")";
    } else {
      el.classList.add("is-wait");
      text.textContent = "Abra o plugin no Figma";
      el.title = "No Figma: Plugins > Development > Mótion Figma Layers (porta " + PORT + ")";
    }
  }

  function sendJSON(res, code, obj) {
    try {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(obj));
    } catch (writeError) {}
  }

  // Accent / panel colour of this extension, sent to the Figma plugin with
  // every reply so its buttons match. Never an evalScript here (it runs on
  // every poll, and evalScript while the user types in the AE viewport
  // bumps the caret): lastTheme is kept fresh by pullTheme, with the
  // localStorage cache as the fallback for the first seconds.
  function currentTheme() {
    var accent = lastTheme.accent;
    var panel = lastTheme.panel;
    try {
      accent = accent || window.localStorage.getItem("motionfilm-accent");
      panel = panel || window.localStorage.getItem("motionfilm-panel");
    } catch (readError) {}
    return { accent: accent || null, panel: panel || null };
  }

  function releaseWaiter(command) {
    while (bridge.waiters.length) {
      var w = bridge.waiters.shift();
      clearTimeout(w.timer);
      if (w.closed) { continue; }
      sendJSON(w.res, 200, { ok: true, ae: bridge.aeVersion, theme: currentTheme(), command: command });
      return true;
    }
    return false;
  }

  function handlePoll(req, res) {
    bridge.lastPoll = Date.now();
    if (bridge.queue.length) {
      sendJSON(res, 200, { ok: true, ae: bridge.aeVersion, theme: currentTheme(), command: bridge.queue.shift() });
      return;
    }
    var waiter = { res: res, closed: false, timer: null };
    waiter.timer = setTimeout(function () {
      var idx = bridge.waiters.indexOf(waiter);
      if (idx >= 0) { bridge.waiters.splice(idx, 1); }
      bridge.lastPoll = Date.now();
      sendJSON(res, 200, { ok: true, ae: bridge.aeVersion, theme: currentTheme(), command: null });
    }, POLL_HOLD_MS);
    req.on("close", function () {
      waiter.closed = true;
      var idx = bridge.waiters.indexOf(waiter);
      if (idx >= 0) { bridge.waiters.splice(idx, 1); clearTimeout(waiter.timer); }
    });
    bridge.waiters.push(waiter);
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      req.on("data", function (c) { chunks.push(c); });
      req.on("end", function () {
        try {
          var Buffer = nodeRequire("buffer").Buffer;
          resolve(Buffer.concat(chunks).toString("utf8"));
        } catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }

  function handleRequest(req, res) {
    var url = String(req.url || "/").split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600"
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/ping") {
      bridge.lastPoll = Date.now();
      sendJSON(res, 200, { ok: true, app: "motion-figma-layers", ae: bridge.aeVersion, theme: currentTheme() });
      return;
    }
    if (req.method === "GET" && url === "/poll") {
      handlePoll(req, res);
      return;
    }
    if (req.method === "POST" && url === "/push") {
      bridge.lastPoll = Date.now();
      readBody(req).then(function (text) {
        var body;
        try { body = JSON.parse(text); } catch (parseError) {
          sendJSON(res, 400, { ok: false, error: "JSON inválido." });
          return;
        }
        handlePush(body).then(function (result) {
          sendJSON(res, 200, result);
        });
      }, function (err) {
        sendJSON(res, 500, { ok: false, error: String(err) });
      });
      return;
    }
    sendJSON(res, 404, { ok: false, error: "Rota desconhecida." });
  }

  // Defensive: if a previous instance's servers are still alive in this
  // Node process, they hold the port and answer with handlers bound to a
  // dead page. cep_node.global does NOT survive a page reload, so they are
  // found through Node's own list of active handles and closed by port.
  //
  // Found live: a location.reload() of this window leaves Node's event
  // loop dead for the new page (even a fresh server on another port never
  // finishes listen()), so the bridge cannot come back from a reload at
  // all -- the window has to be CLOSED and reopened (Window > Extensions),
  // which starts a fresh process. Never reload this window to apply edits.
  function closeStaleServers() {
    var closed = 0;
    try {
      var proc = window.cep_node && window.cep_node.process;
      var handles = (proc && typeof proc._getActiveHandles === "function") ? proc._getActiveHandles() : [];
      for (var i = 0; i < handles.length; i += 1) {
        var h = handles[i];
        try {
          if (h && typeof h.address === "function" && typeof h.listen === "function" && typeof h.close === "function") {
            var addr = h.address();
            if (addr && addr.port === PORT) {
              if (typeof h.closeAllConnections === "function") { h.closeAllConnections(); }
              h.close();
              closed += 1;
            }
          }
        } catch (handleError) {}
      }
    } catch (scanError) {}
    return closed;
  }

  function startServer(attempt) {
    attempt = attempt || 0;
    var http;
    try { http = nodeRequire("http"); } catch (e) {
      bridge.error = e.message;
      renderConnection();
      return;
    }
    var g = (window.cep_node && window.cep_node.global) || window;
    if (g.__mflServers && attempt === 0) {
      for (var i = 0; i < g.__mflServers.length; i += 1) {
        try { g.__mflServers[i].close(); } catch (closeError) {}
      }
    }
    closeStaleServers();
    g.__mflServers = [];

    var hosts = ["127.0.0.1", "::1"];
    hosts.forEach(function (host) {
      var srv = http.createServer(handleRequest);
      srv.on("error", function (err) {
        if (host !== "127.0.0.1") { return; } // IPv6 é bônus
        if (err && err.code === "EADDRINUSE" && attempt < 6) {
          window.setTimeout(function () { startServer(attempt + 1); }, 700);
          return;
        }
        bridge.listening = false;
        bridge.error = err && err.code === "EADDRINUSE"
          ? "Porta " + PORT + " ocupada (outro After Effects aberto?)"
          : "Ponte falhou: " + (err && err.message ? err.message : err);
        renderConnection();
      });
      srv.listen(PORT, host, function () {
        if (host === "127.0.0.1") {
          bridge.listening = true;
          bridge.error = null;
          renderConnection();
        }
      });
      g.__mflServers.push(srv);
    });
  }

  // ---------------------------------------------------------------
  // Push -> disco -> host/figma.jsx
  // ---------------------------------------------------------------
  function sanitize(name) {
    var s = String(name || "figma").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
    if (s.length > 60) { s = s.substring(0, 60).trim(); }
    return s || "figma";
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function finishCommand(id) {
    if (!id || !bridge.commands[id]) { return null; }
    var cmd = bridge.commands[id];
    clearTimeout(cmd.timer);
    delete bridge.commands[id];
    setButtonBusy(cmd.mode, false);
    return cmd;
  }

  function handlePush(body) {
    if (body && body.error) {
      finishCommand(body.commandId);
      setStatus(body.error, "error", 5000);
      return Promise.resolve({ ok: true });
    }
    if (!body || !body.payload) {
      finishCommand(body && body.commandId);
      return Promise.resolve({ ok: false, error: "Pedido sem dados." });
    }
    // Serializa: um build de cada vez no AE.
    var run = bridge.buildChain.then(function () { return build(body); });
    bridge.buildChain = run.then(function () {}, function () {});
    return run.then(function (r) { return r; }, function (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    });
  }

  async function build(body) {
    var payload = body.payload;
    var mode = payload.mode === "raster" || payload.mode === "comp" ? payload.mode : "layers";
    setButtonBusy(mode, true);
    setStatus(mode === "raster" ? "Recebendo PNGs do Figma…" : (mode === "comp" ? "Criando composição…" : "Montando camadas do Figma…"), null, 60000);
    try {
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      var os = nodeRequire("os");
      var Buffer = nodeRequire("buffer").Buffer;

      var loaded = await ensureHostScript();
      if (!loaded) { throw new Error("Não consegui carregar host/figma.jsx."); }

      var proj = await hostCallAsync("mflProjectDir", []);
      var baseDir = (proj && proj.dir)
        ? path.join(proj.dir, "Figma Assets")
        : path.join(os.homedir(), "Documents", "Mótion Figma Layers", "Assets");
      var first = (payload.groups && payload.groups[0]) || {};
      var batch = sanitize(first.name || (first.container && first.container.name) || payload.fileName) + "_" + stamp();
      var dir = path.join(baseDir, batch);

      var assetPaths = {};
      var assets = body.assets || [];
      if (assets.length) {
        fs.mkdirSync(dir, { recursive: true });
        for (var i = 0; i < assets.length; i += 1) {
          var a = assets[i];
          var file = path.join(dir, sanitize(a.name) + "_" + a.id + ".png");
          fs.writeFileSync(file, Buffer.from(String(a.data || ""), "base64"));
          assetPaths[a.id] = file.replace(/\\/g, "/");
        }
      }

      var tmp = path.join(os.tmpdir(), "mfl_payload_" + Date.now() + ".json");
      fs.writeFileSync(tmp, JSON.stringify({ payload: payload, assetPaths: assetPaths }), "utf8");
      var result = await hostCallAsync("mflBuild", [tmp.replace(/\\/g, "/")]);
      // Fica uma cópia do que o Figma mandou (só o JSON, sem os PNGs) para
      // diagnosticar uma importação que saiu diferente do Figma.
      try {
        var lastDir = path.join(os.homedir(), "Documents", "Mótion Figma Layers");
        fs.mkdirSync(lastDir, { recursive: true });
        fs.copyFileSync(tmp, path.join(lastDir, "ultima-importacao.json"));
      } catch (lastCopyError) {}
      try { fs.unlinkSync(tmp); } catch (unlinkError) {}

      if (result && result.ok) {
        setStatus(result.message || "Importado.", "success", 3600);
      } else {
        setStatus((result && result.error) || "Falha ao montar as camadas.", "error", 6000);
      }
      return result || { ok: false, error: "Sem resposta do After Effects." };
    } finally {
      finishCommand(body.commandId);
      setButtonBusy(mode, false);
    }
  }

  // ---------------------------------------------------------------
  // Botões: pedem a seleção atual pro plugin do Figma
  // ---------------------------------------------------------------
  function setButtonBusy(mode, busy) {
    var btn = $(mode === "raster" ? "mfl-raster" : (mode === "comp" ? "mfl-comp" : "mfl-layers"));
    if (btn) { btn.classList.toggle("is-busy", !!busy); }
  }

  function requestFromFigma(mode) {
    if (bridge.error) { setStatus(bridge.error, "error", 5000); return; }
    if (!figmaConnected()) {
      setStatus("Abra o plugin “Mótion Figma Layers” no Figma (Plugins › Development) e deixe a janela dele aberta.", "error", 6000);
      return;
    }
    for (var id in bridge.commands) {
      if (bridge.commands.hasOwnProperty(id)) {
        setStatus("Ainda esperando o Figma responder o pedido anterior…", null, 2500);
        return;
      }
    }
    var cmd = { id: "c" + Date.now(), mode: mode, options: { scale: settings.scale } };
    bridge.commands[cmd.id] = {
      mode: mode,
      timer: setTimeout(function () {
        if (bridge.commands[cmd.id]) {
          finishCommand(cmd.id);
          setStatus("O Figma não respondeu. O plugin ainda está aberto?", "error", 5000);
        }
      }, COMMAND_TIMEOUT_MS)
    };
    setButtonBusy(mode, true);
    setStatus(mode === "raster" ? "Pedindo PNGs ao Figma…" : (mode === "comp" ? "Pedindo o frame ao Figma…" : "Pedindo a seleção ao Figma…"), null, 60000);
    if (!releaseWaiter(cmd)) {
      bridge.queue.push(cmd);
    }
  }

  // ---------------------------------------------------------------
  // Tema (espelhado do painel principal, mesmo canal do layers.js)
  // ---------------------------------------------------------------
  var lastTheme = { accent: null, panel: null };

  function applyTheme(accent, panel) {
    var root = document.documentElement.style;
    if (accent) {
      window.MF.color.applyAccent(root, accent);
    }
    if (panel && window.MF && window.MF.color) {
      window.MF.color.applyPanelShades(root, panel);
    }
  }

  function pullTheme() {
    hostCall("getSharedTheme", [], function (res) {
      if (!res || !res.ok) { return; }
      var accent = res.accent || null;
      var panel = res.panel || null;
      if (accent !== lastTheme.accent || panel !== lastTheme.panel) {
        lastTheme.accent = accent;
        lastTheme.panel = panel;
        applyTheme(accent, panel);
        try {
          if (accent) { window.localStorage.setItem("motionfilm-accent", accent); }
          if (panel) { window.localStorage.setItem("motionfilm-panel", panel); }
        } catch (cacheError) {}
      }
    });
  }

  function initTheme() {
    try {
      applyTheme(window.localStorage.getItem("motionfilm-accent"), window.localStorage.getItem("motionfilm-panel"));
    } catch (readError) {}
    pullTheme();
    window.setTimeout(pullTheme, 1500);
    window.setTimeout(pullTheme, 5000);
    // Só puxa com a janela em foco: evalScript durante edição de texto no
    // viewport joga o cursor pro início (regra do palette.js/layers.js).
    window.addEventListener("focus", pullTheme);
  }

  // ---------------------------------------------------------------
  function init() {
    startPaintKeepAlive();
    renderScale();
    renderConnection();
    $("mfl-layers").addEventListener("click", function () { requestFromFigma("layers"); });
    $("mfl-raster").addEventListener("click", function () { requestFromFigma("raster"); });
    $("mfl-comp").addEventListener("click", function () { requestFromFigma("comp"); });
    $("mfl-scale").addEventListener("click", function (event) {
      var v = event.target && event.target.getAttribute && event.target.getAttribute("data-v");
      if (!v) { return; }
      settings.scale = Number(v);
      try { window.localStorage.setItem("mfl-scale", String(settings.scale)); } catch (writeError) {}
      renderScale();
    });
    loadHostScript(function () {
      hostCall("mflInfo", [], function (res) {
        if (res && res.ok) { bridge.aeVersion = res.ae || ""; }
      });
    });
    startServer(0);
    window.setInterval(renderConnection, 1000);
    initTheme();
  }

  document.addEventListener("DOMContentLoaded", init);
}());
