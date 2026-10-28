/*
 * Mótion Film -- the Wheel, main panel side (Windows).
 *
 * Starts bin/win/MFHelper.exe (source: installer/helper/MFHelper.cs),
 * which holds the shortcut (default Ctrl + Tab) while After Effects is in
 * front and draws the wheel at the mouse. This file sends it the slices
 * from Documents/Mótion Film Packs/wheel.json (wheel-core.js) -- again
 * whenever the "MF - Wheel" settings window saves that file -- and runs
 * what comes back as "pick <id>":
 *   elastic / textanim / transition / curve / layer   Mótion Film tools
 *   command / effect / script / preset               host/wheel.jsx
 * The helper's state (shortcut held, taken by another program...) is
 * written next to the settings as wheel-status.json for that window.
 * The helper lives as long as this panel: it quits when its stdin closes.
 */
(function () {
  "use strict";

  var W = window.MFWheel;
  if (!W) { return; }

  var cfg = null;
  var cfgTime = -1;
  var helper = null;
  var helperState = "off"; // off | starting | ok | busy | missing | error | mac
  var starts = [];
  var buf = "";
  var lastTheme = "";
  var loaded = {};
  var paused = false; // the settings window is capturing a new shortcut
  var ticks = 0;

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }
  function nodeRequire(name) {
    var req = (window.cep_node && window.cep_node.require) || window.require || null;
    if (!req) { throw new Error("no node"); }
    return req(name);
  }
  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }

  // host/<file>.jsx loaded once, then fn(arg)
  function callHost(file, fn, arg, callback) {
    function run() {
      window.__adobe_cep__.evalScript(fn + "(" + JSON.stringify(arg) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (loaded[file]) { run(); return; }
    var path = extensionDir() + "/host/" + file;
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof " + fn, function (res) {
      loaded[file] = res === "function";
      if (loaded[file]) { run(); } else { callback({ ok: false, error: "Couldn't load " + file + " in After Effects." }); }
    });
  }

  // ------------------------------------------------------------------ actions

  function find(id) {
    var out = null;
    (cfg ? cfg.slices : []).forEach(function (s) {
      if (s.id === id) { out = s; }
      (s.children || []).forEach(function (c) { if (c.id === id) { out = c; } });
    });
    return out;
  }

  function finish(item, res) {
    var label = item.label || W.describe(item.action);
    if (res.ok) {
      send("done " + label);
      if (res.message) { status(res.message, "success"); }
    } else {
      send("error " + (res.error || "Couldn't run " + label));
      status(res.error || "Couldn't run " + label, "error");
    }
  }

  var LAYER_BUTTONS = { "null": "create-null", adjustment: "create-adjustment", solid: "create-solid" };

  function run(item) {
    var a = item.action;
    var done = function (res) { finish(item, res); };
    if (!a) { done({ ok: false, error: "This slice has no action yet -- set it in MF - Wheel." }); return; }
    switch (a.type) {
      case "elastic":
        callHost("elastic.jsx", "mfElastic", a.kind, done);
        return;
      case "textanim":
        if (window.MF.textanim) { window.MF.textanim.run(done); } else { done({ ok: false, error: "Text Animation isn't loaded." }); }
        return;
      case "transition":
        if (window.MF.transitions && window.MF.transitions.run) { window.MF.transitions.run(a.id, done); } else { done({ ok: false, error: "Transitions aren't loaded." }); }
        return;
      case "curve":
        var favs = [];
        try { favs = JSON.parse(window.localStorage.getItem("motionfilm-curve-favorites") || "[]"); } catch (e) {}
        var f = favs[(a.n | 0) - 1];
        if (!f || !window.MF.curves) { done({ ok: false, error: "There's no favorite curve " + a.n + " yet (Home › 02 / Favorites)." }); return; }
        window.MF.curves.set(f.inInfluence, f.outInfluence, "Favorite " + a.n);
        done({ ok: true });
        return;
      case "layer":
        var b = $(LAYER_BUTTONS[a.kind]);
        if (!b) { done({ ok: false, error: "Unknown layer." }); return; }
        b.click(); // same as the panel's own button (it reports itself)
        done({ ok: true });
        return;
      default:
        callHost("wheel.jsx", "mfWheelRun", a, done);
    }
  }

  // ------------------------------------------------------------------ helper

  function send(line) {
    if (helper && helper.stdin && helper.stdin.writable) {
      try { helper.stdin.write(line.replace(/[\r\n]+/g, " ") + "\n"); } catch (e) {}
    }
  }

  function sendTheme(force) {
    var css = window.getComputedStyle(document.documentElement);
    var theme = String(css.getPropertyValue("--accent")).trim() + " " + String(css.getPropertyValue("--panel")).trim();
    if (force || theme !== lastTheme) {
      lastTheme = theme;
      send("theme " + theme);
    }
  }

  function sendConfig() {
    if (!cfg) { return; }
    var slices = cfg.slices.map(function (s) {
      return { id: s.id, label: s.label, group: !!s.group, children: (s.children || []).map(function (c) { return { id: c.id, label: c.label }; }) };
    });
    send("wheel " + JSON.stringify({ slices: slices }));
    sendHotkey();
  }

  function sendHotkey() {
    send(cfg.enabled && !paused ? "hotkey " + cfg.hotkey.mods + " " + cfg.hotkey.vk : "hotkey off");
  }

  function writeStatus() {
    try {
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      fs.writeFileSync(path.join(path.dirname(W.file()), "wheel-status.json"), JSON.stringify({ helper: helperState, label: cfg ? cfg.hotkey.label : "", enabled: cfg ? cfg.enabled : true, at: Date.now() }), "utf8");
    } catch (e) {}
    var note = $("wheel-note");
    if (note) {
      var label = cfg ? cfg.hotkey.label : "";
      var text = {
        ok: "Press " + label + " with After Effects in front to open the Wheel (Elastic is in it).",
        busy: label + " is taken by another program -- pick another shortcut in MF - Wheel.",
        missing: "The shortcut program is missing -- reinstall Mótion Film.",
        mac: "The Wheel shortcut is Windows-only for now.",
        error: "The shortcut program stopped several times -- close and reopen the panel.",
        off: "The Wheel shortcut is off (MF - Wheel)."
      }[helperState] || "Starting the Wheel…";
      note.textContent = text;
      note.classList.toggle("is-warn", helperState === "busy" || helperState === "missing" || helperState === "error");
    }
    var key = $("wheel-key");
    if (key) { key.textContent = cfg ? cfg.hotkey.label : ""; }
  }

  function openSettings() {
    try { window.__adobe_cep__.requestOpenExtension("com.motionfilm.wheel", ""); } catch (e) {}
  }

  function onLine(line) {
    var sp = line.indexOf(" ");
    var cmd = sp < 0 ? line : line.slice(0, sp);
    var rest = sp < 0 ? "" : line.slice(sp + 1);
    if (cmd === "ready") {
      helperState = "starting";
      sendTheme(true);
      sendConfig();
    } else if (cmd === "hotkey") {
      helperState = /^ok/.test(rest) ? "ok" : (/^busy/.test(rest) ? "busy" : "off");
    } else if (cmd === "pick") {
      var item = find(rest);
      if (item) { run(item); } else { send("error Unknown slice"); }
    } else if (cmd === "config") {
      openSettings();
    }
    writeStatus();
  }

  function start() {
    if (helper) { return; }
    if (!/^Win/i.test(navigator.platform)) { helperState = "mac"; writeStatus(); return; }
    var fs, cp;
    try { fs = nodeRequire("fs"); cp = nodeRequire("child_process"); } catch (e) { return; }
    var exe = extensionDir() + "/bin/win/MFHelper.exe";
    if (!fs.existsSync(exe)) { helperState = "missing"; writeStatus(); return; }
    var now = Date.now();
    starts = starts.filter(function (t) { return now - t < 60000; });
    if (starts.length >= 3) { helperState = "error"; writeStatus(); return; }
    starts.push(now);
    try {
      helper = cp.spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      helper = null;
      helperState = "error";
      writeStatus();
      return;
    }
    helperState = "starting";
    buf = "";
    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", function (d) {
      buf += d;
      var i;
      while ((i = buf.indexOf("\n")) >= 0) {
        var l = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (l) { onLine(l); }
      }
    });
    helper.on("error", function () {});
    helper.on("exit", function () {
      helper = null;
      helperState = "starting";
      writeStatus();
      setTimeout(start, 1000);
    });
  }

  // wheel-pause.json: the settings window wants the keys for its shortcut
  // field (a stale one, left by a closed window, doesn't count)
  function checkPause() {
    var on = false;
    try {
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      var p = JSON.parse(fs.readFileSync(path.join(path.dirname(W.file()), "wheel-pause.json"), "utf8"));
      on = Date.now() - p.at < 60000;
    } catch (e) {}
    if (on !== paused) {
      paused = on;
      sendHotkey();
    }
  }

  // the settings window saved: send the new wheel
  function reload(force) {
    var t = W.mtime();
    if (!force && t === cfgTime) { return; }
    cfgTime = t;
    cfg = W.load();
    sendConfig();
    writeStatus();
  }

  window.MF = window.MF || {};
  window.MF.wheel = {
    open: function () { send("show"); },
    openSettings: openSettings,
    state: function () { return { helper: helperState, label: cfg ? cfg.hotkey.label : "" }; }
  };

  var open = $("wheel-open");
  if (open) { open.addEventListener("click", openSettings); }

  reload(true);
  start();
  // the status file doubles as a heartbeat, so the settings window knows
  // this panel is open
  setInterval(function () {
    sendTheme(false);
    checkPause();
    reload(false);
    ticks += 1;
    if (ticks % 12 === 0) { writeStatus(); }
  }, 750);
  window.addEventListener("unload", function () { send("quit"); });
}());
