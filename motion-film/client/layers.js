/*
 * Mótion Film — "MF - Camadas" satellite window
 *
 * A separate CEP extension (com.motionfilm.layers) sharing the same
 * bundle and host.jsx as the main panel. Holds the three layer-creation
 * buttons (Null / Adjustment / Solid) so the user can pull them out of
 * the main panel's footer.
 *
 * State: the main panel owns a toggle ("layer buttons in a separate
 * panel"); it travels through host.jsx setAuxLayersEnabled /
 * getAuxLayersEnabled on the shared ExtendScript global (same channel as
 * the theme). While the toggle is OFF this window just shows a hint;
 * while ON it shows the buttons. The toggle itself lives only in the
 * main panel's settings popover.
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------
  // Host bridge (same shape as panel.js / palette.js hostCall)
  // ---------------------------------------------------------------
  function evalHost(expression, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(expression, callback || function () {});
      return;
    }
    if (callback) {
      callback(JSON.stringify({ ok: false, error: "Esta janela precisa rodar dentro do After Effects." }));
    }
  }

  function hostCall(name, args, callback) {
    var serialized = [];
    for (var i = 0; i < args.length; i += 1) {
      serialized.push(JSON.stringify(args[i]));
    }
    evalHost(name + "(" + serialized.join(",") + ")", function (raw) {
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        parsed = { ok: false, error: raw || "Sem resposta do After Effects." };
      }
      if (callback) {
        callback(parsed);
      }
    });
  }

  // ---------------------------------------------------------------
  // Compositing keep-alive (see palette.html / layers.html comment)
  // ---------------------------------------------------------------
  function startPaintKeepAlive() {
    var canvas = $("paint-keepalive");
    if (!canvas) {
      return;
    }
    var ctx;
    try {
      ctx = canvas.getContext("2d");
    } catch (ctxError) {
      return;
    }
    if (!ctx) {
      return;
    }
    var tick = 0;
    function paint() {
      tick = (tick + 1) % 256;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(" + tick + "," + ((tick * 2) % 256) + ",0,0.02)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    paint();
    window.setInterval(paint, 120);
    if (typeof window.requestAnimationFrame === "function") {
      var rafLoop = function () {
        paint();
        window.requestAnimationFrame(rafLoop);
      };
      window.requestAnimationFrame(rafLoop);
    }
  }

  // ---------------------------------------------------------------
  // Status toast (lean copy of panel.js setStatus)
  // ---------------------------------------------------------------
  var statusHideTimer = null;

  function hideStatus() {
    if (statusHideTimer) {
      clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    var status = $("status");
    status.classList.remove("is-visible");
    window.setTimeout(function () {
      if (!status.classList.contains("is-visible")) {
        status.hidden = true;
      }
    }, 200);
  }

  function setStatus(message, type) {
    if (!message) {
      hideStatus();
      return;
    }
    var status = $("status");
    status.style.top = "10px";
    status.hidden = false;
    status.textContent = message;
    status.className = "status" + (type ? " is-" + type : "");
    void status.offsetHeight;
    status.classList.add("is-visible");
    if (statusHideTimer) {
      clearTimeout(statusHideTimer);
    }
    statusHideTimer = window.setTimeout(hideStatus, 2600);
  }

  // ---------------------------------------------------------------
  // Live sync with the host: appearance theme (mirrored from the main
  // panel) + the aux-layers toggle. Both are pulled together, and only
  // while this window actually has focus/visibility -- any evalScript
  // fired while the user is editing text in the AE viewport bumps the
  // caret to the start of the layer (same hard-won rule as palette.js).
  // ---------------------------------------------------------------
  var active = true;
  try { active = document.hasFocus(); } catch (focusProbeError) {}

  var lastTheme = { accent: null, panel: null };
  var lastEnabled = null;

  function applyTheme(accent, panel) {
    var root = document.documentElement.style;
    if (accent) {
      window.MF.color.applyAccent(root, accent);
    }
    if (panel) {
      window.MF.color.applyPanelShades(root, panel);
    }
  }

  function applyEnabled(enabled) {
    enabled = !!enabled;
    if (enabled === lastEnabled) {
      return;
    }
    lastEnabled = enabled;
    // Exactly one of the two fills the window -- no empty band.
    $("layers-actions").hidden = !enabled;
    $("layers-main").hidden = enabled;
  }

  function pull() {
    hostCall("getSharedTheme", [], function (res) {
      if (res && res.ok) {
        var accent = res.accent || null;
        var panel = res.panel || null;
        if (accent !== lastTheme.accent || panel !== lastTheme.panel) {
          lastTheme.accent = accent;
          lastTheme.panel = panel;
          applyTheme(accent, panel);
          try {
            if (accent) { window.localStorage.setItem("motionfilm-accent", accent); }
            if (panel) { window.localStorage.setItem("motionfilm-panel", panel); }
          } catch (cacheError) {}
        }
      }
    });
    hostCall("getAuxLayersEnabled", [], function (res) {
      if (res && res.ok) {
        applyEnabled(res.enabled);
      }
    });
  }

  function pullIfActive() {
    if (active) {
      pull();
    }
  }

  function initSync() {
    var cachedAccent = null;
    var cachedPanel = null;
    try {
      cachedAccent = window.localStorage.getItem("motionfilm-accent");
      cachedPanel = window.localStorage.getItem("motionfilm-panel");
    } catch (readError) {}
    applyTheme(cachedAccent, cachedPanel);

    // One unconditional pull at window load: unlike the theme (cosmetic,
    // and cached in localStorage for first paint), the aux-layers state
    // IS the whole point of this window and has no local cache, so it
    // must resolve even if the window opened unfocused. A single host
    // call at load time carries no real caret-bump risk.
    pull();
    // A few more unconditional pulls during AE startup: if the main panel
    // loads after this window, its theme/toggle reach the host a moment
    // later, and an unfocused window would otherwise never ask again.
    // (The toggle is also persisted host-side now, so these mostly cover
    // the theme and the very first launch after updating.) Nobody is
    // typing in the viewport this early, so no caret risk.
    window.setTimeout(pull, 1500);
    window.setTimeout(pull, 4000);
    window.setTimeout(pull, 9000);
    window.setInterval(pullIfActive, 1200);
    window.addEventListener("focus", function () { active = true; pull(); });
    window.addEventListener("blur", function () { active = false; });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        active = true;
        pull();
      }
    });
  }

  // ---------------------------------------------------------------
  // The three buttons -- same host functions the main panel's footer
  // calls (createShapeNull / createShapeAdjustment / createShapeSolid).
  // ---------------------------------------------------------------
  function createLayer(hostFunction, args, label) {
    hostCall(hostFunction, args || [], function (result) {
      if (!result || !result.ok) {
        setStatus((result && result.error) || "Não foi possível criar a camada.", "error");
        return;
      }
      setStatus(label + " “" + (result.name || "") + "” criado.", "success");
    });
  }

  function wireButtons() {
    // Shift+click: null no centro da comp (mesmo comportamento do painel
    // principal).
    $("aux-create-null").addEventListener("click", function (event) {
      createLayer("createShapeNull", [{ compCentre: !!event.shiftKey }], "Null");
    });
    $("aux-create-adjustment").addEventListener("click", function () {
      createLayer("createShapeAdjustment", [], "Camada de ajuste");
    });
    $("aux-create-solid").addEventListener("click", function () {
      // Always black (user request 2026-10; it used to take the accent).
      createLayer("createShapeSolid", [[0, 0, 0]], "Sólido");
    });
  }

  function init() {
    startPaintKeepAlive();
    wireButtons();
    initSync();
  }

  document.addEventListener("DOMContentLoaded", init);
}());
