/*
 * Mótion Film -- Text Animation › 02 / FAVORITES: favorite text animations
 * (same idea as the favorite curves, curve-favorites.js).
 *
 *   - The ★ in the corner of the 01 preview saves the animation as it is
 *     now (Letter / Word / Line, Bounce, style, Amount, Delay, Duration,
 *     Blur); it shows filled when that one is already a favorite, and
 *     clicking it then removes it.
 *   - The first 4 favorites are tiles here (a small "Aa" that plays the
 *     animation on hover); the library button shows them all. Click =
 *     load into 01 and apply to the selected text layers; drag = reorder;
 *     × = remove. New ones go first.
 *   - Saved in "motionfilm-textanim-favorites" (mirrored to
 *     settings.json); the Wheel offers them as "Text favorite n".
 *
 * Uses window.MF.textanim from textanim.js.
 */
(function () {
  "use strict";

  var ta = window.MF && window.MF.textanim;
  if (!ta || !ta.get || !document.getElementById("tfav-top")) { return; }

  var KEY = "motionfilm-textanim-favorites";
  var TOP = 4;
  var favs = [];
  var dragId = null;

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) { favs = saved.filter(function (f) { return f && f.style; }); }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(favs)); } catch (e) {}
  }

  function same(a, b) {
    return a.style === b.style && a.by === b.by && !!a.bounce === !!b.bounce &&
      Math.round(a.amount) === Math.round(b.amount) && Math.round(a.blur) === Math.round(b.blur) &&
      Math.round(a.delay * 1000) === Math.round(b.delay * 1000) && Math.round(a.duration * 100) === Math.round(b.duration * 100);
  }
  function indexOfCurrent() {
    var c = ta.get();
    for (var i = 0; i < favs.length; i += 1) { if (same(favs[i], c)) { return i; } }
    return -1;
  }
  function label(f) { return ta.name(f); }
  function sub(f) { return ta.by(f) + (f.bounce ? " · Bounce" : "") + " · " + (Math.round(f.duration * 10) / 10) + " s"; }

  // ------------------------------------------------------------------ star

  function renderStar() {
    var star = $("ta-fav");
    var on = indexOfCurrent() >= 0;
    star.classList.toggle("is-on", on);
    star.title = on ? "Remove this animation from the favorites" : "Save this animation as a favorite (02 / Favorites)";
  }

  $("ta-fav").addEventListener("click", function () {
    var i = indexOfCurrent();
    if (i >= 0) {
      favs.splice(i, 1);
      status("Text animation removed from the favorites.", "");
    } else {
      var f = ta.get();
      f.id = Date.now().toString(36);
      favs.unshift(f);
      status(label(f) + " (" + sub(f) + ") saved to the favorites.", "success");
    }
    save();
    render();
  });

  // ------------------------------------------------------------------ tiles

  function play(tileEl, f) {
    var mini = tileEl.querySelector(".tfav-mini");
    if (mini._anims) { mini._anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); }
    mini._anims = ta.animateInto(mini, f.by === "line" ? "Aa" : (f.by === "word" ? "Aa Bb" : "Abc"), f, 0.3);
  }

  function tile(f, index) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "fav-tile tfav-tile";
    el.draggable = true;
    el.title = "Use " + label(f) + " (" + sub(f) + ") -- on the selected text layers";
    el.innerHTML = '<span class="fav-num"></span><span class="tfav-mini"></span><span class="fav-label"></span><span class="tfav-sub"></span>' +
      '<span class="fav-remove" role="button" title="Remove from the favorites">×</span>';
    el.querySelector(".fav-num").textContent = String(index + 1);
    el.querySelector(".fav-label").textContent = label(f);
    el.querySelector(".tfav-sub").textContent = sub(f);
    el.querySelector(".tfav-mini").textContent = f.by === "word" ? "Aa Bb" : (f.by === "line" ? "Aa" : "Abc");
    el.addEventListener("mouseenter", function () { play(el, f); });
    el.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".fav-remove")) {
        var i = favs.indexOf(f);
        if (i >= 0) { favs.splice(i, 1); save(); render(); }
        return;
      }
      ta.load(f);
      var n = favs.indexOf(f) + 1;
      if (ta.selected() > 0) {
        ta.apply(f, function (res) { status(res.ok ? "Favorite " + n + ": " + res.message : res.error, res.ok ? "success" : "error"); });
      } else {
        status("Favorite " + n + " (" + label(f) + ") loaded -- select text layers and Apply.", "");
      }
    });
    el.addEventListener("dragstart", function (e) {
      dragId = f.id;
      el.classList.add("is-dragging");
      try { e.dataTransfer.setData("text/plain", f.id); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
    });
    el.addEventListener("dragend", function () {
      dragId = null;
      el.classList.remove("is-dragging");
      Array.prototype.forEach.call(document.querySelectorAll(".tfav-tile.is-over"), function (t) { t.classList.remove("is-over"); });
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
    list.forEach(function (f, i) { box.appendChild(tile(f, offset + i)); });
  }

  function render() {
    var top = $("tfav-top");
    var library = $("tfav-library");
    var toggle = $("tfav-library-toggle");
    fill(top, favs.slice(0, TOP), 0);
    $("tfav-empty").hidden = favs.length > 0;
    top.hidden = favs.length === 0;
    $("tfav-count").textContent = favs.length ? favs.length + (favs.length === 1 ? " animation" : " animations") : "";
    toggle.hidden = favs.length === 0;
    var open = !library.hidden;
    toggle.textContent = open ? "Hide library" : "Library (" + favs.length + ")";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { fill($("tfav-all"), favs, 0); }
    renderStar();
  }

  $("tfav-library-toggle").addEventListener("click", function () {
    $("tfav-library").hidden = !$("tfav-library").hidden;
    render();
  });

  ta.onChange = renderStar;
  render();
}());
