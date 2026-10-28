/*
 * Mótion Film -- Kit › Transitions: the built-in category at the top of
 * the Kit rail (can't be deleted; panel.js hands its area to
 * MF.transitions.render).
 *
 *   1. six squares, one per group (Principal, Glitch, Film Burn, Camera,
 *      Blur, Shake);
 *   2. a group: a back arrow (one step back), the duration (frames) and,
 *      when the group has them, the direction; then the cards -- hovering
 *      plays the preview, a click applies it to the timeline at once
 *      (host/transitions.jsx: at the cut between 2 selected layers that
 *      touch, otherwise at the time indicator; clicking another card at
 *      the same place swaps it).
 *
 * Catalog: client/transitions-catalog.js. Previews: assets/transitions/
 * <id>.mp4 + .jpg (dev/transitions-lab.jsx). Settings in
 * "motionfilm-transitions" (mirrored to settings.json).
 */
(function () {
  "use strict";

  var CAT = window.MFTransitionsCatalog;
  if (!CAT) { return; }

  var KEY = "motionfilm-transitions";
  var state = { group: "", frames: {}, dir: "right" };
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (saved.frames && typeof saved.frames === "object") { state.frames = saved.frames; }
    if (typeof saved.dir === "string") { state.dir = saved.dir; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ frames: state.frames, dir: state.dir })); } catch (e) {}
  }

  var root = null;
  var info = null; // last mftInfo
  var busy = false;

  var ARROWS = { right: "→", left: "←", up: "↑", down: "↓" };
  var BACK = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';

  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }
  function group(id) {
    for (var i = 0; i < CAT.groups.length; i += 1) { if (CAT.groups[i].id === id) { return CAT.groups[i]; } }
    return null;
  }
  function itemsOf(id) { return CAT.list.filter(function (t) { return t.group === id; }); }
  function framesOf(id) {
    var f = parseInt(state.frames[id], 10);
    return f > 0 ? f : group(id).frames;
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
    var path = extensionDir() + "/host/transitions.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof mftApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Transitions script in After Effects." }); }
    });
  }

  // direction a card really uses: the chosen one when it has it
  function dirFor(t) {
    if (!t.dirs) { return "right"; }
    if (t.dirs.indexOf(state.dir) >= 0) { return state.dir; }
    var horizontal = state.dir === "left" || state.dir === "right";
    for (var i = 0; i < t.dirs.length; i += 1) {
      var h = t.dirs[i] === "left" || t.dirs[i] === "right";
      if (h === horizontal) { return t.dirs[i]; }
    }
    return t.dirs[0];
  }

  function apply(t, card) {
    if (busy) { return; }
    busy = true;
    card.classList.add("is-applying");
    var frames = framesOf(t.group);
    call("mftApply", { id: t.id, name: t.name, frames: frames, dir: dirFor(t) }, function (res) {
      busy = false;
      card.classList.remove("is-applying");
      status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      refreshInfo();
    });
  }

  function refreshInfo() {
    if (!root || !root.isConnected || !window.__adobe_cep__) { return; }
    call("mftInfo", undefined, function (res) {
      if (!res || !res.ok) { return; }
      info = res;
      var el = root.querySelector(".tr-where");
      if (el) { el.textContent = whereText(); }
      var sec = root.querySelector(".tr-seconds");
      if (sec) { sec.textContent = secondsText(); }
    });
  }
  function whereText() {
    if (!info) { return ""; }
    if (!info.comp) { return "Open a composition."; }
    return info.cut ? "Goes on the cut between the 2 selected layers." : "Goes at the time indicator (or select the 2 layers of a cut).";
  }
  function secondsText() {
    if (!state.group) { return ""; }
    var fps = info && info.fps ? info.fps : 30;
    var s = Math.round(framesOf(state.group) / fps * 100) / 100;
    return s + " s at " + Math.round(fps * 100) / 100 + " fps";
  }

  // ------------------------------------------------------------------ media

  function media(id) { return "assets/transitions/" + id; }

  function previewBox(id) {
    var box = document.createElement("span");
    box.className = "tr-preview";
    var img = document.createElement("img");
    img.src = media(id) + ".jpg";
    img.alt = "";
    img.loading = "lazy";
    var video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.setAttribute("playsinline", "");
    // buffered up front (each clip is ~170 KB): starting one that was still
    // loading made Chromium race through the frames it had, then freeze
    video.preload = "auto";
    video.src = media(id) + ".mp4";
    box.appendChild(img);
    box.appendChild(video);
    return { box: box, video: video };
  }
  // plays on hover, and only once the clip can play through
  function bindHover(el, video, box) {
    var hovering = false;
    function start() {
      box.classList.add("is-playing");
      try { video.currentTime = 0; } catch (e) {}
      var p = video.play();
      if (p && typeof p.catch === "function") { p.catch(function () {}); }
    }
    video.addEventListener("canplaythrough", function () {
      if (hovering && video.paused) { start(); }
    });
    el.addEventListener("mouseenter", function () {
      hovering = true;
      if (video.readyState >= 4) { start(); }
    });
    el.addEventListener("mouseleave", function () {
      hovering = false;
      box.classList.remove("is-playing");
      try { video.pause(); } catch (e) {}
    });
  }

  // ------------------------------------------------------------------ views

  function renderGroups() {
    var wrap = document.createElement("div");
    wrap.className = "tr-home";
    var head = document.createElement("div");
    head.className = "tr-head";
    head.innerHTML = '<span class="tr-title">Transitions</span><span class="tr-where"></span>';
    wrap.appendChild(head);
    var grid = document.createElement("div");
    grid.className = "tr-groups";
    CAT.groups.forEach(function (g) {
      var items = itemsOf(g.id);
      var cover = g.cover || items[0].id;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tr-group";
      var pv = previewBox(cover);
      b.appendChild(pv.box);
      var cap = document.createElement("span");
      cap.className = "tr-group-cap";
      cap.innerHTML = '<b></b><small></small>';
      cap.querySelector("b").textContent = g.name;
      cap.querySelector("small").textContent = items.length + " · " + g.hint;
      b.appendChild(cap);
      bindHover(b, pv.video, pv.box);
      b.addEventListener("click", function () { open(g.id); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderGroup(id) {
    var g = group(id);
    var items = itemsOf(id);
    var wrap = document.createElement("div");
    wrap.className = "tr-view";

    var head = document.createElement("div");
    head.className = "tr-bar";
    var back = document.createElement("button");
    back.type = "button";
    back.className = "tr-back";
    back.title = "Back to the groups";
    back.innerHTML = BACK + "<span></span>";
    back.querySelector("span").textContent = g.name;
    back.addEventListener("click", function () { open(""); });
    head.appendChild(back);
    var where = document.createElement("span");
    where.className = "tr-where";
    head.appendChild(where);
    wrap.appendChild(head);

    // duration
    var dur = document.createElement("div");
    dur.className = "tr-controls";
    dur.innerHTML = '<label class="tr-dur"><span>Duration</span><input type="range" min="4" max="60" step="1" /><b></b><small class="tr-seconds"></small></label>';
    var range = dur.querySelector("input");
    var out = dur.querySelector("b");
    range.value = framesOf(id);
    out.textContent = range.value + "f";
    range.addEventListener("input", function () {
      state.frames[id] = parseInt(range.value, 10);
      out.textContent = range.value + "f";
      dur.querySelector(".tr-seconds").textContent = secondsText();
    });
    range.addEventListener("change", save);

    // direction (only when some card of the group has it)
    var dirs = {};
    items.forEach(function (t) { (t.dirs || []).forEach(function (d) { dirs[d] = true; }); });
    var dirList = ["left", "right", "up", "down"].filter(function (d) { return dirs[d]; });
    if (dirList.length) {
      var row = document.createElement("div");
      row.className = "tr-dirs";
      row.innerHTML = "<span>Direction</span>";
      dirList.forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = ARROWS[d];
        b.title = d.charAt(0).toUpperCase() + d.slice(1);
        b.className = state.dir === d ? "is-on" : "";
        b.addEventListener("click", function () {
          state.dir = d;
          save();
          Array.prototype.forEach.call(row.querySelectorAll("button"), function (x) { x.classList.toggle("is-on", x === b); });
          markDirs(wrap);
        });
        row.appendChild(b);
      });
      dur.appendChild(row);
    }
    wrap.appendChild(dur);

    var grid = document.createElement("div");
    grid.className = "tr-cards";
    items.forEach(function (t) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "tr-card";
      card.title = t.name + " -- " + t.desc + ". Click to apply.";
      var pv = previewBox(t.id);
      card.appendChild(pv.box);
      var cap = document.createElement("span");
      cap.className = "tr-card-cap";
      cap.innerHTML = '<b></b><small></small><i class="tr-card-dir"></i>';
      cap.querySelector("b").textContent = t.name;
      cap.querySelector("small").textContent = t.desc + (t.slot === "in" ? " · In" : (t.slot === "out" ? " · Out" : ""));
      card.appendChild(cap);
      card.setAttribute("data-id", t.id);
      bindHover(card, pv.video, pv.box);
      card.addEventListener("click", function () { apply(t, card); });
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    markDirs(wrap);
    return wrap;
  }

  // the arrow on each card that has directions
  function markDirs(wrap) {
    Array.prototype.forEach.call(wrap.querySelectorAll(".tr-card"), function (card) {
      var t = CAT.byId[card.getAttribute("data-id")];
      card.querySelector(".tr-card-dir").textContent = t && t.dirs ? ARROWS[dirFor(t)] : "";
    });
  }

  function draw() {
    if (!root) { return; }
    Array.prototype.forEach.call(root.querySelectorAll("video"), function (v) {
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
    });
    root.innerHTML = "";
    root.appendChild(state.group ? renderGroup(state.group) : renderGroups());
    var where = root.querySelector(".tr-where");
    if (where) { where.textContent = whereText(); }
    var sec = root.querySelector(".tr-seconds");
    if (sec) { sec.textContent = secondsText(); }
    root.scrollTop = 0;
  }

  function open(id) {
    state.group = id && group(id) ? id : "";
    draw();
    refreshInfo();
  }

  // ------------------------------------------------------------------ entry

  window.MF = window.MF || {};
  window.MF.transitions = {
    render: function (container) {
      root = container;
      draw();
      refreshInfo();
    },
    // for the Wheel: one effect by id, with its group's duration / direction
    run: function (id, callback) {
      var t = CAT.byId[id];
      if (!t) { callback({ ok: false, error: "Unknown transition." }); return; }
      call("mftApply", { id: t.id, name: t.name, frames: framesOf(t.group), dir: dirFor(t) }, callback);
    }
  };

  // panel.js draws the Kit before this file loads: take the area over now
  // when Transitions is the open category
  (function () {
    var area = document.getElementById("kit-presets");
    if (area && document.querySelector(".kit-category.is-active.is-builtin")) {
      area.classList.add("is-transitions");
      window.MF.transitions.render(area);
    }
  }());

  // keep "cut / time indicator" current while it's on screen
  setInterval(function () {
    if (root && root.isConnected && root.offsetParent !== null && !busy) { refreshInfo(); }
  }, 1500);
}());
