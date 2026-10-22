/*
 * Mótion Film -- Captions tab, laid out like Home: collapsible sections
 * 01 Generate (what's chosen, the button, what will be transcribed) and
 * 02 Customize, a step guide shown one part at a time: 1 Style ->
 * 2 Animation -> 3 Highlight -> 4 Adjust.
 *
 *   - Styles: Reels and Viral (small words around one big highlighted
 *     word -- client/captions-styles.js, laid out by captions-layout.js,
 *     the same file host.jsx uses) and the Simple ones (Classic, 3 Words,
 *     One at a time).
 *   - Every card is a live preview drawn here with the same timing math
 *     as the expressions host.jsx writes into AE (createCaptionSet), so
 *     what a card shows is what the comp gets. Reels / Viral cards are
 *     drawn on a canvas (gradient, halos, shadow, underline).
 *   - Generate: AE renders the audio (renderCaptionsAudio), ffmpeg makes
 *     it 16 kHz, whisper transcribes with word times, captions-core.js
 *     cleans the words, splits the captions and (Reels / Viral) picks
 *     the highlighted word, host.jsx builds the layers. Steps, progress
 *     and Cancel are shown meanwhile.
 *   - The styles' fonts ship in /fonts (OFL) and are installed for the
 *     user the first time a style needs them.
 *   - Settings live under the "motionfilm-captions" localStorage key,
 *     mirrored by shared-core.js to Documents/Mótion Film Packs/
 *     settings.json.
 *
 * Borrows Node/host helpers from panel.js (window.MF.captions).
 */
