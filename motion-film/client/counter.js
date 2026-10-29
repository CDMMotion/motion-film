/*
 * Mótion Film -- Text Animation tab › 02 / COUNTER.
 *
 * A number counting From -> To over Duration (cubic ease-out), with an
 * optional currency ($, € or R$). The preview counts the same way
 * host/counter.jsx keys it in AE (two keyframes, so the speed can be
 * reshaped in the Graph Editor): on the selected text layers, or a new
 * one in the middle of the comp when none is selected. Settings live under
 * "motionfilm-counter" (mirrored to settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("ct-stage")) { return; }

  var KEY = "motionfilm-counter";
  var CURRENCY = {
    none: { prefix: "", sep: "," },
    usd: { prefix: "$", sep: "," },
    eur: { prefix: "€", sep: "," },
    brl: { prefix: "R$ ", sep: "." }
  };
  var state = { from: 0, to: 1000, currency: "none", duration: 2 };
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (typeof saved.from === "number") { state.from = saved.from; }
    if (typeof saved.to === "number") { state.to = saved.to; }
    if (CURRENCY[saved.currency]) { state.currency = saved.currency; }
    if (typeof saved.duration === "number") { state.duration = saved.duration; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  function format(n) {
    var c = CURRENCY[state.currency];
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, c.sep);
    return (n < 0 ? "-" : "") + c.prefix + s;
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
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(extensionDir() + "/host/counter.jsx") + "); typeof ctApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Counter script in After Effects." }); }
    });
  }

  // ------------------------------------------------------------------ preview

  var start = 0;
  var raf = 0;
  function tick(now) {
    if (!start) { start = now; }
    var t = Math.min(1, (now - start) / (state.duration * 1000));
    $("ct-num").textContent = format(Math.round(state.from + (state.to - state.from) * (1 - Math.pow(1 - t, 3))));
    fit();
    raf = t < 1 ? window.requestAnimationFrame(tick) : 0;
  }
  function play() {
    if (raf) { window.cancelAnimationFrame(raf); }
    start = 0;
    raf = window.requestAnimationFrame(tick);
  }
  function fit() {
    var stage = $("ct-stage"), num = $("ct-num");
    num.style.fontSize = "44px";
    var k = Math.min(1, (stage.clientWidth * 0.86) / (num.scrollWidth || 1));
    if (k < 1) { num.style.fontSize = Math.max(14, 44 * k).toFixed(1) + "px"; }
  }

  // ------------------------------------------------------------------ controls

  function render() {
    ["from", "to"].forEach(function (n) {
      var input = $("ct-" + n);
      if (document.activeElement !== input) { input.value = state[n]; }
    });
    Array.prototype.forEach.call(document.querySelectorAll("#ct-currency button"), function (b) {
      var on = b.getAttribute("data-currency") === state.currency;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("ct-duration").value = state.duration;
    $("ct-out-duration").textContent = (Math.round(state.duration * 10) / 10) + " s";
  }

  function bind() {
    ["from", "to"].forEach(function (n) {
      var input = $("ct-" + n);
      input.addEventListener("input", function () {
        var v = parseFloat(String(input.value).replace(/[^\d.-]/g, ""));
        if (!isFinite(v)) { return; }
        state[n] = Math.max(-1000000, Math.min(1000000, Math.round(v)));
        save();
        play();
      });
      input.addEventListener("change", render);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#ct-currency button"), function (b) {
      b.addEventListener("click", function () {
        state.currency = b.getAttribute("data-currency");
        save();
        render();
        play();
      });
    });
    $("ct-duration").addEventListener("input", function () {
      state.duration = parseFloat($("ct-duration").value);
      render();
    });
    $("ct-duration").addEventListener("change", function () { save(); play(); });
    $("ct-replay").addEventListener("click", play);
    $("ct-apply").addEventListener("click", function () {
      var button = $("ct-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      call("ctApply", { from: state.from, to: state.to, currency: state.currency, duration: state.duration }, function (res) {
        button.disabled = false;
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    $("ct-remove").addEventListener("click", function () {
      call("ctRemove", undefined, function (res) {
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    var tab = $("page-tab-textanim");
    if (tab) { tab.addEventListener("click", function () { setTimeout(play, 60); }); }
    window.addEventListener("resize", fit);
  }

  bind();
  render();
  play();
}());
