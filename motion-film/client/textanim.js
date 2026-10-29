/*
 * Mótion Film -- Text Animation tab: entrances letter by letter, word by
 * word or line by line.
 *
 * Three boxes on top: the style (a list: Rise, Drop, From Left / Right,
 * Fade, Scale Up, Zoom Out, Blur In, Rotate In, Tracking In -- hovering
 * one previews it), what comes in one after the other (Letters / Words /
 * Lines) and a Bounce switch. Then tune Amount (the moves and Tracking In only), Delay
 * between the units, Duration and Blur, watch the live preview, Apply to
 * the selected text layers. Every unit eases out (cubic) from its own
 * start, (index x delay) after the one before -- the same math
 * host/textanim.jsx writes into
 * the layer, where the four values stay as sliders (Effect Controls ›
 * MF Text) so they can be tuned without applying again.
 *
 * The preview shows the selected text layer's text (click it, or its ↻,
 * to play it again). Settings live under "motionfilm-textanim" (mirrored to
 * settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("page-textanim")) { return; }

  var KEY = "motionfilm-textanim";
  var DEFAULTS = { by: "letter", style: "rise", amount: 40, delay: 0.04, duration: 0.7, blur: 5, bounce: false };
  var STYLES = { rise: 1, drop: 1, left: 1, right: 1, fade: 1, scale: 1, zoomout: 1, blur: 1, rotate: 1, tracking: 1 };
  var BY = { letter: "letters", word: "words", line: "lines" };
  var MOVES = { rise: true, drop: true, left: true, right: true, tracking: true }; // the styles that use Amount
  var state = {};
  var k;
  for (k in DEFAULTS) { state[k] = DEFAULTS[k]; }
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (STYLES[saved.style]) { state.style = saved.style; }
    if (BY[saved.by]) { state.by = saved.by; }
    ["amount", "delay", "duration", "blur"].forEach(function (n) { if (typeof saved[n] === "number") { state[n] = saved[n]; } });
    if (typeof saved.bounce === "boolean") { state.bounce = saved.bounce; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  var layerText = ""; // the selected text layer's text, when there is one
  var layerCount = 0; // selected text layers

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

  // up to 3 lines (the typed text is one line; a layer can have more)
  function previewText() {
    var t = layerText || (state.by === "line" ? "Mótion Film\nText Animation" : "Mótion Film");
    return t.replace(/\r\n?/g, "\n").split("\n").slice(0, 3).join("\n");
  }

  function settings() {
    return { by: state.by, style: state.style, amount: state.amount, delay: state.delay, duration: state.duration, blur: state.blur, bounce: state.bounce };
  }

  // where unit i of n starts from (tracking spreads the units apart);
  // k scales the distances down for small previews
  function startOf(o, i, n, k) {
    var x = 0, y = 0, sc = 1, r = 0, a = o.amount * k, style = o.style;
    if (style === "rise") { y = a; }
    if (style === "drop") { y = -a; }
    if (style === "left") { x = -a; }
    if (style === "right") { x = a; }
    if (style === "scale") { sc = 0; }
    if (style === "zoomout") { sc = 2.5; }
    if (style === "rotate") { r = -90; }
    if (style === "tracking") { x = (i - (n - 1) / 2) * a * 0.35; }
    return { x: x, y: y, sc: sc, r: r, blur: (style === "blur" ? o.blur * 3.6 : o.blur) * k };
  }

  // the frame at progress e (0 = start, 1 = in place; past 1 = overshoot),
  // the same mix AE's animator does with the selector at 100 * (1 - e)
  function frameAt(p, e) {
    var a = 1 - e;
    return {
      opacity: Math.max(0, Math.min(1, e)),
      filter: "blur(" + Math.max(0, p.blur * a).toFixed(2) + "px)",
      transform: "translate(" + (p.x * a).toFixed(2) + "px, " + (p.y * a).toFixed(2) + "px) scale(" + Math.max(0, 1 + (p.sc - 1) * a).toFixed(4) + ") rotate(" + (p.r * a).toFixed(2) + "deg)"
    };
  }

  // Bounce: the elastic swing of host/textanim.jsx, as keyframes
  function elastic(t) { return t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(5 * Math.PI * t); }

  // Fills host with text animated by settings o (also used by the
  // favorites' tiles); returns the animations.
  function animateInto(host, text, o, k) {
    var list = [];
    host.innerHTML = "";
    // the units counted like AE's "Based On": letters without spaces,
    // words across all lines, or lines
    var units = [];
    function animate(el) { units.push(el); }
    text.split("\n").forEach(function (lineText) {
      var line = document.createElement("div");
      line.className = "ta-line";
      host.appendChild(line);
      if (o.by === "line") {
        line.textContent = lineText || " ";
        if (/\S/.test(lineText)) { animate(line); }
        return;
      }
      var parts = o.by === "word" ? lineText.split(/(\s+)/) : lineText.split("");
      parts.forEach(function (part) {
        if (!part) { return; }
        var span = document.createElement("span");
        span.textContent = part;
        line.appendChild(span);
        if (/\S/.test(part)) { animate(span); }
      });
    });
    units.forEach(function (el, i) {
      if (!el.animate) { return; }
      var p = startOf(o, i, units.length, k || 1);
      var frames = [frameAt(p, 0), frameAt(p, 1)];
      if (o.bounce) {
        frames = [];
        for (var f = 0; f <= 40; f += 1) { frames.push(frameAt(p, elastic(f / 40))); }
      }
      list.push(el.animate(frames, {
        duration: o.duration * 1000,
        delay: i * o.delay * 1000,
        easing: o.bounce ? "linear" : "cubic-bezier(0.215, 0.61, 0.355, 1)",
        fill: "both"
      }));
    });
    return list;
  }

  var animations = [];
  function play() {
    animations.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    var o = settings();
    if (hoverStyle) { o.style = hoverStyle; }
    animations = animateInto($("ta-text"), previewText(), o, 1);
    fitText();
  }

  // big, but always inside the stage
  function fitText() {
    var stage = $("ta-stage");
    var host = $("ta-text");
    host.style.fontSize = "34px";
    var k = Math.min(1, (stage.clientWidth * 0.86) / (host.scrollWidth || 1), (stage.clientHeight * 0.8) / (host.scrollHeight || 1));
    if (k < 1 && k > 0) { host.style.fontSize = Math.max(12, 34 * k).toFixed(1) + "px"; }
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
    Array.prototype.forEach.call(document.querySelectorAll("#ta-by button"), function (b) {
      var on = b.getAttribute("data-by") === state.by;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) { $("ta-by-label").textContent = b.textContent; }
    });
    $("ta-delay-name").textContent = "Delay between " + BY[state.by];
    // words and lines want longer gaps than letters
    var maxDelay = state.by === "letter" ? 0.2 : 0.5;
    $("ta-delay").max = maxDelay;
    if (state.delay > maxDelay) { state.delay = maxDelay; }
    Array.prototype.forEach.call(document.querySelectorAll("#ta-styles button"), function (b) {
      var on = b.getAttribute("data-style") === state.style;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) { $("ta-style-label").textContent = b.textContent; }
    });
    $("ta-bounce").classList.toggle("is-on", state.bounce);
    $("ta-bounce").setAttribute("aria-checked", state.bounce ? "true" : "false");
    $("ta-amount-row").hidden = !MOVES[state.style];
    ["amount", "delay", "duration", "blur"].forEach(function (n) {
      $("ta-" + n).value = state[n];
      $("ta-out-" + n).textContent = FORMAT[n](state[n]);
    });
    if (typeof api.onChange === "function") { api.onChange(); }
  }

  // A box that opens its list under it; a pick (or a click outside / Esc)
  // closes it. onHover(value) previews an option, onHover(null) = left.
  var openDrop = null;
  function closeDrop() {
    if (!openDrop) { return; }
    openDrop.menu.hidden = true;
    openDrop.box.setAttribute("aria-expanded", "false");
    openDrop.root.classList.remove("is-open");
    var leave = openDrop.onHover;
    openDrop = null;
    if (leave) { leave(null); }
  }
  function dropdown(rootId, attr, onPick, onHover) {
    var root = $(rootId);
    var box = root.querySelector(".ta-box");
    var menu = root.querySelector(".ta-menu");
    box.addEventListener("click", function (e) {
      e.stopPropagation();
      var was = openDrop && openDrop.root === root;
      closeDrop();
      if (was) { return; }
      openDrop = { root: root, box: box, menu: menu, onHover: onHover };
      menu.hidden = false;
      box.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
    });
    Array.prototype.forEach.call(menu.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var value = b.getAttribute(attr);
        if (openDrop) { openDrop.onHover = null; }
        closeDrop();
        onPick(value);
      });
      if (onHover) {
        b.addEventListener("mouseenter", function () { onHover(b.getAttribute(attr)); });
      }
    });
    if (onHover) { menu.addEventListener("mouseleave", function () { onHover(null); }); }
  }

  var hoverStyle = null; // a style hovered in the list, shown in the preview
  function bind() {
    dropdown("ta-style-drop", "data-style", function (value) {
      hoverStyle = null;
      state.style = value;
      save();
      render();
      play();
    }, function (value) {
      if (value === hoverStyle) { return; }
      hoverStyle = value;
      play();
    });
    dropdown("ta-by-drop", "data-by", function (value) {
      state.by = value;
      save();
      render();
      play();
    });
    $("ta-bounce").addEventListener("click", function () {
      state.bounce = !state.bounce;
      save();
      render();
      play();
    });
    document.addEventListener("click", closeDrop);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeDrop(); } });
    ["amount", "delay", "duration", "blur"].forEach(function (n) {
      var input = $("ta-" + n);
      input.addEventListener("input", function () {
        state[n] = parseFloat(input.value);
        $("ta-out-" + n).textContent = FORMAT[n](state[n]);
        replaySoon();
      });
      input.addEventListener("change", function () { save(); render(); });
    });
    // the ↻ on the preview, or a click anywhere on it, plays it again
    $("ta-stage").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#ta-fav")) { return; }
      play();
    });
    $("ta-apply").addEventListener("click", function () {
      var button = $("ta-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      call("taApply", settings(), function (res) {
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
  // reads the selected text layer: never while the panel is blurred (the
  // user may be typing in that layer -- see MF.panelActive in panel.js)
  function poll(force) {
    if (polling || $("page-textanim").hidden || !window.__adobe_cep__) { return; }
    if (!force && window.MF && window.MF.panelActive && !window.MF.panelActive()) { return; }
    polling = true;
    call("taState", undefined, function (res) {
      polling = false;
      if (!res || !res.ok) { return; }
      layerCount = res.count || 0;
      var t = res.count > 0 ? String(res.text || "").replace(/\r\n?/g, "\n") : "";
      if (t !== layerText) {
        layerText = t;
        render();
        play();
      }
    });
  }

  var NAMES = { rise: "Rise", drop: "Drop", left: "From Left", right: "From Right", fade: "Fade", scale: "Scale Up", zoomout: "Zoom Out", blur: "Blur In", rotate: "Rotate In", tracking: "Tracking In" };

  // the settings o, cleaned (a favorite read from storage, say)
  function clean(o) {
    o = o || {};
    var out = settings();
    if (STYLES[o.style]) { out.style = o.style; }
    if (BY[o.by]) { out.by = o.by; }
    ["amount", "delay", "duration", "blur"].forEach(function (n) { if (typeof o[n] === "number" && isFinite(o[n])) { out[n] = o[n]; } });
    if (typeof o.bounce === "boolean") { out.bounce = o.bounce; }
    return out;
  }

  // for the favorites (textanim-favorites.js) and the Wheel
  var api = {
    run: function (callback) { call("taApply", settings(), callback); },
    get: settings,
    load: function (o) {
      o = clean(o);
      for (var n in o) { state[n] = o[n]; }
      save();
      render();
      play();
    },
    apply: function (o, callback) { call("taApply", clean(o), callback); },
    selected: function () { return layerCount; },
    animateInto: animateInto,
    name: function (o) { return NAMES[o.style] || o.style; },
    by: function (o) { return { letter: "Letter", word: "Word", line: "Line" }[o.by] || ""; },
    onChange: null
  };
  window.MF = window.MF || {};
  window.MF.textanim = api;

  bind();
  render();
  play();
  setInterval(function () { poll(false); }, 1500);
  if (window.MF && window.MF.onPanelBack) { window.MF.onPanelBack(function () { poll(true); }); }
}());
