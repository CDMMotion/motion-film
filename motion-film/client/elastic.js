/*
 * Mótion Film -- Elastic: the shortcut popup (Windows).
 *
 * Starts bin/win/MFHelper.exe (source: installer/helper/MFHelper.cs),
 * which holds the shortcut (default Ctrl + L) while After Effects is in
 * front and shows a small popup at the mouse: Position / Scale /
 * Rotation. A pick comes back here and host/elastic.jsx (loaded with
 * $.evalFile) puts the elastic expression + its sliders on the selected
 * layers. Lines in / out: see MFHelper.cs.
 *
 * Tools › 04 / ELASTIC: the same three buttons, the shortcut (click the
 * field, press the keys) and on / off, with a line saying how to use it.
 * Saved in "motionfilm-elastic" (mirrored to settings.json).
 * The helper lives as long as this panel: it quits when its stdin
 * closes. Later: favorite speed curves in the same popup.
 */
(function () {
  "use strict";

  var KEY = "motionfilm-elastic";
  var DEFAULT = { enabled: true, mods: 2, vk: 76, label: "Ctrl + L" };
  var state = { enabled: DEFAULT.enabled, mods: DEFAULT.mods, vk: DEFAULT.vk, label: DEFAULT.label };
  var helper = null;
  var helperState = "off"; // off | starting | ok | busy | missing | error | mac
  var starts = [];
  var buf = "";
  var lastTheme = "";
  var hostLoaded = false;

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (typeof saved.enabled === "boolean") { state.enabled = saved.enabled; }
    if (saved.vk > 0) { state.mods = saved.mods | 0; state.vk = saved.vk | 0; state.label = String(saved.label || ""); }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
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

  // ------------------------------------------------------------------ host

  function callHost(name, arg, callback) {
    function run() {
      window.__adobe_cep__.evalScript(name + "(" + JSON.stringify(arg) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (hostLoaded) { run(); return; }
    var path = extensionDir() + "/host/elastic.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof mfElastic", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Elastic script in After Effects." }); }
    });
  }

  function pick(kind) {
    callHost("mfElastic", kind, function (res) {
      send(res.ok ? "done " + res.message : "error " + (res.error || "Couldn't apply."));
      status(res.ok ? res.message + "." : res.error, res.ok ? "success" : "error");
    });
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

  function sendHotkey() {
    send(state.enabled ? "hotkey " + state.mods + " " + state.vk : "hotkey off");
  }

  function onLine(line) {
    var parts = line.split(" ");
    if (parts[0] === "ready") {
      helperState = "starting";
      sendTheme(true);
      sendHotkey();
    } else if (parts[0] === "hotkey") {
      helperState = parts[1] === "ok" ? "ok" : (parts[1] === "busy" ? "busy" : "off");
    } else if (parts[0] === "pick") {
      pick(parts[1]);
    }
    render();
  }

  function start() {
    if (helper || !state.enabled) { return; }
    if (!/^Win/i.test(navigator.platform)) { helperState = "mac"; render(); return; }
    var fs, cp;
    try { fs = nodeRequire("fs"); cp = nodeRequire("child_process"); } catch (e) { return; }
    var exe = extensionDir() + "/bin/win/MFHelper.exe";
    if (!fs.existsSync(exe)) { helperState = "missing"; render(); return; }
    var now = Date.now();
    starts = starts.filter(function (t) { return now - t < 60000; });
    if (starts.length >= 3) { helperState = "error"; render(); return; }
    starts.push(now);
    try {
      helper = cp.spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      helper = null;
      helperState = "error";
      render();
      return;
    }
    helperState = "starting";
    buf = "";
    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", function (d) {
      buf += d;
      var i;
      while ((i = buf.indexOf("\n")) >= 0) {
        var line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) { onLine(line); }
      }
    });
    helper.on("error", function () {});
    helper.on("exit", function () {
      helper = null;
      helperState = state.enabled ? "starting" : "off";
      render();
      if (state.enabled) { setTimeout(start, 1000); }
    });
    render();
  }

  function stop() {
    if (!helper) { return; }
    var h = helper;
    send("quit");
    setTimeout(function () { try { h.kill(); } catch (e) {} }, 1500);
  }

  // ------------------------------------------------------------------ settings

  function render() {
    var toggle = $("elastic-toggle");
    var field = $("elastic-hotkey");
    var note = $("elastic-note");
    if (!toggle || !field || !note) { return; }
    toggle.setAttribute("aria-checked", state.enabled ? "true" : "false");
    if (!field.classList.contains("is-capturing")) { field.value = state.label; }
    field.disabled = !state.enabled;
    var text = "";
    if (!state.enabled) {
      text = "Shortcut off -- the buttons above still work.";
    } else if (helperState === "ok") {
      text = "Press " + state.label + " with After Effects in front: the Elastic popup opens at the mouse (1-3 picks). Animate with 2+ keyframes and a fast arrival. Click the field to change the keys.";
    } else if (helperState === "busy") {
      text = state.label + " is already taken by another program (e.g. Afterflix Velocity) -- click the field and press another shortcut.";
    } else if (helperState === "missing") {
      text = "The shortcut program is missing -- reinstall Mótion Film. The buttons above still work.";
    } else if (helperState === "mac") {
      text = "The shortcut is Windows-only for now -- the buttons above work.";
    } else if (helperState === "error") {
      text = "The shortcut program stopped several times -- close and reopen the panel.";
    } else {
      text = "Starting the shortcut…";
    }
    note.textContent = text;
    note.classList.toggle("is-warn", helperState === "busy" || helperState === "missing" || helperState === "error");
  }

  var MOD_NAMES = { 17: 1, 16: 1, 18: 1, 91: 1, 92: 1 };

  function bindSettings() {
    var toggle = $("elastic-toggle");
    var field = $("elastic-hotkey");
    if (!toggle || !field) { return; }
    // the same three options as the popup, straight from the panel
    Array.prototype.forEach.call(document.querySelectorAll("[data-elastic]"), function (b) {
      b.addEventListener("click", function () {
        if (!window.__adobe_cep__) { return; }
        b.disabled = true;
        callHost("mfElastic", b.getAttribute("data-elastic"), function (res) {
          b.disabled = false;
          status(res.ok ? res.message + "." : res.error, res.ok ? "success" : "error");
        });
      });
    });
    toggle.addEventListener("click", function () {
      state.enabled = !state.enabled;
      save();
      if (state.enabled) { if (helper) { sendHotkey(); } else { starts = []; start(); } } else { send("hotkey off"); stop(); }
      render();
    });
    // click the field, then press the shortcut (a modifier + a key)
    field.addEventListener("focus", function () {
      field.classList.add("is-capturing");
      field.value = "Press the keys…";
    });
    field.addEventListener("blur", function () {
      field.classList.remove("is-capturing");
      render();
    });
    field.addEventListener("keydown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.keyCode === 27) { field.blur(); return; }
      if (MOD_NAMES[e.keyCode]) { return; }
      var mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
      var isF = e.keyCode >= 112 && e.keyCode <= 123;
      if (!mods && !isF) { field.value = "Ctrl, Alt or Shift + a key"; return; }
      var names = [];
      if (e.ctrlKey) { names.push("Ctrl"); }
      if (e.altKey) { names.push("Alt"); }
      if (e.shiftKey) { names.push("Shift"); }
      var keyName = isF ? "F" + (e.keyCode - 111) : (e.key && e.key.length === 1 ? e.key.toUpperCase() : String.fromCharCode(e.keyCode));
      names.push(keyName);
      state.mods = mods;
      state.vk = e.keyCode;
      state.label = names.join(" + ");
      save();
      helperState = "starting";
      sendHotkey();
      field.blur();
      field.classList.remove("is-capturing");
      render();
    });
  }

  // ------------------------------------------------------------------ start

  // for other scripts of this window (a button that opens the popup)
  window.MF = window.MF || {};
  window.MF.elastic = {
    open: function () { send("show"); },
    state: function () { return { helper: helperState, enabled: state.enabled, label: state.label }; }
  };

  bindSettings();
  render();
  start();
  setInterval(function () { sendTheme(false); }, 2000);
  window.addEventListener("unload", function () { send("quit"); });
}());
