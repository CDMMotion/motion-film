/*
 * Mótion Film — shared client core (window.MF)
 *
 * Code shared between the main panel (panel.js) and the satellite
 * windows (palette.js, ...). Every satellite is a SEPARATE CEP extension
 * with its own origin/localStorage, so this file only holds behaviour
 * that is genuinely identical everywhere: the colour maths helpers
 * (MF.color.*), the colour-picker entry point (MF.initColorPicker) and
 * the on-disk user-data store below.
 *
 * Load this with a plain <script> BEFORE the window's own script.
 */
(function () {
  "use strict";

  window.MF = window.MF || {};

  // ---------------------------------------------------------------
  // Range sliders (styles.css "Range sliders"): the filled part of the
  // track is drawn up to --p. Kept current on every drag, every value
  // set from code (the input value setter is wrapped once, for ranges
  // only) and for sliders the code never touched (first hover / load).
  // ---------------------------------------------------------------
  (function rangeFill() {
    function paint(el) {
      var min = el.min === "" ? 0 : Number(el.min);
      var max = el.max === "" ? 100 : Number(el.max);
      var p = max > min ? (Number(el.value) - min) / (max - min) * 100 : 0;
      el.style.setProperty("--p", Math.max(0, Math.min(100, p)).toFixed(2) + "%");
    }
    function isRange(el) { return el && el.tagName === "INPUT" && el.type === "range"; }
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (desc && desc.set) {
      Object.defineProperty(HTMLInputElement.prototype, "value", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          desc.set.call(this, v);
          if (this.type === "range") { paint(this); }
        }
      });
    }
    document.addEventListener("input", function (e) { if (isRange(e.target)) { paint(e.target); } }, true);
    document.addEventListener("pointerover", function (e) { if (isRange(e.target)) { paint(e.target); } }, true);
    function paintAll() { Array.prototype.forEach.call(document.querySelectorAll("input[type=\"range\"]"), paint); }
    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", paintAll); } else { paintAll(); }
    window.addEventListener("load", paintAll);
  }());

  // ---------------------------------------------------------------
  // User data ON DISK (v0.9.7). CEP keeps localStorage in a TEMP cache
  // folder keyed by the AE version (%TEMP%\cep_cache\AEFT_26.5_<id>), so
  // an AE update or a disk cleanup silently wiped colours, palettes and
  // presets. Every "motionfilm-*" / "mfl-*" key is mirrored into
  //
  //   Documents/Mótion Film Packs/settings.json
  //     { version, values: { key: string }, migrated: { extensionId: true } }
  //
  // next to the pack library. Updating the extension (the installer
  // replaces its whole folder), updating AE, or copying that Documents
  // folder to another machine keeps everything.
  //
  // localStorage stays the fast copy, so call sites don't change: at load
  // the file is poured into localStorage (the file wins), and setItem /
  // removeItem on tracked keys write through. Each window is its own
  // origin, so the first time a window runs this it migrates its own
  // existing localStorage into the file (main panel = owner of shared
  // keys like the theme; satellites only fill keys still missing).
  // Writes re-read the file and merge one key, because 4 windows share it.
  // ---------------------------------------------------------------
  (function initUserDataStore() {
    var req = window.cep_node && window.cep_node.require;
    var storage = null;
    try { storage = window.localStorage; } catch (storageError) {}
    if (!req || !storage || !window.Storage) {
      return;
    }
    var fs, path, file;
    try {
      fs = req("fs");
      path = req("path");
      var docs = decodeURIComponent(String(window.__adobe_cep__.getSystemPath("myDocuments")).replace(/^file:\/+/, ""));
      if (docs && !/^[A-Za-z]:/.test(docs)) {
        docs = "/" + docs; // macOS
      }
      if (!docs) {
        docs = path.join(req("os").homedir(), "Documents");
      }
      file = path.join(path.normalize(docs), "Mótion Film Packs", "settings.json");
    } catch (setupError) {
      return;
    }

    function tracked(key) {
      return /^(motionfilm-|mfl-)/.test(String(key));
    }

    // null = couldn't read right now (locked) -- never write over it then.
    function readStore() {
      for (var attempt = 0; attempt < 3; attempt += 1) {
        try {
          var parsed = JSON.parse(fs.readFileSync(file, "utf8"));
          if (parsed && typeof parsed === "object" && parsed.values && typeof parsed.values === "object") {
            parsed.migrated = parsed.migrated || {};
            return parsed;
          }
          throw new SyntaxError("bad shape");
        } catch (readError) {
          if (readError && readError.code === "ENOENT") {
            return { version: 1, values: {}, migrated: {} };
          }
          if (readError instanceof SyntaxError) {
            // Corrupt (e.g. edited by hand): keep a copy, start over.
            try { fs.renameSync(file, file.replace(/\.json$/, "") + ".broken-" + Date.now() + ".json"); } catch (backupError) {}
            return { version: 1, values: {}, migrated: {} };
          }
        }
      }
      return null;
    }

    function writeStore(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      var tmp = file + "." + Date.now() + "-" + Math.random().toString(36).slice(2) + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
      try {
        fs.renameSync(tmp, file);
      } catch (renameError) {
        // Another window has it open -- plain overwrite instead.
        fs.writeFileSync(file, JSON.stringify(data, null, 1), "utf8");
        try { fs.unlinkSync(tmp); } catch (cleanupError) {}
      }
    }

    var extensionId = "";
    try { extensionId = window.__adobe_cep__.getExtensionId(); } catch (idError) {}

    var data = readStore();
    if (!data) {
      return; // file locked at load: run on plain localStorage this time
    }
    var i, key;
    if (!data.migrated[extensionId]) {
      var isOwner = extensionId === "com.motionfilm.app";
      for (i = 0; i < storage.length; i += 1) {
        key = storage.key(i);
        if (tracked(key) && (isOwner || !Object.prototype.hasOwnProperty.call(data.values, key))) {
          data.values[key] = storage.getItem(key);
        }
      }
      data.migrated[extensionId] = true;
      try { writeStore(data); } catch (migrateError) {}
    }

    // File -> localStorage (tracked keys the file doesn't have were removed).
    var stale = [];
    for (i = 0; i < storage.length; i += 1) {
      key = storage.key(i);
      if (tracked(key) && !Object.prototype.hasOwnProperty.call(data.values, key)) {
        stale.push(key);
      }
    }
    stale.forEach(function (k) { storage.removeItem(k); });
    Object.keys(data.values).forEach(function (k) {
      if (storage.getItem(k) !== data.values[k]) {
        storage.setItem(k, data.values[k]);
      }
    });

    var known = {};
    Object.keys(data.values).forEach(function (k) { known[k] = data.values[k]; });

    function persist(k, value) {
      if (known[k] === value) {
        return; // unchanged (colour pickers fire on every move)
      }
      var current = readStore();
      if (!current) {
        return;
      }
      if (value === null) {
        delete current.values[k];
      } else {
        current.values[k] = value;
      }
      try {
        writeStore(current);
        known[k] = value;
      } catch (writeError) {}
    }

    var proto = window.Storage.prototype;
    var nativeSet = proto.setItem;
    var nativeRemove = proto.removeItem;
    proto.setItem = function (k, value) {
      nativeSet.call(this, k, value);
      if (this === storage && tracked(k)) {
        persist(String(k), String(value));
      }
    };
    proto.removeItem = function (k) {
      nativeRemove.call(this, k);
      if (this === storage && tracked(k)) {
        persist(String(k), null);
      }
    };

    window.MF.userDataFile = file;
  })();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ---------------------------------------------------------------
  // Colour maths
  // ---------------------------------------------------------------

  function hexToRgb255(hex) {
    var clean = String(hex).replace("#", "");
    if (clean.length === 3) {
      clean = clean.charAt(0) + clean.charAt(0) + clean.charAt(1) + clean.charAt(1) + clean.charAt(2) + clean.charAt(2);
    }
    return {
      r: parseInt(clean.substring(0, 2), 16) || 0,
      g: parseInt(clean.substring(2, 4), 16) || 0,
      b: parseInt(clean.substring(4, 6), 16) || 0
    };
  }

  function rgb255ToHex(r, g, b) {
    function byte(v) {
      var s = Math.round(clamp(v, 0, 255)).toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + byte(r) + byte(g) + byte(b);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) { h = ((g - b) / d) % 6; }
      else if (max === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60;
      if (h < 0) { h += 360; }
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  function hsvToRgb(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  function normalizeHexInput(value) {
    var v = String(value).trim().replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(v)) {
      v = v.charAt(0) + v.charAt(0) + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2);
    }
    return /^[0-9a-fA-F]{6}$/.test(v) ? "#" + v.toLowerCase() : null;
  }

  // hex "#rrggbb" <-> [r,g,b] in 0..1 (After Effects colour space).
  function hexToRgb01(hex) {
    var rgb = hexToRgb255(hex);
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  }

  // Blend two "#rrggbb" colours in linear RGB. t = 0 -> a, t = 1 -> b.
  function mixHex(a, b, t) {
    var ca = hexToRgb255(a);
    var cb = hexToRgb255(b);
    var k = clamp(Number(t) || 0, 0, 1);
    return rgb255ToHex(
      ca.r + (cb.r - ca.r) * k,
      ca.g + (cb.g - ca.g) * k,
      ca.b + (cb.b - ca.b) * k
    );
  }

  // The appearance settings only let the user pick ONE surface tone --
  // the panel background. Every "box" in the UI (section cards, rows,
  // fields, popovers, the inset wells) is painted from a small family of
  // shades derived from that one colour here, so they all track it:
  //   --panel        the picked background, as-is
  //   --panel-soft   a hair lighter  -- inner rows / secondary fills
  //   --panel-raised a step lighter  -- section cards / "windows"
  //   --panel-deep   darker          -- recessed wells (curve editor, footer)
  // The lighter steps are kept small on purpose -- the cards should read
  // as barely-lifted, not as a different colour from the background
  // (user feedback: the first pass was too contrasty, especially on a
  // near-black background where a fixed % of the way to white is a big
  // absolute jump). Tints are still proportional so they hold up whether
  // the background is near-black or lifted.
  function panelShades(panelHex) {
    var base = normalizeHexInput(panelHex) || "#212121";
    return {
      panel: base,
      soft: mixHex(base, "#ffffff", 0.02),
      raised: mixHex(base, "#ffffff", 0.04),
      deep: mixHex(base, "#000000", 0.28)
    };
  }

  // Write the whole --panel* family onto a CSSStyleDeclaration (usually
  // document.documentElement.style). Used by both the main panel and the
  // palette satellite so their theming stays identical.
  function applyPanelShades(rootStyle, panelHex) {
    var s = panelShades(panelHex);
    rootStyle.setProperty("--panel", s.panel);
    rootStyle.setProperty("--panel-soft", s.soft);
    rootStyle.setProperty("--panel-raised", s.raised);
    rootStyle.setProperty("--panel-deep", s.deep);
  }

  // Default accent of every panel (user request 2026-10: green instead of
  // the old purple #9f7aea). A colour the user picked is kept.
  var DEFAULT_ACCENT = "#00f011";

  // Write the accent family: --accent / --accent-bright (same colour),
  // --accent-rgb ("r, g, b" for the translucent tints, rgba(var(--accent-rgb), .16))
  // and --accent-ink (text on an accent fill: dark on bright accents).
  function applyAccent(rootStyle, accentHex) {
    var hex = normalizeHexInput(accentHex) || DEFAULT_ACCENT;
    var c = hexToRgb255(hex);
    var luma = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    rootStyle.setProperty("--accent", hex);
    rootStyle.setProperty("--accent-bright", hex);
    rootStyle.setProperty("--accent-rgb", c.r + ", " + c.g + ", " + c.b);
    rootStyle.setProperty("--accent-ink", luma > 0.6 ? "#111111" : "#ffffff");
  }

  function rgb01ToHex(rgb) {
    return rgb255ToHex(
      Math.round(clamp(Number(rgb[0]) || 0, 0, 1) * 255),
      Math.round(clamp(Number(rgb[1]) || 0, 0, 1) * 255),
      Math.round(clamp(Number(rgb[2]) || 0, 0, 1) * 255)
    );
  }

  MF.color = {
    hexToRgb255: hexToRgb255,
    rgb255ToHex: rgb255ToHex,
    rgbToHsv: rgbToHsv,
    hsvToRgb: hsvToRgb,
    normalizeHexInput: normalizeHexInput,
    hexToRgb01: hexToRgb01,
    rgb01ToHex: rgb01ToHex,
    mixHex: mixHex,
    panelShades: panelShades,
    applyPanelShades: applyPanelShades,
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    applyAccent: applyAccent,
    clamp: clamp
  };

  // ---------------------------------------------------------------
  // Colour picker
  //
  // History: this project shipped a custom inline picker (SV square +
  // hue bar + hex) because neither a scriptable eyedropper nor the
  // browser EyeDropper API worked inside CEP. The browser EyeDropper is
  // still non-functional here -- present as `typeof "function"`, but
  // open() rejects immediately with AbortError because Chromium can't
  // spawn the OS screen-sampler overlay inside AE's hosted webview.
  //
  // So every colour interaction now opens After Effects' OWN colour
  // picker (host.jsx pickColorNative): it is the only picker in this
  // environment with a working eyedropper, and it is the picker AE users
  // already know. One consistent path for both panels.
  //
  // MF.initColorPicker({ hostCall, onBeforeOpen, setStatus })
  //   -> { open(trigger, startHex, onPick), close(), createSwatch(hex, onChange), isOpenFor() }
  //   hostCall     required -- calls pickColorNative.
  //   onBeforeOpen optional -- run right before the native picker opens
  //                (the main panel closes its font/scale popovers here).
  //   setStatus    optional -- (message, type) toast for errors.
  // close() and isOpenFor() are kept as no-ops so existing call sites in
  // panel.js keep working without change.
  // ---------------------------------------------------------------

  MF.initColorPicker = function (config) {
    config = config || {};
    var hostCall = config.hostCall;
    var onBeforeOpen = typeof config.onBeforeOpen === "function" ? config.onBeforeOpen : null;
    var setStatus = typeof config.setStatus === "function" ? config.setStatus : function () {};

    function openNativePicker(startHex, onPick) {
      if (typeof hostCall !== "function") {
        return;
      }
      if (onBeforeOpen) {
        onBeforeOpen();
      }
      var current = normalizeHexInput(startHex) || "#ffffff";
      hostCall("pickColorNative", [current], function (result) {
        if (!result || !result.ok) {
          setStatus((result && result.error) || "Não foi possível abrir o seletor de cor do After Effects.", "error");
          return;
        }
        if (result.cancelled) {
          return;
        }
        var hex = normalizeHexInput(result.hex);
        if (hex && onPick) {
          onPick(hex);
        }
      });
    }

    // A swatch button that opens the native picker on click.
    function createColorSwatch(hex, onChange) {
      var swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "t-color";
      swatch.style.background = hex;
      swatch.setAttribute("data-hex", hex);
      swatch.setAttribute("aria-label", "Choose colour");
      swatch.addEventListener("click", function (event) {
        event.stopPropagation();
        openNativePicker(swatch.getAttribute("data-hex") || hex, function (newHex) {
          swatch.setAttribute("data-hex", newHex);
          swatch.style.background = newHex;
          onChange(newHex);
        });
      });
      swatch.setHex = function (newHex) {
        swatch.setAttribute("data-hex", newHex);
        swatch.style.background = newHex;
      };
      return swatch;
    }

    return {
      open: function (trigger, startHex, onPick) {
        openNativePicker(startHex, onPick);
      },
      close: function () {},
      createSwatch: createColorSwatch,
      isOpenFor: function () { return false; }
    };
  };
})();
