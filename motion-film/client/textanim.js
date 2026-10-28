/*
 * Mótion Film -- Text Animation tab: letter-by-letter entrances.
 *
 * Pick a style (Rise, Drop, From Left, Fade, Scale Up, Blur In), tune
 * Amount (Rise / Drop / From Left only), Delay between letters, Duration
 * and Blur, watch the live preview, Apply to the selected text layers.
 * Every letter eases out (cubic) from its own start, (index x delay)
 * after the one before -- the same math host/textanim.jsx writes into
 * the layer, where the four values stay as sliders (Effect Controls ›
 * MF Text) so they can be tuned without applying again.
 *
 * The preview text follows the selected text layer until you type your
 * own. Settings live under "motionfilm-textanim" (mirrored to
 * settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("page-textanim")) { return; }

  var KEY = "motionfilm-textanim";
  var DEFAULTS = { style: "rise", amount: 40, delay: 0.04, duration: 0.7, blur: 5, sample: "" };
  var STYLES = { rise: 1, drop: 1, left: 1, fade: 1, scale: 1, blur: 1 };
  var MOVES = { rise: true, drop: true, left: true }; // the styles that use Amount
  var state = {};
  var k;
  for (k in DEFAULTS) { state[k] = DEFAULTS[k]; }
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (STYLES[saved.style]) { state.style = saved.style; }
    ["amount", "delay", "duration", "blur"].forEach(function (n) { if (typeof saved[n] === "number") { state[n] = saved[n]; } });
    if (typeof saved.sample === "string") { state.sample = saved.sample; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  var layerText = ""; // the selected text layer's text, when there is one

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
    var path = extensionDir() + "/host/textanim.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof taApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Text Animation script in After Effects." }); }
    });
  }

  // ------------------------------------------------------------------ preview

  function previewText() {
    return state.sample || layerText || "Mótion Film";
  }

  function fromFrame(style) {
    var f = { opacity: 0, filter: "blur(" + (style === "blur" ? state.blur * 3.6 : state.blur) + "px)", transform: "translate(0px, 0px) scale(1)" };
    if (style === "rise") { f.transform = "translate(0px, " + state.amount + "px) scale(1)"; }
    if (style === "drop") { f.transform = "translate(0px, " + (-state.amount) + "px) scale(1)"; }
    if (style === "left") { f.transform = "translate(" + (-state.amount) + "px, 0px) scale(1)"; }
    if (style === "scale") { f.transform = "translate(0px, 0px) scale(0)"; }
    return f;
  }

  var animations = [];
  function play() {
    var host = $("ta-text");
    animations.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    animations = [];
    host.innerHTML = "";
    var text = previewText().replace(/\r\n?/g, "\n").split("\n")[0];
    var from = fromFrame(state.style);
    var to = { opacity: 1, filter: "blur(0px)", transform: "translate(0px, 0px) scale(1)" };
    var n = 0; // letters only, like AE's "Characters Excluding Spaces"
    for (var i = 0; i < text.length; i += 1) {
      var span = document.createElement("span");
      span.textContent = text.charAt(i);
      host.appendChild(span);
      if (/\s/.test(text.charAt(i))) { continue; }
      if (span.animate) {
        animations.push(span.animate([from, to], {
          duration: state.duration * 1000,
          delay: n * state.delay * 1000,
          easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
          fill: "both"
        }));
      }
      n += 1;
    }
    fitText();
  }

  // big, but always inside the stage
  function fitText() {
    var stage = $("ta-stage");
    var host = $("ta-text");
    host.style.fontSize = "34px";
    var w = host.scrollWidth || 1;
    var room = stage.clientWidth * 0.86;
    if (w > room && room > 0) { host.style.fontSize = Math.max(12, 34 * room / w).toFixed(1) + "px"; }
  }

  var replayTimer = null;
  function replaySoon() {
    clearTimeout(replayTimer);
    replayTimer = setTimeout(play, 120);
  }

  // ------------------------------------------------------------------ controls

  var FORMAT = {
    amount: function (v) { return Math.round(v) + " px"; },
    delay: function (v) { return (Math.round(v * 1000) / 1000) + " s"; },
    duration: function (v) { return (Math.round(v * 100) / 100) + " s"; },
    blur: function (v) { return Math.round(v) + " px"; }
  };

  function render() {
    Array.prototype.forEach.call(document.querySelectorAll("#ta-styles button"), function (b) {
      var on = b.getAttribute("data-style") === state.style;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("ta-amount-row").hidden = !MOVES[state.style];
    ["amount", "delay", "duration", "blur"].forEach(function (n) {
      $("ta-" + n).value = state[n];
      $("ta-out-" + n).textContent = FORMAT[n](state[n]);
    });
    var input = $("ta-sample");
    if (document.activeElement !== input) { input.value = state.sample || layerText || ""; }
    input.placeholder = layerText ? layerText : "Mótion Film";
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("#ta-styles button"), function (b) {
      b.addEventListener("click", function () {
        state.style = b.getAttribute("data-style");
        save();
        render();
        play();
      });
    });
    ["amount", "delay", "duration", "blur"].forEach(function (n) {
      var input = $("ta-" + n);
      input.addEventListener("input", function () {
        state[n] = parseFloat(input.value);
        $("ta-out-" + n).textContent = FORMAT[n](state[n]);
        replaySoon();
      });
      input.addEventListener("change", save);
    });
    var sample = $("ta-sample");
    // typing sets your own preview text; clearing it goes back to the layer's
    sample.addEventListener("input", function () {
      state.sample = sample.value === layerText ? "" : sample.value;
      save();
      replaySoon();
    });
    $("ta-replay").addEventListener("click", play);
    $("ta-apply").addEventListener("click", function () {
      var button = $("ta-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      call("taApply", { style: state.style, amount: state.amount, delay: state.delay, duration: state.duration, blur: state.blur }, function (res) {
        button.disabled = false;
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    $("ta-remove").addEventListener("click", function () {
      call("taRemove", undefined, function (res) {
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
    window.addEventListener("resize", fitText);
    var tab = $("page-tab-textanim");
    if (tab) { tab.addEventListener("click", function () { setTimeout(function () { poll(); play(); }, 30); }); }
  }

  // ------------------------------------------------------------------ selection

  var polling = false;
  function poll() {
    if (polling || $("page-textanim").hidden || !window.__adobe_cep__) { return; }
    polling = true;
    call("taState", undefined, function (res) {
      polling = false;
      if (!res || !res.ok) { return; }
      var t = res.count > 0 ? String(res.text || "").replace(/\r/g, " ") : "";
      if (t !== layerText) {
        layerText = t;
        render();
        if (!state.sample) { play(); }
      }
    });
  }

  // for the Wheel: apply with the current settings
  window.MF = window.MF || {};
  window.MF.textanim = {
    run: function (callback) {
      call("taApply", { style: state.style, amount: state.amount, delay: state.delay, duration: state.duration, blur: state.blur }, callback);
    }
  };

  bind();
  render();
  play();
  setInterval(poll, 1500);
}());
