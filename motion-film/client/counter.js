/*
 * Mótion Film -- Text Animation tab › 02 / COUNTER.
 *
 * A number counting From -> To over Duration (cubic ease-out), with an
 * optional currency ($, € or R$), a Format (1.000,00 = dots first, or
 * 1,000.00 = commas first) and the Decimals chosen (0..4; typing more
 * decimals than that raises it). A typed separator is read by sense: a
 * lone one followed by other than 3 digits is the decimal point, both
 * together = the last one is the decimal. The preview counts the same way
 * host/counter.jsx keys it in AE (two keyframes, so the speed can be
 * reshaped in the Graph Editor): on the selected text layers, or a new
 * one in the middle of the comp when none is selected. Settings live under
 * "motionfilm-counter" (mirrored to settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("ct-stage")) { return; }

  var KEY = "motionfilm-counter";
  // the currency picks its usual format (it can be changed after)
  var CURRENCY = {
    none: { prefix: "" },
    usd: { prefix: "$", format: "comma" },
    eur: { prefix: "€" },
    brl: { prefix: "R$ ", format: "dot" }
  };
  // dot = 1.000,00 (dots first), comma = 1,000.00 (commas first)
  var FORMATS = { dot: { thousands: ".", decimal: "," }, comma: { thousands: ",", decimal: "." } };
  var state = { from: 0, to: 1000, decimals: 0, currency: "none", format: "dot", duration: 2 };
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (typeof saved.from === "number") { state.from = saved.from; }
    if (typeof saved.to === "number") { state.to = saved.to; }
    if (typeof saved.decimals === "number") { state.decimals = Math.max(0, Math.min(4, saved.decimals)); }
    if (CURRENCY[saved.currency]) { state.currency = saved.currency; }
    if (FORMATS[saved.format]) { state.format = saved.format; } else if (saved.decimal === ".") { state.format = "comma"; }
    if (typeof saved.duration === "number") { state.duration = saved.duration; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  // n with the chosen separators and decimals; same as the expression
  function plain(n) {
    var f = FORMATS[state.format];
    var parts = Math.abs(n).toFixed(state.decimals).split(".");
    var s = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, f.thousands);
    return (n < 0 && Number(Math.abs(n).toFixed(state.decimals)) !== 0 ? "-" : "") + s + (parts[1] ? f.decimal + parts[1] : "");
  }
  function format(n) {
    var s = plain(n);
    var neg = s.charAt(0) === "-";
    return (neg ? "-" : "") + CURRENCY[state.currency].prefix + (neg ? s.slice(1) : s);
  }

  // what the user typed -> { value, places } (null when it isn't a number)
  function parse(text) {
    var s = String(text).replace(/[^\d.,-]/g, "");
    var neg = s.charAt(0) === "-";
    s = s.replace(/-/g, "");
    if (!/\d/.test(s)) { return null; }
    var dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
    var dec = -1;
    if (dot >= 0 && comma >= 0) {
      dec = Math.max(dot, comma); // both: the last one is the decimal
    } else if (dot >= 0 || comma >= 0) {
      var ch = dot >= 0 ? "." : ",", at = Math.max(dot, comma);
      var once = s.indexOf(ch) === at;
      var after = s.length - at - 1;
      // one separator: decimal unless it reads as thousands (3 digits after, and it's
      // the thousands mark chosen here, or it repeats)
      if (once && !(after === 3 && ch === FORMATS[state.format].thousands)) { dec = at; }
    }
    var whole = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, "");
    var frac = dec >= 0 ? s.slice(dec + 1).replace(/[.,]/g, "").slice(0, 4) : "";
    var v = Number((whole || "0") + (frac ? "." + frac : ""));
    if (!isFinite(v)) { return null; }
    return { value: Math.max(-1000000, Math.min(1000000, neg ? -v : v)), places: frac.length };
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
    $("ct-num").textContent = format(state.from + (state.to - state.from) * (1 - Math.pow(1 - t, 3)));
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
      if (document.activeElement !== input) { input.value = plain(state[n]); }
    });
    [["ct-currency", "data-currency", "currency"], ["ct-format", "data-format", "format"], ["ct-decimals", "data-decimals", "decimals"]].forEach(function (g) {
      Array.prototype.forEach.call(document.querySelectorAll("#" + g[0] + " button"), function (b) {
        var on = b.getAttribute(g[1]) === String(state[g[2]]);
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
    $("ct-duration").value = state.duration;
    $("ct-out-duration").textContent = (Math.round(state.duration * 10) / 10) + " s";
  }

  function bind() {
    ["from", "to"].forEach(function (n) {
      var input = $("ct-" + n);
      input.addEventListener("input", function () {
        var p = parse(input.value);
        if (!p) { return; }
        state[n] = p.value;
        // more decimals typed than chosen: show them
        if (p.places > state.decimals) { state.decimals = p.places; render(); }
        save();
        play();
      });
      input.addEventListener("change", render);
    });
    function choose(id, attr, fn) {
      Array.prototype.forEach.call(document.querySelectorAll("#" + id + " button"), function (b) {
        b.addEventListener("click", function () {
          fn(b.getAttribute(attr));
          save();
          render();
          play();
        });
      });
    }
    choose("ct-currency", "data-currency", function (v) {
      state.currency = v;
      if (CURRENCY[v].format) { state.format = CURRENCY[v].format; }
    });
    choose("ct-format", "data-format", function (v) { state.format = v; });
    choose("ct-decimals", "data-decimals", function (v) { state.decimals = Number(v); });
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
      call("ctApply", { from: state.from, to: state.to, decimals: state.decimals, currency: state.currency, format: state.format, duration: state.duration }, function (res) {
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
