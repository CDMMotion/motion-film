/*
 * Mótion Film -- Text Animation tab › 03 / TYPEWRITER.
 *
 * The text typed out by letter, word or line (Linear or Ease), timed by
 * the length of the text -- there's no Duration here, it's retimed by
 * moving the Progress keyframes in the timeline -- with an optional cursor ( | █ _ ) that stays solid while typing
 * and blinks when it stops (Hide cursor = gone when done), and an optional
 * Erase after a wait. The preview cuts the text and blinks the cursor by
 * the same rules as the expressions host/typewriter.jsx writes. Preview
 * text = the one of 01 Text Animation (typed, or the selected layer's).
 * Settings live under "motionfilm-typewriter" (mirrored to settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("tw-stage")) { return; }

  var KEY = "motionfilm-typewriter";
  var CURSORS = { none: "", bar: "|", block: "█", line: "_" };
  var state = { by: "letter", ease: false, cursor: "bar", blink: 2, hideAtEnd: false, erase: false, hold: 1 };
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (saved.by === "letter" || saved.by === "word" || saved.by === "line") { state.by = saved.by; }
    if (CURSORS.hasOwnProperty(saved.cursor)) { state.cursor = saved.cursor; }
    ["blink", "hold"].forEach(function (n) { if (typeof saved[n] === "number") { state[n] = saved[n]; } });
    ["ease", "hideAtEnd", "erase"].forEach(function (n) { if (typeof saved[n] === "boolean") { state[n] = saved[n]; } });
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  // ------------------------------------------------------------------ host

  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }
  var hostLoaded = false;
  function call(name, arg, callback) {
    if (!window.__adobe_cep__) { callback({ ok: false, error: "This panel must run inside After Effects." }); return; }
    function run() {
      window.__adobe_cep__.evalScript(name + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (hostLoaded) { run(); return; }
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(extensionDir() + "/host/typewriter.jsx") + "); typeof twApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Typewriter script in After Effects." }); }
    });
  }

  // ------------------------------------------------------------------ preview (same rules as the expressions)

  function previewText() {
    var input = $("ta-sample");
    var t = input ? (input.value || input.placeholder) : "";
    t = (t && t !== "Mótion Film" ? t : "Type it out, one key at a time").replace(/\r\n?/g, "\n");
    return t.split("\n").slice(0, 3).join("\n");
  }

  function cut(full, p) {
    if (state.by === "word") {
      var parts = full.match(/\s+|\S+\s*/g) || [];
      var words = 0;
      parts.forEach(function (x) { if (/\S/.test(x)) { words += 1; } });
      var want = Math.floor(words * p + 1e-6), shown = "", got = 0;
      for (var j = 0; j < parts.length && got < want; j += 1) { shown += parts[j]; if (/\S/.test(parts[j])) { got += 1; } }
      return shown;
    }
    if (state.by === "line") {
      var lines = full.split("\n");
      return lines.slice(0, Math.floor(lines.length * p + 1e-6)).join("\n");
    }
    return full.substr(0, Math.floor(full.length * p + 1e-6));
  }

  // how long the typing takes (same rule as autoDuration in the host)
  function duration() {
    var n, step;
    if (state.by === "word") { n = (full.match(/\S+/g) || []).length; step = 0.3; }
    else if (state.by === "line") { n = full.split("\n").length; step = 0.6; }
    else { n = full.length; step = 0.06; }
    return Math.min(4, Math.max(0.4, n * step));
  }

  // Progress (0..1) at t, like the keyframes: type, wait, erase
  function progress(t) {
    var d = duration();
    function shape(x) { x = Math.min(1, Math.max(0, x)); return state.ease ? x * x * (3 - 2 * x) : x; }
    if (t <= d) { return shape(t / d); }
    if (!state.erase) { return 1; }
    if (t <= d + state.hold) { return 1; }
    return 1 - shape((t - d - state.hold) / (d * 0.6));
  }
  function lastKey() { var d = duration(); return d + (state.erase ? state.hold + d * 0.6 : 0); }

  var start = 0;
  var full = "";
  function frame(now) {
    if (!start) { start = now; }
    var t = (now - start) / 1000;
    var dt = 1 / 30;
    var p = progress(t);
    var typing = Math.abs(p - progress(t - dt)) > 0.00001;
    var host = $("tw-text");
    var shown = cut(full, p);
    var c = CURSORS[state.cursor];
    var on = typing || Math.floor(t * state.blink * 2) % 2 === 0;
    if (state.hideAtEnd && t > lastKey() + 0.4) { on = false; }
    host.textContent = shown;
    if (c) {
      var span = document.createElement("span");
      span.className = "tw-cursor" + (on ? "" : " is-off");
      span.textContent = c;
      host.appendChild(span);
    }
    // the loop starts over a little after the end
    if (t > lastKey() + 2.5) { start = now; }
    if (!$("page-textanim").hidden) { window.requestAnimationFrame(frame); } else { running = false; }
  }
  var running = false;
  function play() {
    full = previewText();
    start = 0;
    fit();
    if (!running) { running = true; window.requestAnimationFrame(frame); }
  }
  function fit() {
    var stage = $("tw-stage"), host = $("tw-text");
    host.textContent = full + "|";
    host.style.fontSize = "26px";
    var k = Math.min(1, (stage.clientWidth - 36) / (host.scrollWidth || 1), (stage.clientHeight * 0.85) / (host.scrollHeight || 1));
    if (k < 1 && k > 0) { host.style.fontSize = Math.max(11, 26 * k).toFixed(1) + "px"; }
  }

  // ------------------------------------------------------------------ controls

  function seg(id, attr, isOn) {
    Array.prototype.forEach.call(document.querySelectorAll("#" + id + " button"), function (b) {
      var on = isOn(b.getAttribute(attr));
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function render() {
    seg("tw-by", "data-by", function (v) { return v === state.by; });
    seg("tw-ease", "data-ease", function (v) { return (v === "on") === state.ease; });
    seg("tw-cursor", "data-cursor", function (v) { return v === state.cursor; });
    seg("tw-hide", "data-hide", function (v) { return (v === "on") === state.hideAtEnd; });
    seg("tw-erase", "data-erase", function (v) { return (v === "on") === state.erase; });
    $("tw-blink").value = state.blink;
    $("tw-out-blink").textContent = state.blink + " / s";
    $("tw-hold").value = state.hold;
    $("tw-out-hold").textContent = (Math.round(state.hold * 10) / 10) + " s";
    var noCursor = state.cursor === "none";
    $("tw-blink-row").hidden = noCursor;
    $("tw-hide-row").hidden = noCursor;
    $("tw-hold-row").hidden = !state.erase;
  }

  function bindSeg(id, attr, set) {
    Array.prototype.forEach.call(document.querySelectorAll("#" + id + " button"), function (b) {
      b.addEventListener("click", function () {
        set(b.getAttribute(attr));
        save();
        render();
        play();
      });
    });
  }

  function bind() {
    bindSeg("tw-by", "data-by", function (v) { state.by = v; });
    bindSeg("tw-ease", "data-ease", function (v) { state.ease = v === "on"; });
    bindSeg("tw-cursor", "data-cursor", function (v) { state.cursor = v; });
    bindSeg("tw-hide", "data-hide", function (v) { state.hideAtEnd = v === "on"; });
    bindSeg("tw-erase", "data-erase", function (v) { state.erase = v === "on"; });
    ["blink", "hold"].forEach(function (n) {
      var input = $("tw-" + n);
      input.addEventListener("input", function () {
        state[n] = parseFloat(input.value);
        render();
      });
      input.addEventListener("change", function () { save(); play(); });
    });
    var sample = $("ta-sample");
    if (sample) { sample.addEventListener("input", function () { setTimeout(play, 150); }); }
    $("tw-replay").addEventListener("click", play);
    $("tw-apply").addEventListener("click", function () {
      var button = $("tw-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      call("twApply", state, function (res) {
        button.disabled = false;
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    $("tw-remove").addEventListener("click", function () {
      call("twRemove", undefined, function (res) {
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    var tab = $("page-tab-textanim");
    if (tab) { tab.addEventListener("click", function () { setTimeout(play, 60); }); }
    window.addEventListener("resize", fit);
    // the selected layer's text reaches the 01 field a moment after selecting
    var lastText = "";
    setInterval(function () {
      if ($("page-textanim").hidden) { return; }
      var t = previewText();
      if (t !== lastText) { lastText = t; play(); }
    }, 1500);
  }

  bind();
  render();
  play();
}());
