/*
 * Mótion Film -- Home › 02 / FAVORITES: favorite speed curves.
 *
 *   - The ★ in the corner of 01 Curves saves the curve as it is now (its
 *     IN / OUT influence); it shows filled when that curve is already a
 *     favorite, and clicking it then removes it.
 *   - The first 4 favorites are tiles here (the graph + "in / out"); the
 *     library button shows them all. Click = load into 01 Curves and
 *     apply to the selected keyframes (same as dragging the curve);
 *     drag = reorder; × = remove. New ones go first.
 *   - Saved in "motionfilm-curve-favorites" (mirrored to settings.json),
 *     so the Elastic popup can offer them later.
 *
 * Uses window.MF.curves from panel.js (get / set / samples / onDraw).
 */
(function () {
  "use strict";

  var curves = window.MF && window.MF.curves;
  if (!curves || !document.getElementById("fav-top")) { return; }

  var KEY = "motionfilm-curve-favorites";
  var TOP = 4;
  var favs = [];
  var dragId = null;

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) {
      favs = saved.filter(function (f) { return f && f.inInfluence > 0 && f.outInfluence > 0; });
    }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(favs)); } catch (e) {}
  }

  function same(f, c) {
    return Math.round(f.inInfluence) === Math.round(c.inInfluence) && Math.round(f.outInfluence) === Math.round(c.outInfluence);
  }
  function indexOfCurve(c) {
    for (var i = 0; i < favs.length; i += 1) { if (same(favs[i], c)) { return i; } }
    return -1;
  }
  // IN / OUT, in the same order as the fields of 01 Curves
  function label(f) { return Math.round(f.inInfluence) + " / " + Math.round(f.outInfluence); }

  // ------------------------------------------------------------------ star

  function renderStar() {
    var star = $("curve-fav");
    var on = indexOfCurve(curves.get()) >= 0;
    star.classList.toggle("is-on", on);
    star.title = on ? "Remove this curve from the favorites" : "Save this curve as a favorite (02 / Favorites)";
  }

  $("curve-fav").addEventListener("click", function () {
    var c = curves.get();
    var i = indexOfCurve(c);
    if (i >= 0) {
      favs.splice(i, 1);
      status("Curve removed from the favorites.", "");
    } else {
      favs.unshift({ id: Date.now().toString(36), inInfluence: Math.round(c.inInfluence), outInfluence: Math.round(c.outInfluence) });
      status("Curve " + label(favs[0]) + " saved to the favorites.", "success");
    }
    save();
    render();
  });
  curves.onDraw = renderStar;

  // ------------------------------------------------------------------ tiles

  function drawTile(canvas, f) {
    var w = canvas.clientWidth || 80;
    var h = canvas.clientHeight || 40;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var pad = 5;
    var pts = curves.samples(f.inInfluence, f.outInfluence, 48);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent-bright").trim() || "#00f011";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (var i = 0; i < pts.length; i += 1) {
      var x = pad + pts[i].time * (w - pad * 2);
      var y = h - pad - pts[i].speed * (h - pad * 2);
      if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  function tile(f, index) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "fav-tile";
    el.draggable = true;
    el.title = "Use this curve (" + label(f) + ") -- on the selected keyframes";
    el.innerHTML = '<span class="fav-num"></span><canvas class="fav-graph"></canvas><span class="fav-label"></span>' +
      '<span class="fav-remove" role="button" title="Remove from the favorites">×</span>';
    el.querySelector(".fav-num").textContent = String(index + 1);
    el.querySelector(".fav-label").textContent = label(f);
    el.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".fav-remove")) {
        var i = favs.indexOf(f);
        if (i >= 0) { favs.splice(i, 1); save(); render(); }
        return;
      }
      curves.set(f.inInfluence, f.outInfluence, "Favorite " + (favs.indexOf(f) + 1) + " (" + label(f) + ")");
    });
    el.addEventListener("dragstart", function (e) {
      dragId = f.id;
      el.classList.add("is-dragging");
      try { e.dataTransfer.setData("text/plain", f.id); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
    });
    el.addEventListener("dragend", function () {
      dragId = null;
      el.classList.remove("is-dragging");
      Array.prototype.forEach.call(document.querySelectorAll(".fav-tile.is-over"), function (t) { t.classList.remove("is-over"); });
    });
    el.addEventListener("dragover", function (e) {
      if (!dragId || dragId === f.id) { return; }
      e.preventDefault();
      el.classList.add("is-over");
    });
    el.addEventListener("dragleave", function () { el.classList.remove("is-over"); });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      var from = -1;
      for (var i = 0; i < favs.length; i += 1) { if (favs[i].id === dragId) { from = i; } }
      var to = favs.indexOf(f);
      if (from < 0 || to < 0 || from === to) { return; }
      var moved = favs.splice(from, 1)[0];
      favs.splice(to, 0, moved);
      save();
      render();
    });
    return el;
  }

  function fill(box, list, offset) {
    box.innerHTML = "";
    var made = [];
    list.forEach(function (f, i) {
      var el = tile(f, offset + i);
      box.appendChild(el);
      made.push({ el: el, f: f });
    });
    // canvases have a size only once they're in the page
    made.forEach(function (m) { drawTile(m.el.querySelector(".fav-graph"), m.f); });
  }

  function render() {
    var top = $("fav-top");
    var all = $("fav-all");
    var library = $("fav-library");
    var toggle = $("fav-library-toggle");
    fill(top, favs.slice(0, TOP), 0);
    $("fav-empty").hidden = favs.length > 0;
    top.hidden = favs.length === 0;
    $("fav-count").textContent = favs.length ? favs.length + (favs.length === 1 ? " curve" : " curves") : "";
    toggle.hidden = favs.length === 0;
    var open = !library.hidden;
    toggle.textContent = open ? "Hide library" : "Library (" + favs.length + ")";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { fill(all, favs, 0); }
    renderStar();
  }

  $("fav-library-toggle").addEventListener("click", function () {
    $("fav-library").hidden = !$("fav-library").hidden;
    render();
  });

  // the tiles follow the accent color and the panel width
  window.addEventListener("resize", render);
  var lastAccent = "";
  setInterval(function () {
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-bright");
    if (accent !== lastAccent) { lastAccent = accent; render(); }
  }, 2000);

  render();
}());