(function () {
  "use strict";

  var bridge = (window.MF && window.MF.captions) || null;
  var core = window.MFCaptionsCore;
  var CL = window.MFCaptionsLayout;
  var CS = window.MFCaptionStyles;
  if (!bridge || !core || !CL || !CS || !document.getElementById("captions-main")) {
    return;
  }

  function $(id) { return document.getElementById(id); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function status(message, type) { bridge.setStatus(message, type); }

  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }

  // ------------------------------------------------------------------ simple styles

  var SIMPLE = [
    { id: "classic", name: "Classic", sample: ["Here's how I edit", "my videos faster"] },
    { id: "dynamic", name: "3 Words", sample: ["edit your videos"] },
    { id: "word", name: "One at a time", sample: ["edit", "your", "videos", "faster"] }
  ];
  var SIMPLE_BY = {};
  SIMPLE.forEach(function (m) { SIMPLE_BY[m.id] = m; });

  var BASE_STYLE = {
    family: "Arial", font: "Arial-BoldMT", fontStyle: "Bold", fontSize: 64, tracking: 0, lineHeight: 1.15, textCase: "none", justify: "center",
    fill: "#ffffff", strokeOn: true, stroke: "#000000", strokeWidth: 5,
    shadowOn: true, shadowColor: "#000000", shadowOpacity: 55, shadowDistance: 3, shadowSoftness: 12,
    glowOn: false, glowColor: "#ffffff", glowIntensity: 1, glowRadius: 25,
    bgOn: false, bg: "#000000", bgOpacity: 60, bgPadding: 24, bgRadius: 12,
    position: "bottom", margin: 10, posX: 50, posY: 80, scale: 100,
    highlightOn: false, highlight: "#ffd400", highlightScale: 100,
    backShadeOn: false, backShadeOpacity: 45, backShadeSize: 100,
    anim: "smooth"
  };
  var MODE_STYLE = {
    classic: {},
    dynamic: { family: "Inter", font: "Inter-Bold", fontStyle: "Bold", fontSize: 84, tracking: -20, strokeOn: false, shadowOpacity: 45, shadowSoftness: 16, position: "center", highlightOn: true, anim: "rise" },
    word: { family: "Inter", font: "Inter-ExtraBold", fontStyle: "ExtraBold", fontSize: 118, tracking: -25, strokeOn: false, shadowOpacity: 45, shadowSoftness: 16, position: "center", anim: "pop" }
  };
  function defaultStyle(mode) {
    var s = copy(BASE_STYLE);
    var extra = MODE_STYLE[mode] || {};
    for (var k in extra) { s[k] = extra[k]; }
    return s;
  }

  // Reels / Viral options: where and how big, the shadow and the
  // Highlight tab's look (off = the style's own).
  var VIRAL_OPTS = {
    position: "bottom", posX: 50, posY: 62, scale: 100,
    shadowOn: false, shadowOpacity: 55, shadowSoftness: 40, shadowDistance: 4,
    backShadeOn: false, backShadeOpacity: 45, backShadeSize: 100,
    colorOn: false, color: "#ffb86b", gradientOn: false, gradTop: "#ffffff", gradBottom: "#ffb86b",
    glowOn: false, glowColor: "#ffffff", glowAmt: 60, glowSize: 40, sweepOn: false,
    accentFamily: "", accentStyle: "", accentFont: "", smallFamily: "", smallStyle: "", smallFont: ""
  };

  // ------------------------------------------------------------------ animations

  // by: how the preview (and AE) moves it -- marker (each word when
  // spoken), start (all words with the caption), stagger (word after
  // word), chars (letter after letter), cut, layer (the whole line).
  // Same numbers as CAPTION_ENTRANCES / capLayerEntrance in host.jsx.
  var ANIMS = [
    { id: "smooth", name: "Smooth", by: "layer" },
    { id: "none", name: "No animation", by: "cut" },
    { id: "softBlur", name: "Soft blur", by: "start", blur: [0.04, 0.04], dur: 0.35 },
    { id: "rise", name: "Rise", by: "marker", pos: [0, 0.22], blur: [0.02, 0.05], dur: 0.4 },
    { id: "dropBlur", name: "Drop blur", by: "marker", pos: [0, -0.35], blur: [0.02, 0.08], dur: 0.45 },
    { id: "fromLeft", name: "From left", by: "marker", pos: [-0.25, 0], blur: [0.05, 0.02], dur: 0.4 },
    { id: "fromRight", name: "From right", by: "marker", pos: [0.25, 0], blur: [0.05, 0.02], dur: 0.4 },
    { id: "zoomBlur", name: "Zoom blur", by: "marker", scale: 145, blur: [0.05, 0.05], dur: 0.4 },
    { id: "lettersRise", name: "Letters rise", by: "chars", frames: 1.4, pos: [0, 0.2], blur: [0.02, 0.04], dur: 0.34 },
    { id: "lettersRight", name: "Letters from right", by: "chars", frames: 1.2, pos: [0.6, 0], blur: [0.04, 0.01], dur: 0.4 },
    { id: "lettersSpin", name: "Letters spin", by: "chars", frames: 1.5, pos: [0, 0.28], rotation: 80, dur: 0.5, back: true },
    { id: "lettersSpread", name: "Letters spread", by: "chars", frames: 0.8, tracking: 350, blur: [0.06, 0.02], dur: 0.55 },
    { id: "lettersBlur", name: "Letters blur", by: "chars", frames: 1.5, blur: [0.05, 0.05], dur: 0.3 },
    { id: "slideWords", name: "Slide words", by: "stagger", frames: 3, pos: [0, 0.32], blur: [0.02, 0.04], dur: 0.45 },
    { id: "slidePhrase", name: "Slide phrase", by: "layer" },
    { id: "bounce", name: "Bounce", by: "layer" },
    { id: "scale", name: "Scale", by: "layer" },
    { id: "pop", name: "Pop", by: "layer", only: "word" }
  ];
  var ANIM_BY = {};
  ANIMS.forEach(function (a) { ANIM_BY[a.id] = a; });
  var WORD_MODE_ANIMS = { pop: 1, none: 1, bounce: 1, scale: 1, slideWords: 1 };

  function animsFor(mode) {
    return ANIMS.filter(function (a) {
      return mode === "word" ? !!WORD_MODE_ANIMS[a.id] : a.only !== "word";
    });
  }

  var LANGS = [
    ["auto", "Detect automatically"], ["pt", "Portuguese"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["it", "Italian"],
    ["de", "German"], ["nl", "Dutch"], ["pl", "Polish"], ["ru", "Russian"], ["uk", "Ukrainian"], ["tr", "Turkish"], ["ar", "Arabic"],
    ["he", "Hebrew"], ["hi", "Hindi"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"], ["id", "Indonesian"], ["vi", "Vietnamese"],
    ["th", "Thai"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["el", "Greek"], ["cs", "Czech"],
    ["ro", "Romanian"], ["hu", "Hungarian"], ["ca", "Catalan"], ["gl", "Galician"], ["eu", "Basque"]
  ];

  // ------------------------------------------------------------------ settings

  var STORE_KEY = "motionfilm-captions";
  var settings = {
    v: 2, mode: "viral", lang: "auto", range: "comp", group: "all",
    styles: {}, rules: { classic: {}, dynamic: {}, word: {}, viral: {} },
    viral: { preset: "spotlight", anims: {}, opts: copy(VIRAL_OPTS) }
  };
  SIMPLE.forEach(function (m) { settings.styles[m.id] = defaultStyle(m.id); });

  function load() {
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
    if (!saved) { return; }
    if (saved.mode === "viral" || SIMPLE_BY[saved.mode]) { settings.mode = saved.mode; }
    if (saved.lang) { settings.lang = saved.lang; }
    if (saved.range === "comp" || saved.range === "work") { settings.range = saved.range; }
    if (saved.group) { settings.group = saved.group; }
    SIMPLE.forEach(function (m) {
      var st = defaultStyle(m.id);
      var s = saved.styles && saved.styles[m.id];
      if (s) { for (var k in s) { if (k in st) { st[k] = s[k]; } } }
      if (animsFor(m.id).indexOf(ANIM_BY[st.anim]) < 0) { st.anim = defaultStyle(m.id).anim; }
      settings.styles[m.id] = st;
    });
    ["classic", "dynamic", "word", "viral"].forEach(function (m) {
      if (saved.rules && saved.rules[m]) { settings.rules[m] = saved.rules[m]; }
    });
    if (saved.viral) {
      if (CS.byId(saved.viral.preset)) { settings.viral.preset = saved.viral.preset; }
      settings.viral.anims = saved.viral.anims || {};
      var o = copy(VIRAL_OPTS);
      for (var key in (saved.viral.opts || {})) { if (key in o) { o[key] = saved.viral.opts[key]; } }
      settings.viral.opts = o;
    }
  }
  function save() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function isViral() { return settings.mode === "viral"; }
  function preset() { return CS.byId(settings.viral.preset) || CS.STYLES[0]; }
  function style() { return settings.styles[settings.mode] || settings.styles.classic; }
  // the object the Adjust / Highlight controls edit
  function model() { return isViral() ? settings.viral.opts : style(); }
  function rules() { return core.captionRules(settings.mode, settings.rules[settings.mode]); }
  function animOf(mode, presetId) {
    if (mode === "viral") {
      var id = settings.viral.anims[presetId || settings.viral.preset];
      return ANIM_BY[id] && id !== "pop" ? id : (CS.byId(presetId || settings.viral.preset) || CS.STYLES[0]).anim;
    }
    return settings.styles[mode].anim;
  }
  function currentAnim() { return animOf(settings.mode); }
  function setCurrentAnim(id) {
    if (isViral()) { settings.viral.anims[settings.viral.preset] = id; } else { style().anim = id; }
  }
  function styleName() { return isViral() ? preset().name : SIMPLE_BY[settings.mode].name; }

  // The chosen Reels / Viral style with the Highlight tab's look and the
  // Adjust tab's shadow on top.
  function lookPreset(base, o) {
    var P = copy(base);
    var accents = ["accent"].concat(P.lead ? ["lead"] : []);
    var recolored = false;
    accents.forEach(function (key) {
      var r = P[key];
      if (o.colorOn) {
        delete r.gradient;
        r.fill = o.color;
        (r.outerGlow || []).forEach(function (g) { g.color = o.color; });
        if (r.stroke) { r.stroke.color = o.color; }
        recolored = true;
      }
      if (o.gradientOn) {
        r.gradient = { top: o.gradTop, bottom: o.gradBottom };
        recolored = true;
      }
      if (o.glowOn) {
        var amount = clamp(o.glowAmt, 5, 100);
        var size = clamp(o.glowSize, 5, 100) / 100;
        r.outerGlow = [{ color: o.glowColor, opacity: amount, softness: 0.06 * r.size * size }, { color: o.glowColor, opacity: Math.round(amount * 0.55), softness: 0.22 * r.size * size }];
        delete r.glow;
      }
      if (o.sweepOn) { r.sweep = true; }
      if (o.accentFont) { r.font = o.accentFont; r.family = o.accentFamily; r.style = o.accentStyle; }
    });
    if (o.smallFont) {
      ["base", "tail"].forEach(function (key) {
        if (P[key]) { P[key].font = o.smallFont; P[key].family = o.smallFamily; P[key].style = o.smallStyle; }
      });
    }
    if (recolored && P.palette) { P.palette = [{}]; }
    if (o.shadowOn) {
      CS.ROLES.forEach(function (key) {
        if (!P[key]) { return; }
        P[key].shadow = { opacity: o.shadowOpacity, distance: o.shadowDistance, softness: Math.round(6 + o.shadowSoftness * 0.6) * (key === "accent" ? 1.4 : 1) };
      });
    }
    return P;
  }
  function effectivePreset(base) { return lookPreset(base || preset(), settings.viral.opts); }

  // ------------------------------------------------------------------ fonts

  // The bundled fonts, loaded into the panel for the previews -- all of
  // them up front: a canvas measuring text in a font that hasn't loaded
  // yet gets the fallback's widths, and the letters end up spaced wrong.
  function loadBundledFonts() {
    if (typeof FontFace === "undefined") { return; }
    var weights = { Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900, Regular: 400, Italic: 400 };
    var loads = [];
    Object.keys(CS.FONT_FILES).forEach(function (ps) {
      var m = /^(.*?) (Medium|SemiBold|Bold|ExtraBold|Black|Regular|Italic)( Italic)?$/.exec(CS.FONT_FULL_NAMES[ps]);
      if (!m) { return; }
      var face = new FontFace(m[1], "url(\"../fonts/" + CS.FONT_FILES[ps] + "\")", {
        weight: String(weights[m[2]]),
        style: m[2] === "Italic" || m[3] ? "italic" : "normal"
      });
      loads.push(face.load().then(function (loaded) { document.fonts.add(loaded); }, function () {}));
    });
    Promise.all(loads).then(function () { previews.forEach(function (p) { p.built = ""; }); });
  }

  // "Bold" -> 700, "Black Italic" -> 900 + italic
  function weightOf(styleName) {
    var s = String(styleName || "").toLowerCase();
    if (/black|heavy/.test(s)) { return 900; }
    if (/extra ?bold|ultra ?bold/.test(s)) { return 800; }
    if (/semi ?bold|demi/.test(s)) { return 600; }
    if (/bold/.test(s)) { return 700; }
    if (/medium/.test(s)) { return 500; }
    if (/extra ?light|ultra ?light/.test(s)) { return 200; }
    if (/light/.test(s)) { return 300; }
    if (/thin|hairline/.test(s)) { return 100; }
    return 400;
  }
  function italicOf(styleName) { return /italic|oblique/i.test(styleName || ""); }
  function canvasFont(role, px) {
    return (italicOf(role.style) ? "italic " : "") + weightOf(role.style) + " " + px.toFixed(2) + "px \"" + role.family + "\", Arial, sans-serif";
  }

  // Bundled fonts the chosen style uses that AE doesn't have yet.
  function bundledFontsOf(P) {
    var out = [];
    CS.ROLES.forEach(function (key) {
      var r = P[key];
      if (r && CS.FONT_FILES[r.font] && out.indexOf(r.font) < 0) { out.push(r.font); }
    });
    return out;
  }

  // Installs bundled fonts for this user (no admin): Windows -> the
  // per-user Fonts folder + its registry entry; Mac -> ~/Library/Fonts.
  function installFonts(list) {
    var fs = bridge.nodeRequire("fs");
    var path = bridge.nodeRequire("path");
    var os = bridge.nodeRequire("os");
    var src = path.join(extensionDir(), "fonts");
    var mac = os.platform() === "darwin";
    var env = bridge.nodeRequire("process").env; // no global process in this panel
    var dest = mac ? path.join(os.homedir(), "Library", "Fonts") : path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "Windows", "Fonts");
    fs.mkdirSync(dest, { recursive: true });
    var jobs = [];
    list.forEach(function (ps) {
      var file = CS.FONT_FILES[ps];
      if (!file) { return; }
      var to = path.join(dest, file);
      if (!fs.existsSync(to)) { fs.copyFileSync(path.join(src, file), to); }
      if (!mac) {
        jobs.push(bridge.runCommand("reg.exe", ["add", "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "/v", CS.FONT_FULL_NAMES[ps] + " (TrueType)", "/t", "REG_SZ", "/d", to, "/f"], { timeout: 20000 }));
      }
    });
    return Promise.all(jobs);
  }

  var fontsReady = {};
  // Makes sure AE has the style's fonts; installs the bundled ones when
  // missing. Resolves the fonts still missing (AE needs a restart).
  function ensureFonts(P) {
    var list = bundledFontsOf(P);
    var key = list.join(",");
    if (!list.length || fontsReady[key]) { return Promise.resolve([]); }
    return hostP("checkCaptionFonts", [JSON.stringify(list)]).then(function (r) {
      if (!r.missing.length) { fontsReady[key] = true; return []; }
      // AE picks newly installed fonts up by itself (checkCaptionFonts asks
      // it to rescan) a moment later -- a few tries before telling the
      // user to restart it.
      function recheck(tries) {
        return hostP("checkCaptionFonts", [JSON.stringify(list)]).then(function (again) {
          if (!again.missing.length) { fontsReady[key] = true; return []; }
          if (tries <= 1) { return again.missing; }
          return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(function () { return recheck(tries - 1); });
        });
      }
      return installFonts(r.missing).then(function () { return recheck(4); });
    });
  }

  function fontsFailed(error) {
    status("Couldn't install the style's fonts: " + String((error && error.message) || error), "error");
  }

  function showFontsNote(missing) {
    var note = $("cap-fonts-note");
    if (!missing || !missing.length) { note.hidden = true; return; }
    $("cap-fonts-note-title").textContent = "The styles' fonts are installed";
    $("cap-fonts-note-text").textContent = "Close and reopen After Effects so the captions use them (until then AE shows a substitute font).";
    note.hidden = false;
  }

  // ------------------------------------------------------------------ preview timing

  var FPS = 30;
  var LOOP = 3.6; // s

  function curve(t, t0, dur, back) {
    var p = clamp((t - t0) / dur, 0, 1);
    if (back) {
      var c = 1.70158;
      var q = p - 1;
      return 1 - (1 + (c + 1) * q * q * q + c * q * q);
    }
    return Math.pow(1 - p, 4);
  }
  function easeOut(p) { return 1 - Math.pow(1 - clamp(p, 0, 1), 3); }

  // A word / letter at time t (host: capAddEntrance). F = font size px.
  function pieceState(anim, t, t0, F) {
    var a = curve(t, t0, anim.dur, anim.back);
    return {
      o: anim.back ? clamp(1 - Math.abs(a) * 1.2, 0, 1) * (t >= t0 ? 1 : 0) : 1 - a,
      x: anim.pos ? anim.pos[0] * F * a : 0,
      y: anim.pos ? anim.pos[1] * F * a : 0,
      s: anim.scale ? 1 + (anim.scale / 100 - 1) * a : 1,
      b: anim.blur ? Math.max(anim.blur[0], anim.blur[1]) * F * Math.max(0, a) : 0,
      r: anim.rotation ? anim.rotation * a : 0,
      track: anim.tracking ? anim.tracking / 1000 * F * Math.max(0, a) : 0
    };
  }

  // The whole line (host: capLayerEntrance / capWordByWordEntrances).
  function layerState(kind, t, t0, shortSide) {
    var st = { o: 1, y: 0, s: 1, b: 0 };
    var dt = t - t0;
    if (dt < 0) { st.o = 0; return st; }
    if (kind === "smooth" || kind === "slidePhrase") {
      var d = kind === "smooth" ? 12 / FPS : 15 / FPS;
      var p = dt / d;
      st.y = shortSide * (kind === "smooth" ? 0.06 : 0.11) * (1 - easeOut(p));
      st.o = clamp(p / (kind === "smooth" ? 0.6 : 0.4), 0, 1);
      if (kind === "smooth") { st.b = 12 * shortSide / 1080 * (1 - easeOut(p)); }
    } else if (kind === "bounce") {
      var land = 4 / FPS;
      if (dt < land) { st.s = easeOut(dt / land); } else { var u = dt - land; st.s = 1 + 0.14 * Math.sin(2.6 * u * 2 * Math.PI) / Math.exp(8 * u); }
    } else if (kind === "scale") {
      st.s = easeOut(dt / 0.5);
    } else if (kind === "pop") {
      st.s = 0.82 + 0.18 * easeOut(dt / (5 / FPS));
      st.o = clamp(dt / (2 / FPS), 0, 1);
    } else if (kind === "slideWords") {
      st.y = shortSide * 0.03 * (1 - easeOut(dt / (4 / FPS)));
      st.o = clamp(dt / (2 / FPS), 0, 1);
    }
    return st;
  }

  // ------------------------------------------------------------------ previews

  var previews = [];

  function hexToRgba(hex, alpha) {
    var h = String(hex || "#000000").replace("#", "");
    var n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  // A preview: a little screen. kind "simple" (DOM spans) or "viral"
  // (canvas). getMode / getAnim / getPreset say what it shows.
  function makePreview(container, opts) {
    var screen = document.createElement("div");
    screen.className = "cap-screen";
    container.appendChild(screen);
    var p = { el: screen, opts: opts, built: "" };
    previews.push(p);
    return p;
  }

  function dropPreviews(container) {
    previews = previews.filter(function (p) { return !container.contains(p.el); });
    container.innerHTML = "";
  }

  // ---- simple styles (DOM)

  function buildSimple(p, mode, st) {
    var key = "simple|" + mode + "|" + st.textCase + "|" + st.justify;
    if (p.built === key) { return; }
    p.built = key;
    p.el.innerHTML = "";
    p.shade = document.createElement("div");
    p.shade.className = "cap-shade";
    p.sample = document.createElement("div");
    p.sample.className = "cap-sample";
    p.el.appendChild(p.shade);
    p.el.appendChild(p.sample);
    p.words = [];
    p.chars = [];
    var t = 0.35;
    var j = 0;
    var oneAtATime = mode === "word";
    var lines = SIMPLE_BY[mode].sample;
    (oneAtATime ? [lines.join(" ")] : lines).forEach(function (line) {
      var lineEl = document.createElement("div");
      lineEl.className = "cap-line";
      core.applyCase(line, st.textCase).split(" ").forEach(function (word, i) {
        var w = document.createElement("span");
        w.className = "cap-w";
        Array.prototype.forEach.call(word, function (ch) {
          var c = document.createElement("span");
          c.className = "cap-c";
          c.textContent = ch;
          w.appendChild(c);
          p.chars.push({ el: c, j: j });
          j += 1;
        });
        if (i > 0) { lineEl.appendChild(document.createTextNode(" ")); }
        lineEl.appendChild(w);
        p.words.push({ el: w, start: t });
        t += oneAtATime ? 0.42 : 0.24;
      });
      p.sample.appendChild(lineEl);
    });
  }

  function lookSimple(p, st) {
    var f = (p.el.clientWidth || 160) / 1080 * (p.opts.zoom || 1);
    var s = p.sample.style;
    var size = st.fontSize * f * (st.scale || 100) / 100;
    s.fontFamily = "\"" + (st.family || "Arial") + "\", Arial, sans-serif";
    s.fontWeight = weightOf(st.fontStyle);
    s.fontStyle = italicOf(st.fontStyle) ? "italic" : "normal";
    s.fontSize = size.toFixed(2) + "px";
    s.letterSpacing = ((st.tracking || 0) / 1000).toFixed(3) + "em";
    s.lineHeight = String(st.lineHeight || 1.15);
    s.textAlign = st.justify || "center";
    s.color = st.fill;
    // AE draws the stroke behind the fill (half its width shows); this
    // CEP's Chromium has no paint-order, so a ring of hard text-shadows
    // stands in for it.
    var shadows = [];
    var ring = st.strokeOn ? st.strokeWidth * f * (st.scale || 100) / 100 / 2 : 0;
    if (ring > 0.05) {
      for (var a = 0; a < 16; a += 1) {
        var ang = a / 16 * 2 * Math.PI;
        shadows.push((Math.cos(ang) * ring).toFixed(2) + "px " + (Math.sin(ang) * ring).toFixed(2) + "px 0 " + st.stroke);
      }
    }
    if (st.glowOn) { shadows.push("0 0 " + (st.glowRadius * f * 0.6).toFixed(1) + "px " + hexToRgba(st.glowColor, Math.min(1, 0.35 * st.glowIntensity + 0.2))); }
    if (st.shadowOn) { shadows.push("0 " + (st.shadowDistance * f).toFixed(1) + "px " + (st.shadowSoftness * f).toFixed(1) + "px " + hexToRgba(st.shadowColor, st.shadowOpacity / 100)); }
    s.textShadow = shadows.join(", ") || "none";
    if (st.bgOn) {
      s.background = hexToRgba(st.bg, st.bgOpacity / 100);
      s.padding = (st.bgPadding * f * 0.6).toFixed(1) + "px " + (st.bgPadding * f).toFixed(1) + "px";
      s.borderRadius = (st.bgRadius * f).toFixed(1) + "px";
    } else {
      s.background = "none";
      s.padding = "0";
    }
    var x = 50;
    var y;
    var margin = clamp(st.margin, 0, 45);
    var anchor = "-50%";
    if (st.position === "top") { y = margin; anchor = "0%"; } else if (st.position === "center") { y = 50; } else if (st.position === "custom") { x = st.posX; y = st.posY; } else { y = 100 - margin; anchor = "-100%"; }
    if (p.opts.card && st.position !== "custom") { y = st.position === "top" ? 18 : (st.position === "center" ? 50 : 84); }
    s.left = x + "%";
    s.top = y + "%";
    p.anchor = anchor;
    p.shade.hidden = !st.backShadeOn;
    if (st.backShadeOn) {
      p.shade.style.opacity = String(st.backShadeOpacity / 100);
      p.shade.style.left = x + "%";
      p.shade.style.top = y + "%";
      p.shade.style.transform = "translate(-50%, " + (anchor === "-100%" ? "-75%" : anchor === "0%" ? "-25%" : "-50%") + ") scale(" + (st.backShadeSize / 100).toFixed(2) + ")";
      p.shade.style.width = (size * 9) + "px";
      p.shade.style.height = (size * 3.4) + "px";
    }
    return size;
  }

  function drawSimple(p, now) {
    var mode = p.opts.getMode();
    var st = settings.styles[mode];
    buildSimple(p, mode, st);
    var F = lookSimple(p, st);
    var anim = ANIM_BY[p.opts.getAnim()] || ANIM_BY.smooth;
    var t = (now / 1000) % LOOP;
    var shortSide = (p.el.clientWidth || 160) * (p.opts.zoom || 1);
    var oneAtATime = mode === "word";
    var words = p.words;
    var current = -1;
    for (var i = 0; i < words.length; i += 1) { if (t >= words[i].start) { current = i; } }
    var layer = { o: 1, y: 0, s: 1, b: 0 };
    if (oneAtATime) {
      if (current >= 0 && anim.id !== "none") { layer = layerState(anim.id, t, words[current].start, shortSide); }
      if (current < 0) { layer.o = 0; }
    } else if (anim.by === "layer") {
      layer = layerState(anim.id, t, words[0].start, shortSide);
    } else if (t < words[0].start) {
      layer.o = 0;
    }
    p.sample.style.opacity = String(layer.o);
    p.sample.style.transform = "translate(-50%, " + p.anchor + ") translateY(" + layer.y.toFixed(2) + "px) scale(" + layer.s.toFixed(4) + ")";
    p.sample.style.filter = layer.b > 0.05 ? "blur(" + layer.b.toFixed(2) + "px)" : "none";
    var hl = !oneAtATime && st.highlightOn;
    words.forEach(function (w, wi) {
      var e = { o: 1, x: 0, y: 0, s: 1, b: 0 };
      if (oneAtATime) {
        w.el.style.display = wi === current ? "inline-block" : "none";
      } else if (anim.by === "cut") {
        e.o = t >= w.start ? 1 : 0;
      } else if (anim.by === "marker" || anim.by === "start" || anim.by === "stagger") {
        var t0 = anim.by === "marker" ? w.start : (anim.by === "start" ? words[0].start : words[0].start + wi * anim.frames / FPS);
        e = pieceState(anim, t, t0, F);
      }
      var on = hl && wi === current;
      var hs = on ? (st.highlightScale || 100) / 100 : 1;
      w.el.style.color = on ? st.highlight : "";
      w.el.style.opacity = String(e.o);
      w.el.style.transform = "translate(" + e.x.toFixed(2) + "px," + e.y.toFixed(2) + "px) scale(" + (e.s * hs).toFixed(4) + ")";
      w.el.style.filter = e.b > 0.05 ? "blur(" + e.b.toFixed(2) + "px)" : "none";
    });
    var charsOn = anim.by === "chars" && !oneAtATime;
    if (charsOn) {
      p.chars.forEach(function (c) {
        var e = pieceState(anim, t, words[0].start + c.j * anim.frames / FPS, F);
        c.el.style.opacity = String(e.o);
        c.el.style.transform = "translate(" + (e.x + e.track * 3).toFixed(2) + "px," + e.y.toFixed(2) + "px) rotate(" + e.r.toFixed(1) + "deg)";
        c.el.style.filter = e.b > 0.05 ? "blur(" + e.b.toFixed(2) + "px)" : "none";
      });
    } else if (p.charsAnimated) {
      p.chars.forEach(function (c) { c.el.style.opacity = ""; c.el.style.transform = ""; c.el.style.filter = ""; });
    }
    p.charsAnimated = charsOn;
  }

  // ---- Reels / Viral (canvas, same layout as AE)

  var measureCtx = document.createElement("canvas").getContext("2d");

  function measureRow(role, px, text) {
    measureCtx.font = canvasFont(role, px);
    var m = measureCtx.measureText(text);
    var track = (role.tracking || 0) / 1000 * px;
    var left = m.actualBoundingBoxLeft !== undefined ? -m.actualBoundingBoxLeft : 0;
    var width = (m.actualBoundingBoxRight !== undefined ? m.actualBoundingBoxRight - left : m.width) + track * Math.max(0, text.length - 1);
    var asc = m.actualBoundingBoxAscent !== undefined ? m.actualBoundingBoxAscent : px * 0.72;
    var desc = m.actualBoundingBoxDescent !== undefined ? m.actualBoundingBoxDescent : px * 0.2;
    return { left: left, top: -asc, width: width, height: asc + desc };
  }

  function sampleWords(P) {
    var words = [];
    var t = 0.3;
    P.sample.forEach(function (part, i) {
      String(part).split(" ").filter(Boolean).forEach(function (w) {
        words.push({ text: w, accent: i === 1, start: t });
        t += 0.22;
      });
    });
    return words;
  }

  function buildViral(p, P, key) {
    if (p.built === key) { return; }
    p.built = key;
    p.el.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.className = "cap-canvas";
    p.el.appendChild(canvas);
    p.canvas = canvas;
    var dpr = window.devicePixelRatio || 1;
    var w = p.el.clientWidth || 160;
    var h = p.el.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var shortSide = Math.min(w, h) * (p.opts.zoom || 1);
    var o = settings.viral.opts;
    var scale = p.opts.card ? 1 : clamp(o.scale || 100, 30, 300) / 100;
    var k = Math.min(w / 1080 * (p.opts.zoom || 1), shortSide / 1080) * scale;
    var W = 0.86 * w * (p.opts.zoom || 1) * scale;
    var palette = P.palette && P.palette.length ? P.palette : [{}];
    var accentRole = Object.assign({}, P.accent, palette[(p.opts.variant || 0) % palette.length]);
    var rows = CL.rows(sampleWords(P), P);
    rows.forEach(function (r) {
      r.roleObj = r.role === "accent" ? accentRole : P[r.role];
      r.size = r.roleObj.size * k;
      r.rect = measureRow(r.roleObj, r.size, r.text);
    });
    var lay = CL.layout(rows, P, Math.min(W, w * 0.94), h, k);
    var cy = h * 0.5;
    if (!p.opts.card) {
      if (o.position === "top") { cy = h * 0.3; } else if (o.position === "center") { cy = h * 0.5; } else if (o.position === "custom") { cy = h * o.posY / 100; } else { cy = h * (w > h ? 0.72 : 0.62); }
    }
    var cx = !p.opts.card && o.position === "custom" ? w * o.posX / 100 : w / 2;
    if (cy + lay.bottom > h * 0.96) { cy = h * 0.96 - lay.bottom; }
    if (cy + lay.top < h * 0.04) { cy = h * 0.04 - lay.top; }
    // per row: where every letter goes (x from the row's ink left, drawn at s = 1 size)
    rows.forEach(function (r) {
      var px = r.size * r.s;
      measureCtx.font = canvasFont(r.roleObj, px);
      var track = (r.roleObj.tracking || 0) / 1000 * px;
      r.px = px;
      r.track = track;
      r.chars = [];
      var text = r.text;
      for (var i = 0; i < text.length; i += 1) {
        r.chars.push({ ch: text[i], x: measureCtx.measureText(text.slice(0, i)).width + track * i });
      }
      // word index and width of every letter, and each word's span
      var wi = 0;
      r.spans = [];
      r.chars.forEach(function (c) {
        if (c.ch === " ") { wi += 1; }
        c.w = wi;
        c.width = measureCtx.measureText(c.ch).width;
        if (c.ch !== " ") {
          var sp = r.spans[wi] || (r.spans[wi] = { x0: c.x, x1: c.x + c.width });
          sp.x1 = c.x + c.width;
        }
      });
      r.inkLeft = r.rect.left * r.s;
      r.originX = cx + r.x - r.w / 2 - r.inkLeft;
      r.baseY = cy + r.y - r.h / 2 - r.rect.top * r.s;
      r.start = r.words[0].start;
    });
    p.viral = { rows: rows, P: P, lay: lay, cx: cx, cy: cy, shortSide: shortSide, w: w, h: h, dpr: dpr };
  }

  function fillStyleFor(ctx, r) {
    var role = r.roleObj;
    if (role.gradient) {
      var top = r.baseY + r.rect.top * r.s;
      var bottom = top + r.h;
      var g = role.gradient.diag ? ctx.createLinearGradient(r.originX + r.inkLeft, top, r.originX + r.inkLeft + r.w, bottom) : ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, role.gradient.top);
      g.addColorStop(1, role.gradient.bottom);
      return g;
    }
    return role.fill || "#ffffff";
  }

  function drawViral(p, now) {
    var P = p.opts.getPreset();
    var o = settings.viral.opts;
    var key = "viral|" + P.id + "|" + JSON.stringify(p.opts.card ? 0 : [o.position, o.posX, o.posY, o.scale]) + "|" + JSON.stringify(P.accent) + JSON.stringify(P.base) + "|" + (p.el.clientWidth) + "x" + (p.el.clientHeight);
    buildViral(p, P, key);
    var v = p.viral;
    var ctx = p.canvas.getContext("2d");
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    var anim = ANIM_BY[p.opts.getAnim()] || ANIM_BY.smooth;
    var t = (now / 1000) % LOOP;
    if (settings.viral.opts.backShadeOn && !p.opts.card) {
      var bw = v.lay.width * 1.3 * o.backShadeSize / 100;
      var bh = (v.lay.bottom - v.lay.top) * 1.5 * o.backShadeSize / 100;
      var grad = ctx.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, Math.max(bw, bh) / 2);
      grad.addColorStop(0, "rgba(0,0,0," + (o.backShadeOpacity / 100) + ")");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(v.cx, v.cy);
      ctx.scale(1, bh / Math.max(bw, bh));
      ctx.translate(-v.cx, -v.cy);
      ctx.fillStyle = grad;
      ctx.fillRect(v.cx - bw, v.cy - bw, bw * 2, bw * 2);
      ctx.restore();
    }
    v.rows.forEach(function (r) {
      var rowStart = anim.id === "slidePhrase" ? v.rows[0].start : r.start;
      if (t < rowStart) { return; }
      var layer = anim.by === "layer" ? layerState(anim.id, t, rowStart, v.shortSide) : { o: 1, y: 0, s: 1, b: 0 };
      var role = r.roleObj;
      var fill = fillStyleFor(ctx, r);
      var halos = role.outerGlow || [];
      var F = r.px;
      ctx.save();
      // whole-line transform around its ink center
      var cxr = v.cx + r.x;
      var cyr = v.cy + r.y;
      ctx.translate(cxr, cyr + layer.y);
      ctx.scale(layer.s, layer.s);
      ctx.translate(-cxr, -cyr);
      ctx.font = canvasFont(role, F);
      ctx.textBaseline = "alphabetic";
      r.chars.forEach(function (c, ci) {
        if (c.ch === " ") { return; }
        var word = r.words[c.w] || r.words[0];
        var e = { o: 1, x: 0, y: 0, s: 1, b: 0, r: 0, track: 0 };
        if (anim.by === "cut") {
          e.o = t >= word.start ? 1 : 0;
        } else if (anim.by === "marker") {
          e = pieceState(anim, t, word.start, F);
        } else if (anim.by === "start") {
          e = pieceState(anim, t, rowStart, F);
        } else if (anim.by === "stagger") {
          e = pieceState(anim, t, rowStart + c.w * anim.frames / FPS, F);
        } else if (anim.by === "chars") {
          var j = ci - c.w; // letters, not spaces
          e = pieceState(anim, t, rowStart + j * anim.frames / FPS, F);
        }
        var alpha = e.o * layer.o * (role.opacity !== undefined ? role.opacity / 100 : 1);
        if (alpha <= 0.002) { return; }
        var x = r.originX + c.x + e.x + e.track * ci;
        var y = r.baseY + e.y;
        ctx.save();
        ctx.globalAlpha = alpha;
        var blur = e.b + layer.b;
        if (blur > 0.3) { ctx.filter = "blur(" + blur.toFixed(1) + "px)"; }
        if (e.r || e.s !== 1) {
          // letters turn on themselves, words scale as a whole
          var span = r.spans[c.w] || { x0: c.x, x1: c.x + c.width };
          var pivotX = anim.by === "chars" ? x + c.width / 2 : r.originX + (span.x0 + span.x1) / 2 + e.x;
          var pivotY = y - F * 0.35;
          ctx.translate(pivotX, pivotY);
          ctx.rotate(e.r * Math.PI / 180);
          ctx.scale(e.s, e.s);
          ctx.translate(-pivotX, -pivotY);
        }
        halos.forEach(function (g) {
          ctx.shadowColor = hexToRgba(g.color, g.opacity / 100);
          ctx.shadowBlur = g.softness * (F / role.size) * 1.2;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = fill;
          ctx.fillText(c.ch, x, y);
        });
        if (role.shadow) {
          ctx.shadowColor = "rgba(0,0,0," + (role.shadow.opacity / 100) + ")";
          ctx.shadowBlur = role.shadow.softness * (F / role.size);
          ctx.shadowOffsetY = (role.shadow.distance || 0) * (F / role.size);
        }
        if (role.stroke && role.stroke.width) {
          ctx.lineWidth = role.stroke.width * (F / role.size) * 2;
          ctx.strokeStyle = role.stroke.color;
          ctx.strokeText(c.ch, x, y);
        }
        ctx.fillStyle = fill;
        ctx.fillText(c.ch, x, y);
        ctx.restore();
      });
      if (v.P.underline && r.part === "emph") {
        var prog = clamp((t - rowStart - 0.15) / 0.45, 0, 1);
        if (prog > 0) {
          var x0 = r.originX + r.inkLeft;
          var base = v.cy + r.y + r.h / 2;
          ctx.save();
          ctx.strokeStyle = "#ffffff";
          ctx.lineCap = "round";
          ctx.lineWidth = Math.max(1.2, 0.06 * v.lay.accentSize);
          ctx.beginPath();
          var steps = 24;
          for (var sI = 0; sI <= steps * easeOut(prog); sI += 1) {
            var u = sI / steps;
            var px = x0 - 0.02 * r.w + u * r.w * 1.04;
            var py = base + v.lay.accentSize * (0.12 - 0.04 * u - 0.05 * Math.sin(u * Math.PI));
            if (sI === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
          }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    });
  }

  function drawPreview(p, now) {
    if (p.opts.getMode() === "viral") { drawViral(p, now); } else { drawSimple(p, now); }
  }

  // Every section is on the page at once now: only draw the previews
  // scrolled into view and not inside a folded section.
  function onScreen(el, top, bottom) {
    if (el.offsetParent === null) { return false; }
    var r = el.getBoundingClientRect();
    if (r.bottom < top || r.top > bottom || r.height === 0) { return false; }
    var section = el.closest ? el.closest(".section") : null;
    return !(section && section.classList.contains("is-collapsed"));
  }

  var rafId = 0;
  function tick(now) {
    rafId = 0;
    if (!isVisible()) { return; }
    var box = $("captions-main").getBoundingClientRect();
    previews.forEach(function (p) {
      if (onScreen(p.el, box.top, box.bottom)) {
        try { drawPreview(p, now); } catch (e) {}
      }
    });
    rafId = window.requestAnimationFrame(tick);
  }
  function startPreviews() {
    if (!rafId) { rafId = window.requestAnimationFrame(tick); }
  }

  function isVisible() {
    var page = $("page-captions");
    var main = $("captions-main");
    return page && !page.hidden && main && !main.hidden && !document.hidden;
  }

  // ------------------------------------------------------------------ views
  // 02 Customize shows one part at a time (1 Style, 2 Animation,
  // 3 Highlight, 4 Adjust) so only a few previews run and the page stays
  // short.

  var view = "style";

  function setView(name) {
    view = name;
    $$(".cap-tab").forEach(function (tab) {
      var on = tab.getAttribute("data-view") === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".cap-view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== name; });
    if (name === "anim") { renderAnimGrid(); }
    if (name === "adjust" || name === "highlight") { loadFonts(); }
    renderControls();
    // keep the step buttons in sight when the page was scrolled past them
    var main = $("captions-main");
    var nav = document.querySelector(".cap-steps-nav");
    var top = nav.getBoundingClientRect().top - main.getBoundingClientRect().top;
    if (top < 0) { main.scrollTop += top - 8; }
    startPreviews();
  }

  // The Style / Animation buttons in 01 Generate: open 02 Customize if
  // it's folded, then that part.
  function goTo(name) {
    var section = document.querySelector('#captions-main .section[data-section-id="cap-steps"]');
    if (section && section.classList.contains("is-collapsed")) { section.querySelector(".section-tab").click(); }
    setView(name);
    var main = $("captions-main");
    var nav = document.querySelector(".cap-steps-nav");
    main.scrollTop += nav.getBoundingClientRect().top - main.getBoundingClientRect().top - 8;
  }

  function card(container, label, selected, onPick) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "cap-card" + (selected ? " is-selected" : "");
    var frame = document.createElement("div");
    frame.className = "cap-card-frame";
    el.appendChild(frame);
    var name = document.createElement("span");
    name.className = "cap-card-name";
    name.textContent = label;
    el.appendChild(name);
    el.addEventListener("click", onPick);
    container.appendChild(el);
    return frame;
  }

  var GROUPS = [
    { id: "reels", name: "Reels", hint: "one big highlighted word" },
    { id: "viral", name: "Viral", hint: "highlight with gradient and glow" },
    { id: "simple", name: "Simple", hint: "easy to read" }
  ];

  function pickStyle(mode, presetId) {
    settings.mode = mode;
    if (presetId) { settings.viral.preset = presetId; }
    save();
    renderStyleGrid();
    renderControls();
    if (mode === "viral") {
      ensureFonts(effectivePreset()).then(showFontsNote, fontsFailed);
    }
  }

  function renderStyleGrid() {
    var box = $("cap-style-groups");
    dropPreviews(box);
    $$("#cap-filter button").forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-group") === settings.group); });
    GROUPS.forEach(function (g) {
      if (settings.group !== "all" && settings.group !== g.id) { return; }
      var head = document.createElement("div");
      head.className = "cap-heading";
      head.innerHTML = g.name + " <small>" + g.hint + "</small>";
      box.appendChild(head);
      var grid = document.createElement("div");
      grid.className = "cap-grid";
      box.appendChild(grid);
      if (g.id === "simple") {
        SIMPLE.forEach(function (m) {
          var frame = card(grid, m.name, settings.mode === m.id, function (e) {
            pickStyle(m.id);
            if (e && e.shiftKey) { status("Shift+click restyles into the Reels and Viral styles.", "error"); }
          });
          makePreview(frame, { card: true, zoom: 1.7, getMode: function () { return m.id; }, getAnim: function () { return animOf(m.id); } });
        });
        return;
      }
      CS.STYLES.filter(function (s) { return s.group === g.id; }).forEach(function (s) {
        var frame = card(grid, s.name, isViral() && settings.viral.preset === s.id, function (e) {
          pickStyle("viral", s.id);
          if (e && e.shiftKey) { restyleSelection(); }
        });
        makePreview(frame, { card: true, zoom: 1, getMode: function () { return "viral"; }, getAnim: function () { return animOf("viral", s.id); }, getPreset: function () { return s; } });
      });
    });
  }

  function renderAnimGrid() {
    var grid = $("cap-anim-grid");
    dropPreviews(grid);
    $("cap-anim-hint").textContent = styleName() + " -- how the text comes in";
    var list = animsFor(settings.mode);
    if (isViral()) { list = list.filter(function (a) { return a.id !== "pop"; }); }
    list.forEach(function (a) {
      var frame = card(grid, a.name + (isViral() && a.id === preset().anim ? " · style's own" : ""), currentAnim() === a.id, function () {
        setCurrentAnim(a.id);
        save();
        renderAnimGrid();
        renderControls();
      });
      makePreview(frame, {
        card: true, zoom: isViral() ? 1 : 1.7,
        getMode: function () { return settings.mode; },
        getAnim: function () { return a.id; },
        getPreset: function () { return effectivePreset(); }
      });
    });
  }

  var bigPreviews = [];
  function renderBigPreviews() {
    bigPreviews = [];
    ["cap-adjust-preview", "cap-highlight-preview"].forEach(function (id) {
      var box = $(id);
      dropPreviews(box);
      var p = makePreview(box, {
        getMode: function () { return settings.mode; },
        getAnim: function () { return currentAnim(); },
        getPreset: function () { return effectivePreset(); }
      });
      p.el.style.aspectRatio = String(compAspect());
      bigPreviews.push(p);
    });
  }

  function compAspect() {
    var c = summary && summary.comp;
    return c && c.width && c.height ? c.width / c.height : 9 / 16;
  }

  // ------------------------------------------------------------------ controls

  function segmentedValue(id, value) {
    $$("#" + id + " .segmented-option").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-value") === value); });
  }

  function renderControls() {
    var m = model();
    var r = rules();
    var viral = isViral();
    $$("#captions-main [data-num]").forEach(function (input) {
      var key = input.getAttribute("data-num");
      if (!(key in m)) { return; }
      if (document.activeElement !== input) { input.value = m[key]; }
      var out = document.querySelector("#captions-main [data-out=\"" + key + "\"]");
      if (out) { out.textContent = Math.round(m[key]) + (out.getAttribute("data-unit") || ""); }
    });
    $$("#captions-main [data-bool]").forEach(function (b) { b.classList.toggle("is-on", !!m[b.getAttribute("data-bool")]); });
    $$("#captions-main [data-color]").forEach(function (input) { var key = input.getAttribute("data-color"); if (key in m) { input.value = m[key]; } });
    $$("#captions-main [data-show]").forEach(function (el) { el.hidden = !m[el.getAttribute("data-show")]; });
    $$("#captions-main [data-show-position]").forEach(function (el) { el.hidden = m.position !== el.getAttribute("data-show-position"); });
    $$("#captions-main [data-rule]").forEach(function (input) {
      if (document.activeElement !== input) { input.value = r[input.getAttribute("data-rule")]; }
    });
    $$("#captions-main [data-rule-bool]").forEach(function (b) { b.classList.toggle("is-on", !!r[b.getAttribute("data-rule-bool")]); });
    segmentedValue("cap-position", m.position);
    $$("#cap-position .segmented-option")[0].textContent = viral ? "Default" : "Bottom";
    segmentedValue("cap-case", style().textCase);
    segmentedValue("cap-justify", style().justify);
    segmentedValue("cap-range", settings.range);
    $("cap-lang").value = settings.lang;
    var word = settings.mode === "word";
    $("cap-look-controls").hidden = !viral;
    $("cap-highlight-controls").hidden = viral || word;
    $("cap-highlight-word-note").hidden = !word;
    $("cap-highlight-hint").textContent = viral ? "the highlighted word with your choices" : "the spoken word with your choices";
    $("cap-style-fold").hidden = viral;
    $("cap-shadow-toggle").textContent = viral ? "Soft drop shadow on every word (instead of the style's own)" : "Drop shadow";
    $("cap-pick-style").textContent = styleName();
    $("cap-pick-anim").textContent = (ANIM_BY[currentAnim()] || ANIM_BY.smooth).name;
    $("cap-adjust-hint").textContent = styleName() + " · " + (ANIM_BY[currentAnim()] || ANIM_BY.smooth).name;
    bigPreviews.forEach(function (p) { p.built = ""; p.el.style.aspectRatio = String(compAspect()); });
    renderFontPickers();
    updateGenerate();
  }

  function bindControls() {
    $$(".cap-tab").forEach(function (tab) { tab.addEventListener("click", function () { setView(tab.getAttribute("data-view")); }); });
    $$(".cap-picks [data-go]").forEach(function (b) { b.addEventListener("click", function () { goTo(b.getAttribute("data-go")); }); });
    $("cap-filter").addEventListener("click", function (event) {
      var b = event.target.closest ? event.target.closest("button") : null;
      if (!b) { return; }
      settings.group = b.getAttribute("data-group");
      save();
      renderStyleGrid();
    });
    $$("#captions-main [data-num]").forEach(function (input) {
      input.addEventListener("input", function () {
        var v = parseFloat(input.value);
        if (isNaN(v)) { return; }
        model()[input.getAttribute("data-num")] = v;
        save();
        renderControls();
      });
    });
    $$("#captions-main [data-bool]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-bool");
        model()[key] = !model()[key];
        save();
        renderControls();
      });
    });
    $$("#captions-main [data-color]").forEach(function (input) {
      input.addEventListener("input", function () {
        model()[input.getAttribute("data-color")] = input.value;
        save();
        renderControls();
      });
    });
    $$("#captions-main [data-rule]").forEach(function (input) {
      input.addEventListener("change", function () {
        settings.rules[settings.mode][input.getAttribute("data-rule")] = input.value === "" ? "" : parseFloat(input.value);
        save();
        renderControls();
      });
    });
    $$("#captions-main [data-rule-bool]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-rule-bool");
        settings.rules[settings.mode][key] = !rules()[key];
        save();
        renderControls();
      });
    });
    $("cap-position").addEventListener("click", function (event) {
      var b = event.target.closest ? event.target.closest(".segmented-option") : null;
      if (!b) { return; }
      model().position = b.getAttribute("data-value");
      save();
      renderControls();
    });
    [["cap-case", "textCase"], ["cap-justify", "justify"]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function (event) {
        var b = event.target.closest ? event.target.closest(".segmented-option") : null;
        if (!b) { return; }
        style()[pair[1]] = b.getAttribute("data-value");
        save();
        renderControls();
      });
    });
    $("cap-range").addEventListener("click", function (event) {
      var b = event.target.closest ? event.target.closest(".segmented-option") : null;
      if (!b) { return; }
      settings.range = b.getAttribute("data-value");
      save();
      renderControls();
      poll(true);
    });
    var lang = $("cap-lang");
    LANGS.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l[0];
      o.textContent = l[1];
      lang.appendChild(o);
    });
    lang.addEventListener("change", function () { settings.lang = lang.value; save(); });
    $("cap-style-reset").addEventListener("click", function () {
      var anim = style().anim;
      settings.styles[settings.mode] = defaultStyle(settings.mode);
      style().anim = anim;
      save();
      renderControls();
    });
    $("cap-look-reset").addEventListener("click", function () {
      var o = settings.viral.opts;
      ["colorOn", "color", "gradientOn", "gradTop", "gradBottom", "glowOn", "glowColor", "glowAmt", "glowSize", "sweepOn",
        "accentFamily", "accentStyle", "accentFont", "smallFamily", "smallStyle", "smallFont"].forEach(function (k) { o[k] = VIRAL_OPTS[k]; });
      save();
      renderControls();
    });
    $("cap-rules-reset").addEventListener("click", function () {
      settings.rules[settings.mode] = {};
      save();
      renderControls();
    });
    bindFontPicker("cap-font-family", "cap-font-style", function () { var s = style(); return { family: s.family, style: s.fontStyle, font: s.font }; },
      function (f) { var s = style(); s.family = f.family; s.fontStyle = f.style; s.font = f.font; });
    bindFontPicker("cap-acc-family", "cap-acc-style", function () {
      var o = settings.viral.opts;
      var a = preset().accent;
      return o.accentFont ? { family: o.accentFamily, style: o.accentStyle, font: o.accentFont } : { family: a.family, style: a.style, font: a.font };
    }, function (f) { var o = settings.viral.opts; o.accentFamily = f.family; o.accentStyle = f.style; o.accentFont = f.font; });
    bindFontPicker("cap-small-family", "cap-small-style", function () {
      var o = settings.viral.opts;
      var b = preset().base;
      return o.smallFont ? { family: o.smallFamily, style: o.smallStyle, font: o.smallFont } : { family: b.family, style: b.style, font: b.font };
    }, function (f) { var o = settings.viral.opts; o.smallFamily = f.family; o.smallStyle = f.style; o.smallFont = f.font; });
    $("cap-generate").addEventListener("click", generate);
    $("cap-cancel").addEventListener("click", cancel);
    $("cap-import-srt").addEventListener("click", function () {
      $("cap-import-srt-input").value = "";
      $("cap-import-srt-input").click();
    });
    $("cap-import-srt-input").addEventListener("change", function () {
      var f = $("cap-import-srt-input").files && $("cap-import-srt-input").files[0];
      if (f) { importSrt(f); }
    });
  }

  // ------------------------------------------------------------------ font pickers

  var fonts = null;
  var fontsAsked = false;
  var fontPickers = [];

  function loadFonts() {
    if (fontsAsked) { return; }
    fontsAsked = true;
    bridge.hostCall("getCaptionFonts", [], function (r) {
      fonts = r && r.families ? r.families : [];
      // the bundled fonts are always offered, installed or not
      Object.keys(CS.FONT_FULL_NAMES).forEach(function (ps) {
        var m = /^(.*?) ((?:Medium|SemiBold|Bold|ExtraBold|Black|Regular|Italic)(?: Italic)?)$/.exec(CS.FONT_FULL_NAMES[ps]);
        if (!m) { return; }
        var fam = familyByName(m[1]);
        if (!fam) { fam = { f: m[1], s: [] }; fonts.push(fam); }
        if (!fam.s.some(function (s) { return s[1] === ps; })) { fam.s.push([m[2], ps]); }
      });
      fonts.sort(function (a, b) { return a.f.toLowerCase() < b.f.toLowerCase() ? -1 : 1; });
      fontPickers.forEach(function (fp) {
        var sel = $(fp.familyId);
        sel.innerHTML = "";
        fonts.forEach(function (fam) {
          var o = document.createElement("option");
          o.value = fam.f;
          o.textContent = fam.f;
          sel.appendChild(o);
        });
      });
      renderFontPickers();
    });
  }
  function familyByName(name) {
    if (!fonts) { return null; }
    for (var i = 0; i < fonts.length; i += 1) { if (fonts[i].f === name) { return fonts[i]; } }
    return null;
  }
  function bindFontPicker(familyId, styleId, get, set) {
    fontPickers.push({ familyId: familyId, styleId: styleId, get: get });
    $(familyId).addEventListener("change", function () {
      var fam = familyByName($(familyId).value);
      if (!fam) { return; }
      var pick = fam.s.filter(function (s) { return /^bold$/i.test(s[0]); })[0] || fam.s[0];
      set({ family: fam.f, style: pick[0], font: pick[1] });
      save();
      renderControls();
    });
    $(styleId).addEventListener("change", function () {
      var cur = get();
      var fam = familyByName(cur.family);
      var pick = fam && fam.s.filter(function (s) { return s[1] === $(styleId).value; })[0];
      if (!pick) { return; }
      set({ family: fam.f, style: pick[0], font: pick[1] });
      save();
      renderControls();
    });
  }
  function renderFontPickers() {
    if (!fonts) { return; }
    fontPickers.forEach(function (fp) {
      var cur = fp.get();
      var famSel = $(fp.familyId);
      if (!familyByName(cur.family) && !famSel.querySelector("option[value=\"" + cur.family.replace(/"/g, "") + "\"]")) {
        var o = document.createElement("option");
        o.value = cur.family;
        o.textContent = cur.family + " (not installed)";
        famSel.appendChild(o);
      }
      famSel.value = cur.family;
      var sel = $(fp.styleId);
      var fam = familyByName(cur.family);
      sel.innerHTML = "";
      (fam ? fam.s : [[cur.style, cur.font]]).forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s[1];
        opt.textContent = s[0];
        sel.appendChild(opt);
      });
      sel.value = cur.font;
    });
  }

  // ------------------------------------------------------------------ comp status pill

  var summary = null;
  var busy = false;

  function poll(force) {
    if (busy || (!force && !isVisible())) { return; }
    bridge.hostCall("getCaptionsSummary", [settings.range], function (r) {
      var before = compAspect();
      summary = r && r.ok ? r : null;
      renderPill();
      updateGenerate();
      if (before !== compAspect()) { bigPreviews.forEach(function (p) { p.built = ""; p.el.style.aspectRatio = String(compAspect()); }); }
    });
  }

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  // What will be transcribed (or why not), in one line under Generate.
  function renderPill() {
    updateGenerate();
  }

  function targetText() {
    if (!summary || !summary.comp) { return "Open a composition"; }
    if (!summary.target) { return summary.error || "Select a layer with sound, or nothing to transcribe the whole comp."; }
    return (summary.target.isLayer ? "Layer “" + summary.target.label + "”" : "Whole comp “" + summary.target.label + "”") +
      " · " + fmtTime(summary.target.end - summary.target.start);
  }

  function updateGenerate() {
    var ready = !!(summary && summary.target) && !busy;
    var hint = $("cap-hint");
    $("cap-generate").disabled = !ready;
    hint.textContent = busy ? "" : targetText();
    hint.title = hint.textContent;
    hint.classList.toggle("is-warn", !busy && !ready);
  }

  // ------------------------------------------------------------------ processing UI

  var STEPS = ["audio", "transcribe", "sync", "layers", "finish"];
  var procStart = 0;
  var procTimer = null;
  var procMessage = "";
  var job = null; // { dir, shortDir, child, cancelled }

  function showProc(title, from) {
    busy = true;
    $("captions-main").classList.add("is-processing");
    $("cap-proc").hidden = false;
    $("cap-proc-title").textContent = title;
    $("cap-cancel").disabled = false;
    $("cap-cancel").textContent = "Cancel";
    $$("#cap-steps li").forEach(function (li) {
      li.className = "";
      li.hidden = STEPS.indexOf(li.getAttribute("data-step")) < STEPS.indexOf(from);
      li.removeAttribute("data-pct");
    });
    procStart = Date.now();
    procMessage = "";
    clearInterval(procTimer);
    procTimer = setInterval(renderNote, 1000);
    renderNote();
    updateGenerate();
  }

  function renderNote() {
    $("cap-proc-note").textContent = (procMessage ? procMessage + " · " : "") + "Time: " + fmtTime((Date.now() - procStart) / 1000);
  }

  function note(message) {
    procMessage = message || "";
    renderNote();
  }

  // fraction 0..1 when the step reports real progress, null when it can't
  function step(name, fraction) {
    var at = STEPS.indexOf(name);
    $$("#cap-steps li").forEach(function (li) {
      var i = STEPS.indexOf(li.getAttribute("data-step"));
      li.classList.toggle("is-done", i < at);
      li.classList.toggle("is-active", i === at);
      if (i === at && typeof fraction === "number") { li.setAttribute("data-pct", Math.round(fraction * 100) + "%"); } else { li.removeAttribute("data-pct"); }
    });
    $("cap-bar").classList.toggle("is-indeterminate", typeof fraction !== "number");
    if (typeof fraction === "number") { $("cap-bar-fill").style.width = Math.round(fraction * 100) + "%"; }
  }

  function hideProc() {
    busy = false;
    clearInterval(procTimer);
    $("captions-main").classList.remove("is-processing");
    $("cap-proc").hidden = true;
    poll(true);
    updateGenerate();
  }

  function cancel() {
    if (!busy || !job) { return; }
    job.cancelled = true;
    $("cap-cancel").disabled = true;
    $("cap-cancel").textContent = "Cancelling…";
    if (job.child) {
      try { job.child.kill(); } catch (e) {}
    } else {
      note("Waiting for After Effects to finish the current step");
    }
  }

  function cancelled() {
    var e = new Error("Cancelled.");
    e.cancelled = true;
    return e;
  }

  // ------------------------------------------------------------------ generate

  function newJob() {
    var fs = bridge.nodeRequire("fs");
    var path = bridge.nodeRequire("path");
    var dir = path.join(bridge.paths().tempDir, "job-" + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    job = { dir: dir, child: null, cancelled: false };
    return bridge.toShortPath(dir).then(function (shortDir) {
      job.shortDir = shortDir;
      return job;
    });
  }

  function endJob() {
    if (!job) { return; }
    try { bridge.nodeRequire("fs").rmSync(job.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch (e) {}
    job = null;
  }

  function hostP(name, args) {
    return new Promise(function (resolve, reject) {
      bridge.hostCall(name, args, function (r) {
        if (!r || !r.ok) { reject(new Error((r && r.error) || "No answer from After Effects.")); return; }
        resolve(r);
      });
    });
  }

  // whisper's -dtw needs the alignment-head preset of the model in use,
  // named like the model file: ggml-small.bin -> "small",
  // ggml-large-v3.bin -> "large.v3", ggml-base.en.bin -> "base.en".
  function whisperDtwPreset(modelPath) {
    var m = /ggml-([a-z0-9.\-]+?)(-q\d_\d)?\.bin$/i.exec(String(modelPath));
    return m ? m[1].toLowerCase().replace(/-v(\d)/, ".v$1") : "";
  }

  function whisperThreads() {
    var cpus = (bridge.nodeRequire("os").cpus() || []).length || 4;
    return Math.max(1, Math.min(8, cpus - 1)); // leave a core to After Effects
  }

  // whisper-cli, killable (Cancel). Like runCommand in panel.js it waits
  // for "exit", not "close": in this CEP's Node the pipes never close.
  function runWhisper(args, onProgress) {
    var p = bridge.paths();
    return Promise.all([bridge.toShortPath(p.whisperExe), bridge.toShortPath(p.modelPath)]).then(function (exe) {
      var full = ["-m", exe[1]].concat(args);
      var dtw = whisperDtwPreset(p.modelPath);
      if (dtw) { full.push("-dtw", dtw, "-nfa"); } // token times need flash attention off
      return new Promise(function (resolve, reject) {
        var child = bridge.nodeRequire("child_process").spawn(exe[0], full, { windowsHide: true });
        job.child = child;
        var tail = "";
        if (child.stderr) {
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", function (chunk) {
            tail = (tail + chunk).slice(-3000);
            var re = /progress\s*=\s*(\d+)%/g;
            var last = null;
            var hit;
            while ((hit = re.exec(chunk))) { last = hit; }
            if (last && onProgress) { onProgress(+last[1] / 100); }
          });
        }
        if (child.stdout) { child.stdout.on("data", function () {}); }
        child.on("error", function (e) { job.child = null; reject(e); });
        child.on("exit", function (code) {
          job.child = null;
          if (job.cancelled) { reject(cancelled()); return; }
          if (code !== 0) { reject(new Error("The speech engine stopped with an error (code " + code + "). " + tail.slice(-300))); return; }
          resolve();
        });
      });
    });
  }

  function check() {
    if (job.cancelled) { throw cancelled(); }
  }

  // Panel colors -> engine colors (#hex -> [r, g, b] 0-1), deep.
  function engineColors(o) {
    if (Array.isArray(o)) { return o.map(engineColors); }
    if (o && typeof o === "object") {
      var out = {};
      for (var k in o) { out[k] = engineColors(o[k]); }
      return out;
    }
    if (typeof o === "string" && /^#[0-9a-f]{6}$/i.test(o)) {
      var n = parseInt(o.slice(1), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    return o;
  }

  // Timed words (comp time) -> the captions the current style needs.
  function captionsFor(words, r) {
    var caps = core.offsetCaptions(core.buildCaptions(words, r), r);
    return isViral() ? core.planHighlights(caps, effectivePreset()) : caps;
  }

  // Captions ready -> layers in AE, in the comp compId. `replace` = ids
  // of layers the new captions take the place of (restyling).
  function createLayers(captions, compId, replace) {
    var payload = { setId: Date.now().toString(36), compId: compId, mode: settings.mode, anim: currentAnim(), extDir: extensionDir() };
    if (replace && replace.length) { payload.replace = replace; }
    if (isViral()) {
      var o = settings.viral.opts;
      payload.preset = engineColors(effectivePreset());
      payload.place = { position: o.position === "bottom" ? "auto" : o.position, posX: o.posX, posY: o.posY, scale: o.scale };
      payload.shade = { backShadeOn: o.backShadeOn, backShadeOpacity: o.backShadeOpacity, backShadeSize: o.backShadeSize };
    } else {
      payload.style = engineColors(style());
    }
    payload.captions = captions.map(function (c) {
      return {
        start: c.start, end: c.end, text: c.text, variant: c.variant || 0,
        words: c.words.map(function (w) { return { text: w.text, start: w.start, end: w.end, accent: !!w.accent }; })
      };
    });
    var file = bridge.nodeRequire("path").join(job.shortDir, "payload.json");
    bridge.nodeRequire("fs").writeFileSync(file, JSON.stringify(payload), "utf8");
    return hostP("createCaptionSet", [file]);
  }

  function finishOk(r) {
    step("finish", null);
    endJob();
    hideProc();
    var what = r.created + " caption" + (r.created === 1 ? "" : "s") + " (" + styleName() + " · " + (ANIM_BY[currentAnim()] || ANIM_BY.smooth).name + ")";
    status((r.replaced ? "Restyled into " : "Created ") + what + ".", "success");
    if (r.missingFonts && r.missingFonts.length) { showFontsNote(r.missingFonts); }
  }

  function finishError(error) {
    var wasCancelled = (error && error.cancelled) || (job && job.cancelled);
    endJob();
    hideProc();
    status(wasCancelled ? "Cancelled -- nothing was created." : String((error && error.message) || error), wasCancelled ? "" : "error");
  }

  function generate() {
    if (busy || !summary || !summary.target) { return; }
    var fs = bridge.nodeRequire("fs");
    var path = bridge.nodeRequire("path");
    var p = bridge.paths();
    if (!fs.existsSync(p.whisperExe) || !fs.existsSync(p.modelPath) || !fs.existsSync(p.ffmpegExe)) {
      status("The transcription tools are missing -- reopen the Captions tab to set them up.", "error");
      return;
    }
    var label = summary.target.label;
    var rendered = null;
    var activity = null;
    var duration = 0;
    showProc("Generating captions", "audio");
    step("audio", null);
    note("After Effects is rendering the audio of “" + label + "”");
    (isViral() ? ensureFonts(effectivePreset()).then(showFontsNote, fontsFailed) : Promise.resolve()).then(newJob).then(function () {
      return hostP("renderCaptionsAudio", [path.join(job.shortDir, "audio"), settings.range]);
    }).then(function (r) {
      rendered = r;
      check();
      note("Converting the audio");
      var wav = path.join(job.shortDir, "audio16k.wav");
      return bridge.runCommand(p.ffmpegExe, ["-nostdin", "-y", "-i", r.file, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeout: 10 * 60 * 1000 }).then(function () {
        check();
        var w = core.readWav16(new Uint8Array(fs.readFileSync(wav)));
        duration = w.samples.length / w.rate;
        activity = core.speechActivity(w.samples, w.rate);
        if (core.isSilent(activity)) { throw new Error("No sound found in “" + label + "” -- nothing to transcribe."); }
        step("transcribe", 0);
        note("Speech recognition on your computer");
        return runWhisper(["-f", wav, "-l", settings.lang || "auto", "-t", String(whisperThreads()), "-ojf", "-of", path.join(job.shortDir, "result"), "-pp"], function (f) { step("transcribe", f); });
      });
    }).then(function () {
      check();
      step("sync", null);
      note("");
      var json = JSON.parse(fs.readFileSync(path.join(job.dir, "result.json"), "utf8"));
      var r = rules();
      var words = core.prepareWords(core.cleanWords(core.wordsFromWhisper(json), activity, duration), r, isViral() ? "none" : style().textCase);
      if (!words.length) { throw new Error("No speech recognized in “" + label + "”."); }
      words.forEach(function (w) { w.start += rendered.start; w.end += rendered.start; });
      var captions = captionsFor(words, r);
      step("layers", null);
      note(captions.length + " captions");
      return createLayers(captions, rendered.compId);
    }).then(finishOk).catch(finishError);
  }

  // ------------------------------------------------------------------ restyle
  // Shift+click a Reels / Viral style: the captions selected in the
  // timeline (made by the panel, or any text layer) are rebuilt in that
  // style from their own words and times -- no new transcription -- and
  // the old layers are removed (host: getSelectedCaptionWords, then
  // createCaptionSet with `replace`, one undo step). Each old caption
  // becomes one new caption; a long one may be cut in two by the style's
  // rules (planHighlights), as when generating.

  function restyleSelection() {
    if (busy) { return; }
    showProc("Restyling captions", "layers");
    step("layers", null);
    note("Reading the selected captions");
    ensureFonts(effectivePreset()).then(showFontsNote, fontsFailed).then(newJob).then(function () {
      return hostP("getSelectedCaptionWords", []);
    }).then(function (r) {
      check();
      var replace = [];
      var caps = r.captions.map(function (c) {
        replace = replace.concat(c.ids);
        var words = c.words.map(function (w, i) {
          var next = i + 1 < c.words.length ? c.words[i + 1].start : c.end;
          return { text: w.text, start: w.start, end: Math.max(w.start + 0.04, next), eos: /[.!?…]$/.test(w.text), comma: /[,;:]$/.test(w.text) };
        });
        return { start: c.start, end: c.end, text: words.map(function (w) { return w.text; }).join(" "), words: words };
      });
      note(caps.length + " captions");
      return createLayers(core.planHighlights(caps, effectivePreset()), r.compId, replace);
    }).then(finishOk).catch(finishError);
  }

  // ------------------------------------------------------------------ SRT

  function srtTime(raw) {
    var m = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(raw);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / Math.pow(10, m[4].length) : null;
  }

  // Cues keep their exact times and line breaks; the words inside share
  // the cue's time by their length (for the word markers).
  function parseSrt(text) {
    var blocks = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    var cues = [];
    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim() !== ""; });
      var i = /^\d+$/.test((lines[0] || "").trim()) ? 1 : 0;
      var m = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-+>\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/.exec(lines[i] || "");
      if (!m) { return; }
      var start = srtTime(m[1]);
      var end = srtTime(m[2]);
      var textLines = lines.slice(i + 1).map(function (l) { return l.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim(); }).filter(Boolean);
      if (start === null || end === null || end <= start || !textLines.length) { return; }
      cues.push({ start: start, end: end, lines: textLines });
    });
    return cues;
  }

  function captionsFromCues(cues) {
    var textCase = isViral() ? "none" : style().textCase;
    var caps = cues.map(function (cue) {
      var lines = cue.lines.map(function (l) { return core.applyCase(l, textCase); });
      var words = lines.join(" ").split(/\s+/).filter(Boolean);
      var total = 0;
      words.forEach(function (w) { total += w.length + 1; });
      var t = cue.start;
      return {
        start: cue.start,
        end: cue.end,
        text: lines.join("\r"),
        words: words.map(function (w) {
          var d = (cue.end - cue.start) * (w.length + 1) / total;
          var word = { text: w, start: t, end: t + d, eos: /[.!?…]$/.test(w) };
          t += d;
          return word;
        })
      };
    });
    return isViral() ? core.planHighlights(caps, effectivePreset()) : caps;
  }

  function importSrt(file) {
    if (busy) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      var cues = parseSrt(reader.result);
      var compId = summary && summary.comp ? summary.comp.id : null;
      if (!cues.length) { status("Couldn't find any subtitles in that file.", "error"); return; }
      showProc("Importing subtitles", "layers");
      step("layers", null);
      note(cues.length + " subtitles");
      (isViral() ? ensureFonts(effectivePreset()).then(showFontsNote, fontsFailed) : Promise.resolve()).then(newJob).then(function () {
        return createLayers(captionsFromCues(cues), compId);
      }).then(finishOk).catch(finishError);
    };
    reader.onerror = function () { status("Couldn't read that file.", "error"); };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------ start

  load();
  loadBundledFonts();
  bindControls();
  renderStyleGrid();
  renderBigPreviews();
  setView("style");
  poll(true);
  setInterval(function () { poll(false); }, 1500);
  document.addEventListener("visibilitychange", startPreviews);
  $$(".page-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { setTimeout(function () { poll(true); startPreviews(); }, 50); });
  });
  // the setup screen swaps to #captions-main once the tools are in place
  new MutationObserver(function () { poll(true); startPreviews(); }).observe($("captions-main"), { attributes: true, attributeFilter: ["hidden"] });
  // previews start/stop with the scroll position and folding sections
  $("captions-main").addEventListener("scroll", startPreviews);
  $("captions-main").addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".section-tab")) { setTimeout(startPreviews, 260); }
  });
}());
