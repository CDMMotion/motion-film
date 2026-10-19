/*
 * Mótion Film — Colour Palette satellite window
 *
 * A separate CEP extension (com.motionfilm.palette) sharing the same
 * bundle and the same host.jsx as the main panel. Deliberately compact:
 * no topbar, no footer. Appearance (accent/panel colour) is owned by the
 * main panel and mirrored here via host.jsx getSharedTheme.
 *
 * Data model (localStorage "motionfilm-color-palettes"):
 *   [ { id, name, palettes: [ { id, name?, colors: [ {id,hex,name?} ] } ] } ]
 * A GROUP (card) holds one or more PALETTES (rows of colours). Old flat
 * entries { id, name, colors:[...] } are read as a single-palette group.
 *
 * Clicking a cube applies its colour to the selected layer(s) via the
 * host's applyPaletteColor (text -> font fill, shape -> vector fills,
 * anything else -> a Fill effect).
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var els = {};
  // Transient per-group "edit mode" flags (not persisted). While a group
  // is editing, its cubes show pencil/trash controls and the header
  // shows export/delete.
  var editing = {};

  // ---------------------------------------------------------------
  // Host bridge (same shape as panel.js hostCall)
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
  // Compositing keep-alive (see palette.html comment)
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
  // Status toast (lean version of panel.js setStatus)
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
  // Appearance theme, mirrored from the main panel
  //
  // The two panels are separate CEP extensions with separate
  // localStorage, so the theme travels through host.jsx's shared
  // ExtendScript global (setSharedTheme / getSharedTheme). We apply a
  // localStorage cache immediately for the first paint, then pull the
  // live value from the host and poll for changes.
  // ---------------------------------------------------------------
  var lastTheme = { accent: null, panel: null };

  function applyTheme(accent, panel) {
    var root = document.documentElement.style;
    if (accent) {
      root.setProperty("--accent", accent);
      root.setProperty("--accent-bright", accent);
    }
    if (panel) {
      // Same derivation the main panel uses -- the raised "card" tone and
      // the rest of the --panel* family follow the picked background.
      window.MF.color.applyPanelShades(root, panel);
    }
  }

  function pullTheme() {
    hostCall("getSharedTheme", [], function (res) {
      if (!res || !res.ok) {
        return;
      }
      var accent = res.accent || null;
      var panel = res.panel || null;
      if (accent === lastTheme.accent && panel === lastTheme.panel) {
        return;
      }
      lastTheme.accent = accent;
      lastTheme.panel = panel;
      applyTheme(accent, panel);
      try {
        if (accent) { window.localStorage.setItem("motionfilm-accent", accent); }
        if (panel) { window.localStorage.setItem("motionfilm-panel", panel); }
      } catch (cacheError) {}
    });
  }

  // True only while this satellite panel actually has focus. Every
  // hostCall() here runs an evalScript on AE's ONE shared ExtendScript
  // engine, and any evalScript that fires while the user has an active
  // in-viewport text edit knocks the editing caret back to the start of
  // the layer (confirmed live -- even a trivial getSharedTheme read does
  // it). So the theme poll only runs while the user is actually looking
  // at THIS panel; when they're anywhere else in AE (very possibly
  // typing in a text layer) it goes silent. Regaining focus /
  // visibility pulls once to catch up.
  var paletteActive = true;
  try { paletteActive = document.hasFocus(); } catch (focusProbeError) {}

  function pullThemeIfActive() {
    if (paletteActive) {
      pullTheme();
    }
  }

  function initTheme() {
    var cachedAccent = null;
    var cachedPanel = null;
    try {
      cachedAccent = window.localStorage.getItem("motionfilm-accent");
      cachedPanel = window.localStorage.getItem("motionfilm-panel");
    } catch (readError) {}
    applyTheme(cachedAccent, cachedPanel);
    if (paletteActive) {
      pullTheme();
    }
    window.setInterval(pullThemeIfActive, 1500);
    window.addEventListener("focus", function () { paletteActive = true; pullTheme(); });
    window.addEventListener("blur", function () { paletteActive = false; });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        paletteActive = true;
        pullTheme();
      }
    });
  }

  // ---------------------------------------------------------------
  // Colour picker (shared-core.js) + inline name popover + choice menu
  // ---------------------------------------------------------------
  var cpApi = window.MF.initColorPicker({
    hostCall: hostCall,
    setStatus: setStatus,
    onBeforeOpen: function () { closeNamePopover(); closeChoiceMenu(); }
  });

  var namePopover = null;

  function buildNamePopover() {
    var root = document.createElement("div");
    root.className = "fp-popover";
    root.hidden = true;
    root.innerHTML = '<div class="option-picker-add option-picker-add--standalone">' +
      '<input type="text" class="option-picker-add-input" spellcheck="false" />' +
      '<button type="button" class="option-picker-add-button">OK</button>' +
      '</div>';
    document.body.appendChild(root);
    var popover = {
      root: root,
      input: root.querySelector(".option-picker-add-input"),
      button: root.querySelector(".option-picker-add-button"),
      onSave: null
    };
    popover.button.addEventListener("click", function () {
      var name = popover.input.value.trim();
      if (!name) {
        return;
      }
      var onSave = popover.onSave;
      closeNamePopover();
      if (onSave) {
        onSave(name);
      }
    });
    popover.input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        popover.button.click();
      }
    });
    root.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    return popover;
  }

  function closeNamePopover() {
    if (namePopover) {
      namePopover.root.hidden = true;
      namePopover.onSave = null;
    }
  }

  function openNamePopover(trigger, opts, onSave) {
    opts = opts || {};
    if (!namePopover) {
      namePopover = buildNamePopover();
    }
    namePopover.input.value = opts.value || "";
    namePopover.input.placeholder = opts.placeholder || "Nome";
    namePopover.onSave = onSave;
    namePopover.root.hidden = false;
    positionPopover(namePopover.root, trigger);
    namePopover.input.focus();
    namePopover.input.select();
  }

  // Small "create" menu (Nova paleta / Importar paleta), ported from
  // panel.js buildChoicePicker.
  var choiceMenu = null;

  function buildChoiceMenu() {
    var root = document.createElement("div");
    root.className = "fp-popover";
    root.hidden = true;
    var list = document.createElement("div");
    list.className = "fp-list";
    root.appendChild(list);
    document.body.appendChild(root);
    var menu = { root: root, list: list, onPick: null };
    menu.setOptions = function (options) {
      list.innerHTML = "";
      for (var i = 0; i < options.length; i += 1) {
        (function (option) {
          var item = document.createElement("button");
          item.type = "button";
          item.className = "fp-item";
          var dot = document.createElement("span");
          dot.className = "fp-item-dot";
          item.appendChild(dot);
          var label = document.createElement("span");
          label.textContent = option.label;
          item.appendChild(label);
          item.addEventListener("click", function () {
            var onPick = menu.onPick;
            closeChoiceMenu();
            if (onPick) {
              onPick(option.value);
            }
          });
          list.appendChild(item);
        }(options[i]));
      }
    };
    root.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    return menu;
  }

  function closeChoiceMenu() {
    if (choiceMenu) {
      choiceMenu.root.hidden = true;
      choiceMenu.onPick = null;
    }
  }

  function openChoiceMenu(trigger, options, onPick) {
    if (!choiceMenu) {
      choiceMenu = buildChoiceMenu();
    }
    choiceMenu.setOptions(options);
    choiceMenu.onPick = onPick;
    choiceMenu.root.hidden = false;
    positionPopover(choiceMenu.root, trigger);
  }

  function positionPopover(root, trigger) {
    var rect = trigger.getBoundingClientRect();
    var width = root.offsetWidth || 200;
    var height = root.offsetHeight || 60;
    var left = Math.min(rect.left, window.innerWidth - width - 8);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight) {
      top = Math.max(6, rect.top - height - 6);
    }
    root.style.left = Math.max(6, left) + "px";
    root.style.top = top + "px";
  }

  // ---------------------------------------------------------------
  // Data model
  //
  // A GROUP (the card / "tópico") holds one or more PALETTES (rows of
  // colours). Companies often keep several palettes -- primary,
  // secondary, etc. -- under one identity.
  //
  //   [ { id, name, palettes: [ { id, name?, colors: [ {id,hex,name?} ] } ] } ]
  //
  // Backward compatible: an old flat entry { id, name, colors:[...] } is
  // read as a group with a single palette.
  // ---------------------------------------------------------------
  var PALETTES_KEY = "motionfilm-color-palettes";
  var ENVELOPE_TYPE = "motionfilm-color-palettes";

  function uid(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  }

  function normalizeColor(c) {
    var hex = null;
    if (typeof c === "string") {
      hex = window.MF.color.normalizeHexInput(c);
    } else if (c && typeof c === "object") {
      hex = window.MF.color.normalizeHexInput(c.hex || "");
    }
    if (!hex) {
      return null;
    }
    return {
      id: (c && c.id) || uid("c"),
      hex: hex,
      name: (c && typeof c.name === "string") ? c.name : ""
    };
  }

  function normalizePaletteRow(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    var colors = [];
    var raw = entry.colors;
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i += 1) {
        var c = normalizeColor(raw[i]);
        if (c) {
          colors.push(c);
        }
      }
    }
    return {
      id: entry.id || uid("row"),
      name: (typeof entry.name === "string") ? entry.name : "",
      colors: colors
    };
  }

  function normalizeGroup(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    var rows = [];
    if (entry.palettes && entry.palettes.length) {
      for (var i = 0; i < entry.palettes.length; i += 1) {
        var row = normalizePaletteRow(entry.palettes[i]);
        if (row) {
          rows.push(row);
        }
      }
    } else if (entry.colors) {
      // Old flat shape.
      var flat = normalizePaletteRow({ colors: entry.colors });
      if (flat) {
        rows.push(flat);
      }
    }
    if (!rows.length) {
      rows.push({ id: uid("row"), name: "", colors: [] });
    }
    return {
      id: entry.id || uid("grp"),
      name: (typeof entry.name === "string" && entry.name.trim()) ? entry.name : "Grupo",
      palettes: rows
    };
  }

  function loadGroups() {
    try {
      var raw = window.localStorage.getItem(PALETTES_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.length) {
        return [];
      }
      var out = [];
      for (var i = 0; i < parsed.length; i += 1) {
        var g = normalizeGroup(parsed[i]);
        if (g) {
          out.push(g);
        }
      }
      return out;
    } catch (error) {
      return [];
    }
  }

  function saveGroups(list) {
    try {
      window.localStorage.setItem(PALETTES_KEY, JSON.stringify(list));
    } catch (error) {
      setStatus("Não foi possível salvar as paletas.", "error");
    }
  }

  function findGroup(id) {
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].id === id) {
        return groups[i];
      }
    }
    return null;
  }

  function findRow(group, rowId) {
    if (!group) {
      return null;
    }
    for (var i = 0; i < group.palettes.length; i += 1) {
      if (group.palettes[i].id === rowId) {
        return group.palettes[i];
      }
    }
    return null;
  }

  function uniqueName(base, takenList) {
    var taken = {};
    for (var i = 0; i < takenList.length; i += 1) {
      taken[takenList[i]] = true;
    }
    if (!taken[base]) {
      return base;
    }
    var n = 2;
    while (taken[base + " " + n]) {
      n += 1;
    }
    return base + " " + n;
  }

  function groupColorCount(group) {
    var n = 0;
    for (var i = 0; i < group.palettes.length; i += 1) {
      n += group.palettes[i].colors.length;
    }
    return n;
  }

  var groups = loadGroups();

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function miniButton(cls, label, glyph) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "palette-swatch-mini " + cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = glyph;
    return b;
  }

  function iconButton(cls, label, svg) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "palette-icon-btn " + cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = svg;
    return b;
  }

  var SVG_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7">' +
    '<path d="M4 16.5 15 5.5l3.5 3.5L7.5 20H4v-3.5Z" stroke-linejoin="round"/><path d="M13 7.5 16.5 11" stroke-linecap="round"/></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M5 12.5 10 17l9-10" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_EXPORT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7">' +
    '<path d="M12 3v11" stroke-linecap="round"/><path d="M8 6.5 12 3l4 3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M5 14v5a1.3 1.3 0 0 0 1.3 1.3h11.4A1.3 1.3 0 0 0 19 19v-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7">' +
    '<path d="M5 7h14M10 7V5.5h4V7M8 7l.8 13h6.4L16 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_GRIP = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">' +
    '<circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/>' +
    '<circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/>' +
    '<circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>';

  function renderSwatch(group, row, color) {
    // A <div>, not a <button>: the edit/remove controls are real
    // <button>s nested inside it, and a button cannot contain a button.
    var swatch = document.createElement("div");
    swatch.className = "palette-swatch";
    swatch.setAttribute("role", "button");
    swatch.setAttribute("tabindex", "0");
    swatch.style.background = color.hex;
    swatch.setAttribute("data-color-id", color.id);
    swatch.title = color.hex + (color.name ? " · " + color.name : "") + " — clique para aplicar · Shift+clique: só no stroke";
    // Shift+click colours only the stroke (adding one if the shape has none).
    swatch.addEventListener("click", function (event) {
      applyColor(color.hex, !!event.shiftKey);
    });
    swatch.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyColor(color.hex, !!event.shiftKey);
      }
    });

    var remove = miniButton("palette-swatch-remove", "Remover cor", "×");
    remove.addEventListener("click", function (event) {
      event.stopPropagation();
      removeColor(group.id, row.id, color.id);
    });

    var edit = miniButton("palette-swatch-edit", "Editar cor", "");
    edit.innerHTML = SVG_PENCIL;
    edit.addEventListener("click", function (event) {
      event.stopPropagation();
      cpApi.open(swatch, color.hex, function (hex) {
        color.hex = hex;
        saveGroups(groups);
        var live = els.list.querySelector('[data-color-id="' + color.id + '"]');
        if (live) {
          live.style.background = hex;
        }
      });
    });

    swatch.appendChild(remove);
    swatch.appendChild(edit);
    return swatch;
  }

  function renderPaletteRow(group, row, isEditing, canRemoveRow) {
    var strip = document.createElement("div");
    strip.className = "palette-swatches";

    for (var i = 0; i < row.colors.length; i += 1) {
      strip.appendChild(renderSwatch(group, row, row.colors[i]));
    }

    var addColorBtn = document.createElement("button");
    addColorBtn.type = "button";
    addColorBtn.className = "palette-swatch-add";
    addColorBtn.title = "Adicionar cor";
    addColorBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>';
    addColorBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      addColor(group.id, row.id, addColorBtn);
    });
    strip.appendChild(addColorBtn);

    if (isEditing && canRemoveRow) {
      var removeRowBtn = document.createElement("button");
      removeRowBtn.type = "button";
      removeRowBtn.className = "palette-swatch-add palette-row-remove";
      removeRowBtn.title = "Remover esta paleta";
      removeRowBtn.innerHTML = SVG_TRASH;
      removeRowBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        deletePaletteRow(group.id, row.id);
      });
      strip.appendChild(removeRowBtn);
    }

    return strip;
  }

  function renderGroup(group) {
    var isEditing = !!editing[group.id];

    var card = document.createElement("div");
    card.className = "palette-group" + (isEditing ? " is-editing" : "");
    card.setAttribute("data-group-id", group.id);
    card.setAttribute("data-palette-id", group.id);

    var head = document.createElement("div");
    head.className = "palette-group-head";

    var handle = document.createElement("button");
    handle.type = "button";
    handle.className = "palette-drag-handle";
    handle.setAttribute("aria-label", "Reordenar grupo");
    handle.title = "Arraste para reordenar";
    handle.innerHTML = SVG_GRIP;
    handle.addEventListener("pointerdown", function (event) {
      startGroupDrag(event, group.id, card);
    });
    head.appendChild(handle);

    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "palette-group-name";
    nameBtn.textContent = group.name;
    nameBtn.title = "Renomear grupo";
    nameBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      openNamePopover(nameBtn, { placeholder: "Nome do grupo", value: group.name }, function (name) {
        group.name = name;
        saveGroups(groups);
        render();
      });
    });

    var total = groupColorCount(group);
    var count = document.createElement("span");
    count.className = "palette-group-count";
    count.textContent = total + (total === 1 ? " cor" : " cores");

    var actions = document.createElement("div");
    actions.className = "palette-group-actions";

    if (isEditing) {
      var exportBtn = iconButton("", "Exportar este grupo", SVG_EXPORT);
      exportBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        exportGroups([group], group.name);
      });
      var deleteBtn = iconButton("danger", "Apagar grupo", SVG_TRASH);
      deleteBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteGroup(group.id);
      });
      actions.appendChild(exportBtn);
      actions.appendChild(deleteBtn);
    }

    var editToggle = iconButton(isEditing ? "is-active" : "", isEditing ? "Concluir edição" : "Editar grupo",
      isEditing ? SVG_CHECK : SVG_PENCIL);
    editToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      editing[group.id] = !editing[group.id];
      render();
    });
    actions.appendChild(editToggle);

    head.appendChild(nameBtn);
    head.appendChild(count);
    head.appendChild(actions);
    card.appendChild(head);

    var canRemoveRow = group.palettes.length > 1;
    for (var i = 0; i < group.palettes.length; i += 1) {
      card.appendChild(renderPaletteRow(group, group.palettes[i], isEditing, canRemoveRow));
    }

    if (isEditing) {
      var addRowBtn = document.createElement("button");
      addRowBtn.type = "button";
      addRowBtn.className = "palette-add-row";
      addRowBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7">' +
        '<path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg><span>Adicionar paleta</span>';
      addRowBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        addPaletteRow(group.id);
      });
      card.appendChild(addRowBtn);
    }

    return card;
  }

  function render() {
    els.list.innerHTML = "";
    for (var i = 0; i < groups.length; i += 1) {
      els.list.appendChild(renderGroup(groups[i]));
    }
  }

  // ---------------------------------------------------------------
  // Drag to reorder groups
  //
  // Pointer events (not HTML5 drag-and-drop, which is flaky in this CEF):
  // grab the header handle; the dragged card follows the pointer with a
  // transform, and as the pointer passes a neighbour's vertical midpoint
  // the card is physically moved between slots with insertBefore. Every
  // motion is animated with the FLIP technique -- transform only, which
  // is the sole reliably-smooth property in this CEP Chromium (see
  // animateTabLayoutChange in panel.js). The move/up listeners are on
  // `document`, not on the handle -- moving the handle's own DOM node
  // mid-gesture drops pointer capture in this Chromium, so a captured
  // handle never sees pointerup. On release the `groups` array is
  // rebuilt from the DOM order and saved; nodes are never recreated, so
  // no full re-render is needed.
  // ---------------------------------------------------------------
  var drag = null;
  var DRAG_ANIM_MS = 180;

  // Which card should the dragged one be inserted before, for a given
  // pointer Y? Measured with offsetTop/offsetHeight (layout metrics),
  // NOT getBoundingClientRect, so it stays correct even while siblings
  // are mid-FLIP with a transform applied. Needs .palette-list to be a
  // positioned offsetParent (see palette.css).
  function cardAfterPointer(y) {
    var listTop = els.list.getBoundingClientRect().top;
    var localY = y - listTop + els.list.scrollTop;
    var cards = els.list.querySelectorAll(".palette-group:not(.is-dragging)");
    for (var i = 0; i < cards.length; i += 1) {
      if (localY < cards[i].offsetTop + cards[i].offsetHeight / 2) {
        return cards[i];
      }
    }
    return null;
  }

  // FLIP a set of elements around a DOM change: record tops, apply the
  // change, invert each moved element to its old spot with no
  // transition, then on the next frame animate the transform back to 0.
  function flipSiblings(siblings, applyChange) {
    var before = [];
    for (var i = 0; i < siblings.length; i += 1) {
      before.push(siblings[i].getBoundingClientRect().top);
    }
    applyChange();
    for (var j = 0; j < siblings.length; j += 1) {
      var delta = before[j] - siblings[j].getBoundingClientRect().top;
      if (delta) {
        siblings[j].style.transition = "none";
        siblings[j].style.transform = "translateY(" + delta + "px)";
      }
    }
    void els.list.offsetHeight;
    for (var k = 0; k < siblings.length; k += 1) {
      siblings[k].style.transition = "transform " + DRAG_ANIM_MS + "ms ease";
      siblings[k].style.transform = "";
    }
    window.setTimeout(function () {
      for (var m = 0; m < siblings.length; m += 1) {
        siblings[m].style.transition = "";
        siblings[m].style.transform = "";
      }
    }, DRAG_ANIM_MS + 40);
  }

  function onDragMove(event) {
    if (!drag) {
      return;
    }
    event.preventDefault();
    var dy = event.clientY - drag.startY;

    var after = cardAfterPointer(event.clientY);
    if (after !== drag.cardEl && after !== drag.cardEl.nextElementSibling) {
      var others = [];
      for (var i = 0; i < els.list.children.length; i += 1) {
        if (els.list.children[i] !== drag.cardEl) {
          others.push(els.list.children[i]);
        }
      }
      var draggedTopBefore = drag.cardEl.getBoundingClientRect().top;
      flipSiblings(others, function () {
        els.list.insertBefore(drag.cardEl, after);
      });
      // The dragged card's own slot moved too; shift its follow baseline
      // so translateY keeps it exactly under the cursor (no jump).
      drag.offset += draggedTopBefore - drag.cardEl.getBoundingClientRect().top;
      drag.moved = true;
    }

    drag.cardEl.style.transition = "none";
    drag.cardEl.style.transform = "translateY(" + (dy + drag.offset) + "px)";
  }

  function onDragEnd() {
    if (!drag) {
      return;
    }
    var d = drag;
    drag = null;
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragEnd);
    document.removeEventListener("pointercancel", onDragEnd);
    document.body.classList.remove("palette-dragging");

    // Settle the dragged card into its slot.
    d.cardEl.style.transition = "transform " + DRAG_ANIM_MS + "ms ease";
    d.cardEl.style.transform = "";
    window.setTimeout(function () {
      d.cardEl.style.transition = "";
      d.cardEl.style.transform = "";
      d.cardEl.classList.remove("is-dragging");
    }, DRAG_ANIM_MS + 40);

    if (d.moved) {
      var order = [];
      var cards = els.list.querySelectorAll(".palette-group");
      for (var i = 0; i < cards.length; i += 1) {
        order.push(cards[i].getAttribute("data-group-id"));
      }
      groups.sort(function (a, b) {
        var ia = order.indexOf(a.id);
        var ib = order.indexOf(b.id);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      saveGroups(groups);
    }
  }

  function startGroupDrag(event, groupId, cardEl) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeNamePopover();
    closeChoiceMenu();
    cpApi.close();
    drag = { groupId: groupId, cardEl: cardEl, moved: false, startY: event.clientY, offset: 0 };
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd);
    document.addEventListener("pointercancel", onDragEnd);
    cardEl.classList.add("is-dragging");
    document.body.classList.add("palette-dragging");
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  function addGroup() {
    var names = [];
    for (var i = 0; i < groups.length; i += 1) {
      names.push(groups[i].name);
    }
    groups.push({
      id: uid("grp"),
      name: uniqueName("Grupo", names),
      palettes: [{ id: uid("row"), name: "", colors: [] }]
    });
    saveGroups(groups);
    render();
  }

  function deleteGroup(id) {
    var next = [];
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].id !== id) {
        next.push(groups[i]);
      }
    }
    groups = next;
    delete editing[id];
    saveGroups(groups);
    render();
  }

  function addPaletteRow(groupId) {
    var group = findGroup(groupId);
    if (!group) {
      return;
    }
    group.palettes.push({ id: uid("row"), name: "", colors: [] });
    saveGroups(groups);
    render();
  }

  function deletePaletteRow(groupId, rowId) {
    var group = findGroup(groupId);
    if (!group || group.palettes.length <= 1) {
      return;
    }
    var next = [];
    for (var i = 0; i < group.palettes.length; i += 1) {
      if (group.palettes[i].id !== rowId) {
        next.push(group.palettes[i]);
      }
    }
    group.palettes = next;
    saveGroups(groups);
    render();
  }

  function addColor(groupId, rowId, trigger) {
    var group = findGroup(groupId);
    var row = findRow(group, rowId);
    if (!row) {
      return;
    }
    // The native AE picker returns once (not a live stream), so only add
    // the colour if the user actually picks one -- cancelling adds
    // nothing. Start from mid-grey; AE treats "picked the exact starting
    // colour" as a cancel, so an unlikely start value avoids swallowing
    // a real pick.
    cpApi.open(trigger, "#7f7f7f", function (hex) {
      row.colors.push({ id: uid("c"), hex: hex, name: "" });
      saveGroups(groups);
      render();
    });
  }

  function removeColor(groupId, rowId, colorId) {
    var group = findGroup(groupId);
    var row = findRow(group, rowId);
    if (!row) {
      return;
    }
    var next = [];
    for (var i = 0; i < row.colors.length; i += 1) {
      if (row.colors[i].id !== colorId) {
        next.push(row.colors[i]);
      }
    }
    row.colors = next;
    saveGroups(groups);
    render();
  }

  function applyColor(hex, strokeOnly) {
    var rgb = window.MF.color.hexToRgb01(hex);
    var payload = { rgb: rgb };
    if (strokeOnly) {
      payload.target = "stroke";
    }
    hostCall("applyPaletteColor", [JSON.stringify(payload)], function (result) {
      if (!result || !result.ok) {
        setStatus((result && result.error) || "Não foi possível aplicar a cor.", "error");
        return;
      }
      if (!result.applied) {
        setStatus(strokeOnly ? "Nenhuma camada de shape ou texto selecionada para o stroke." : "Nenhuma camada compatível selecionada.", "error");
        return;
      }
      var msg = (strokeOnly ? "Stroke aplicado em " : "Cor aplicada em ") + result.applied + " camada" + (result.applied === 1 ? "" : "s") + ".";
      if (result.added) {
        msg += " Stroke criado em " + result.added + ".";
      }
      if (result.enabled) {
        msg += " " + result.enabled + " stroke" + (result.enabled === 1 ? "" : "s") + " oculto" + (result.enabled === 1 ? "" : "s") + " reativado" + (result.enabled === 1 ? "" : "s") + ".";
      }
      if (result.skipped) {
        msg += " (" + result.skipped + " ignorada" + (result.skipped === 1 ? "" : "s") + ")";
      }
      setStatus(msg, "success");
    });
  }

  // ---------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------
  function saveTextFileWithNativeDialog(title, defaultName, contents, onDone) {
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx && window.cep.fs.writeFile) {
        var choice = window.cep.fs.showSaveDialogEx(title, "", ["json"], defaultName);
        var chosen = choice && choice.data;
        if (Object.prototype.toString.call(chosen) === "[object Array]") {
          chosen = chosen[0];
        }
        if (!chosen) {
          onDone(false, null);
          return;
        }
        if (!/\.json$/i.test(chosen)) {
          chosen += ".json";
        }
        var written = window.cep.fs.writeFile(chosen, contents);
        if (!written || written.err === 0) {
          onDone(true, chosen);
        } else {
          onDone(false, null, "Não foi possível gravar o arquivo (erro " + written.err + ").");
        }
        return;
      }
    } catch (nativeError) {
      // Fall through to the Blob fallback.
    }
    try {
      var blob = new Blob([contents], { type: "application/json" });
      var link = document.createElement("a");
      var url = URL.createObjectURL(blob);
      link.href = url;
      link.download = defaultName + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      onDone(true, defaultName + ".json");
    } catch (blobError) {
      onDone(false, null, "Exportação falhou.");
    }
  }

  function sanitizeFileNamePart(name) {
    return String(name || "grupo").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "grupo";
  }

  function buildEnvelope(list) {
    return {
      type: ENVELOPE_TYPE,
      motionFilmColorPalettesFile: true,
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      groups: list
    };
  }

  function exportGroups(list, labelForName) {
    if (!list.length) {
      setStatus("Nenhum grupo para exportar.", "error");
      return;
    }
    var fileName = list.length === 1
      ? "Motion Film Grupo " + sanitizeFileNamePart(labelForName)
      : "Motion Film Paletas " + new Date().toISOString().substring(0, 10);
    saveTextFileWithNativeDialog("Exportar paletas", fileName, JSON.stringify(buildEnvelope(list), null, 2), function (ok, path, error) {
      if (ok) {
        setStatus("Exportado: " + list.length + " grupo" + (list.length === 1 ? "" : "s") + ".", "success");
      } else if (error) {
        setStatus(error, "error");
      }
    });
  }

  function parseImportedGroups(jsonText) {
    var data = JSON.parse(jsonText);
    var raw = null;
    // v2 -> data.groups; v1 -> data.palettes (each a flat group); bare
    // array; or a single flat group object.
    if (data && data.groups && data.groups.length) {
      raw = data.groups;
    } else if (data && data.palettes && data.palettes.length) {
      raw = data.palettes;
    } else if (data && data.length) {
      raw = data;
    } else if (data && (data.colors || data.palettes)) {
      raw = [data];
    }
    if (!raw) {
      throw new Error("Não é um arquivo de paletas do Mótion Film.");
    }
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var g = normalizeGroup(raw[i]);
      if (g) {
        out.push(g);
      }
    }
    return out;
  }

  function importFiles(fileList) {
    var files = [];
    for (var i = 0; i < fileList.length; i += 1) {
      files.push(fileList[i]);
    }
    if (!files.length) {
      return;
    }
    var pending = files.length;
    var importedCount = 0;
    var failedCount = 0;

    function finish() {
      pending -= 1;
      if (pending > 0) {
        return;
      }
      saveGroups(groups);
      render();
      if (importedCount && !failedCount) {
        setStatus("Importado: " + importedCount + " grupo" + (importedCount === 1 ? "" : "s") + ".", "success");
      } else if (importedCount && failedCount) {
        setStatus("Importado " + importedCount + " — " + failedCount + " arquivo(s) não puderam ser lidos.", "success");
      } else {
        setStatus("Não foi possível importar — arquivo de paletas inválido.", "error");
      }
    }

    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var incoming = parseImportedGroups(String(reader.result));
          var names = [];
          for (var n = 0; n < groups.length; n += 1) {
            names.push(groups[n].name);
          }
          for (var e = 0; e < incoming.length; e += 1) {
            var g = incoming[e];
            g.id = uid("grp");
            g.name = uniqueName(g.name, names);
            names.push(g.name);
            groups.push(g);
            importedCount += 1;
          }
        } catch (parseError) {
          failedCount += 1;
        }
        finish();
      };
      reader.onerror = function () {
        failedCount += 1;
        finish();
      };
      reader.readAsText(file);
    });
  }

  // ---------------------------------------------------------------
  // Repaint nudges (belt-and-braces alongside the keep-alive canvas)
  // ---------------------------------------------------------------
  function nudgeRepaint() {
    var html = document.documentElement;
    var prevTransform = html.style.transform;
    html.style.transform = "translateZ(0)";
    void html.offsetHeight;
    html.style.transform = prevTransform;

    var body = document.body;
    if (body) {
      var prevDisplay = body.style.display;
      body.style.display = "none";
      void body.offsetHeight;
      body.style.display = prevDisplay;
    }
  }

  function scheduleRepaintNudges() {
    nudgeRepaint();
    var delays = [60, 160, 400, 1000, 2500];
    for (var i = 0; i < delays.length; i += 1) {
      window.setTimeout(nudgeRepaint, delays[i]);
    }
    window.addEventListener("focus", nudgeRepaint);
    window.addEventListener("resize", nudgeRepaint);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        nudgeRepaint();
      }
    });
    try {
      if (window.__adobe_cep__ && typeof window.__adobe_cep__.addEventListener === "function") {
        window.__adobe_cep__.addEventListener("com.adobe.csxs.events.WindowVisibilityChanged", nudgeRepaint);
      }
    } catch (cepEventError) {}
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  function init() {
    els.list = $("palette-list");
    els.addBtn = $("palette-add");
    els.importInput = $("palette-import-input");

    startPaintKeepAlive();
    initTheme();

    els.addBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      openChoiceMenu(els.addBtn, [
        { value: "new", label: "Novo grupo" },
        { value: "import", label: "Importar" }
      ], function (pick) {
        if (pick === "new") {
          addGroup();
        } else if (pick === "import") {
          els.importInput.value = "";
          els.importInput.click();
        }
      });
    });

    els.importInput.addEventListener("change", function () {
      importFiles(els.importInput.files);
    });

    document.addEventListener("click", function () {
      cpApi.close();
      closeNamePopover();
      closeChoiceMenu();
    });

    render();
    scheduleRepaintNudges();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
