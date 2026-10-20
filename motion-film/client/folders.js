/*
 * Mótion Film -- Folders (aba Effects, caixa "02 / FOLDERS").
 *
 * Pastas de camadas na timeline, nossa versão da ideia do "Accordion"
 * (Motion Fun): agrupa camadas embaixo de um Null cabeçalho e fecha a
 * pasta tirando as linhas da timeline (switch Shy), sem precompor. Toda a
 * lógica do AE está em host/folders.jsx (carregado aqui com $.evalFile,
 * igual ao figma.jsx); este arquivo só desenha a lista e chama as ações.
 *
 * A lista NÃO fica consultando o AE o tempo todo: atualiza quando a aba
 * aparece, quando o painel ganha foco / o mouse entra nele, e com o
 * estado que volta de cada ação.
 */
(function () {
  "use strict";

  // Cores padrão dos labels do After Effects (1..16; 0 = None).
  var LABEL_HEX = ["#5d5d5d", "#b53838", "#e4d84c", "#a9cbc7", "#e5bcc9", "#a9a9ca", "#e7c19e", "#b3c7b3",
    "#677de0", "#4aa44c", "#8e2c9a", "#e8920d", "#7f452a", "#f46dd6", "#3da2a5", "#a8967e", "#1e401e"];
  var LABEL_NAMES = ["None", "Red", "Yellow", "Aqua", "Pink", "Lavender", "Peach", "Sea Foam", "Blue", "Green",
    "Purple", "Orange", "Brown", "Fuchsia", "Cyan", "Sandstone", "Dark Green"];

  var KEY_ACCORDION = "motionfilm-folders-accordion";
  var KEY_COLOR_MEMBERS = "motionfilm-folders-color-members";

  var ICONS = {
    chevron: '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4.5 2.5 8 6l-3.5 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    group: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 6.2a1.7 1.7 0 0 1 1.7-1.7h3.4l1.7 1.9h6.5a1.7 1.7 0 0 1 1.7 1.7v6.2a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7z" stroke-linejoin="round"/><path d="M10 9.2v4M8 11.2h4" stroke-linecap="round"/></svg>',
    fold: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3.5 10 7.5l4-4M6 16.5l4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    unfold: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 7.5 10 3.5l4 4M6 12.5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    accordion: '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3.5" width="14" height="3.4" rx="1"/><rect x="3" y="8.3" width="14" height="3.4" rx="1"/><rect x="3" y="13.1" width="14" height="3.4" rx="1"/></svg>',
    solo: '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><circle cx="8" cy="8" r="3.4"/></svg>',
    eye: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    lock: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>',
    check: '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3.5 8.3 6.5 11.3 12.5 4.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  var state = { groups: [], comp: null, matteOk: true };
  var labelNames = null; // nomes de label do AE do usuário (lfLabels)
  var busy = false;
  var editing = null; // grupo sendo renomeado (não redesenha a lista no meio)
  var lastSig = "";

  function $(id) { return document.getElementById(id); }

  function storeGet(key, fallback) {
    try { var v = window.localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }

  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") {
      window.MF.setStatus(message, type);
    }
  }

  // ---------------------------------------------------------------
  // Host
  // ---------------------------------------------------------------
  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; } // macOS
    return p;
  }

  var hostLoaded = false;
  function ensureHost(callback) {
    if (hostLoaded) { callback(true); return; }
    if (!window.__adobe_cep__) { callback(false); return; }
    var path = extensionDir() + "/host/folders.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof lfState", function (res) {
      hostLoaded = res === "function";
      callback(hostLoaded);
    });
  }

  function call(name, args, callback) {
    ensureHost(function (ok) {
      if (!ok) {
        if (callback) { callback({ ok: false, error: "Couldn't load the Folders script in After Effects." }); }
        return;
      }
      var parts = [];
      for (var i = 0; i < args.length; i += 1) { parts.push(JSON.stringify(args[i])); }
      window.__adobe_cep__.evalScript(name + "(" + parts.join(",") + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        if (callback) { callback(res); }
      });
    });
  }

  // Ação de edição: chama, mostra a mensagem e redesenha com o estado novo.
  function act(name, args, quiet) {
    if (busy) { return; }
    busy = true;
    closeMenu();
    call(name, args, function (res) {
      busy = false;
      if (!res.ok) {
        status(res.error || "Couldn't finish that.", "error");
        refresh();
        return;
      }
      if (res.message && !quiet) { status(res.message, "success"); }
      if (res.state) { render(res.state); } else { refresh(); }
    });
  }

  function refresh() {
    var page = $("page-effects");
    if (!page || page.hidden || busy || editing) { return; }
    call("lfState", [], function (res) {
      if (res && res.ok) { render(res); }
    });
  }

  // ---------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------
  function signature(st) {
    return JSON.stringify([st.compId, st.groups]);
  }

  function render(st) {
    state = st;
    var sig = signature(st);
    if (sig === lastSig) { return; }
    lastSig = sig;
    var tree = $("lf-tree");
    var empty = $("lf-empty");
    tree.innerHTML = "";
    if (!st.comp) {
      empty.textContent = "Open a composition to use folders.";
      empty.hidden = false;
      return;
    }
    if (!st.groups.length) {
      empty.textContent = "Select layers in the timeline, then Group.";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    for (var i = 0; i < st.groups.length; i += 1) {
      tree.appendChild(buildRow(st.groups[i]));
    }
  }

  function iconButton(kind, active, title) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lf-switch" + (active ? " is-on" : "");
    b.innerHTML = ICONS[kind];
    b.title = title;
    return b;
  }

  function buildRow(g) {
    var row = document.createElement("div");
    row.className = "lf-row" + (g.folded ? " is-folded" : "") + (g.ancestorFolded ? " is-dimmed" : "");
    row.style.setProperty("--lf-depth", g.depth);
    row.setAttribute("data-id", g.id);
    row.title = "Click: fold/open · Shift: open only this · Alt: with subfolders · Right-click: more";

    var chev = document.createElement("span");
    chev.className = "lf-chev";
    chev.innerHTML = ICONS.chevron;

    var dot = document.createElement("span");
    dot.className = "lf-dot";
    dot.style.background = LABEL_HEX[g.label] || LABEL_HEX[0];

    var name = document.createElement("span");
    name.className = "lf-name";
    name.textContent = g.name;

    var switches = document.createElement("span");
    switches.className = "lf-switches";
    var soloBtn = iconButton("solo", g.solo, "Solo the folder's layers");
    var eyeBtn = iconButton("eye", g.hide, "Hide the folder's layers");
    var lockBtn = iconButton("lock", g.lock, "Lock the folder's layers");
    switches.appendChild(soloBtn);
    switches.appendChild(eyeBtn);
    switches.appendChild(lockBtn);

    var count = document.createElement("button");
    count.type = "button";
    if (g.moved) {
      count.className = "lf-moved";
      count.textContent = "moved";
      count.title = "The layers aren't together under the folder anymore -- click to repair";
    } else {
      count.className = "lf-count";
      count.title = "Select the " + g.count + " layer" + (g.count === 1 ? "" : "s") + " (Shift: add to selection)";
      var dots = document.createElement("span");
      dots.className = "lf-count-dots";
      for (var d = 0; d < g.dots.length; d += 1) {
        var md = document.createElement("i");
        md.style.background = LABEL_HEX[g.dots[d]] || LABEL_HEX[0];
        dots.appendChild(md);
      }
      var num = document.createElement("span");
      num.textContent = g.count;
      count.appendChild(dots);
      count.appendChild(num);
    }

    row.appendChild(chev);
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(switches);
    row.appendChild(count);
    if (g.fx) {
      var fx = document.createElement("span");
      fx.className = "lf-fx";
      fx.textContent = "↓ FX";
      fx.title = "Group FX: an adjustment layer -- its effects also reach layers below the folder";
      row.insertBefore(fx, count);
    }

    row.addEventListener("click", function (event) {
      if (editing) { return; }
      var mode = event.shiftKey && event.altKey ? "soloRecursive" : event.shiftKey ? "solo" : event.altKey ? "recursive" : "toggle";
      act("lfToggle", [g.id, mode, storeGet(KEY_ACCORDION, "0") === "1"], true);
    });
    name.addEventListener("dblclick", function (event) {
      event.stopPropagation();
      startRename(g, name);
    });
    count.addEventListener("click", function (event) {
      event.stopPropagation();
      if (g.moved) { openMenu(g, event.clientX, event.clientY, true); return; }
      act("lfSelect", [g.id, !!event.shiftKey]);
    });
    soloBtn.addEventListener("click", function (event) { event.stopPropagation(); act("lfOverride", [g.id, "solo"], true); });
    eyeBtn.addEventListener("click", function (event) { event.stopPropagation(); act("lfOverride", [g.id, "hide"], true); });
    lockBtn.addEventListener("click", function (event) { event.stopPropagation(); act("lfOverride", [g.id, "lock"], true); });
    row.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      openMenu(g, event.clientX, event.clientY, false);
    });
    return row;
  }

  function startRename(g, nameEl) {
    editing = g.id;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "lf-rename";
    input.value = g.name;
    input.maxLength = 80;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function finish(save) {
      if (done) { return; }
      done = true;
      editing = null;
      var value = input.value.replace(/^\s+|\s+$/g, "");
      lastSig = "";
      if (save && value && value !== g.name) { act("lfRename", [g.id, value], true); }
      else { render(state); }
    }
    input.addEventListener("click", function (event) { event.stopPropagation(); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { finish(true); }
      else if (event.key === "Escape") { finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  // ---------------------------------------------------------------
  // Menu do botão direito
  // ---------------------------------------------------------------
  var menuEl = null;

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  function menuItem(menu, label, onClick, opts) {
    opts = opts || {};
    var b = document.createElement("button");
    b.type = "button";
    b.className = "lf-menu-item" + (opts.danger ? " is-danger" : "");
    var check = document.createElement("span");
    check.className = "lf-menu-check";
    if (opts.checked) { check.innerHTML = ICONS.check; }
    var text = document.createElement("span");
    text.textContent = label;
    b.appendChild(check);
    b.appendChild(text);
    if (opts.hint) {
      var hint = document.createElement("span");
      hint.className = "lf-menu-hint";
      hint.textContent = opts.hint;
      b.appendChild(hint);
    }
    if (opts.hold) {
      holdToRun(b, onClick);
    } else {
      b.addEventListener("click", function (event) { event.stopPropagation(); onClick(event); });
    }
    menu.appendChild(b);
    return b;
  }

  function separator(menu) {
    var s = document.createElement("div");
    s.className = "lf-menu-sep";
    menu.appendChild(s);
  }

  // Ações destrutivas: segurar ~0,7 s (ou Alt+clique) -- soltar antes ou
  // sair do botão cancela.
  function holdToRun(button, run) {
    var timer = null;
    var fill = document.createElement("span");
    fill.className = "lf-hold-fill";
    button.appendChild(fill);
    button.classList.add("is-hold");
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      button.classList.remove("is-holding");
    }
    button.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
      if (event.altKey) { run(event); return; }
      button.classList.add("is-holding");
      timer = setTimeout(function () { timer = null; button.classList.remove("is-holding"); run(event); }, 700);
    });
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("click", function (event) { event.stopPropagation(); });
  }

  function openMenu(g, x, y, repairOnly) {
    closeMenu();
    var menu = document.createElement("div");
    menu.className = "lf-menu";
    menuEl = menu;
    menu.addEventListener("click", function (event) { event.stopPropagation(); });
    menu.addEventListener("contextmenu", function (event) { event.preventDefault(); event.stopPropagation(); });

    if (g.moved) {
      menuItem(menu, "Regather layers", function () { act("lfRepair", [g.id, "regather"]); }, { hint: "move them back" });
      menuItem(menu, "Update to what's under it", function () { act("lfRepair", [g.id, "update"]); }, { hint: "keep positions" });
      if (repairOnly) { place(menu, x, y); return; }
      separator(menu);
    }

    var colorMembers = storeGet(KEY_COLOR_MEMBERS, "1") === "1";
    var swatches = document.createElement("div");
    swatches.className = "lf-swatches";
    for (var c = 1; c < LABEL_HEX.length; c += 1) {
      (function (label) {
        var sw = document.createElement("button");
        sw.type = "button";
        sw.className = "lf-swatch" + (g.label === label ? " is-current" : "");
        sw.style.background = LABEL_HEX[label];
        sw.title = labelName(label);
        sw.addEventListener("click", function (event) {
          event.stopPropagation();
          act("lfColor", [g.id, label, storeGet(KEY_COLOR_MEMBERS, "1") === "1"], true);
        });
        swatches.appendChild(sw);
      }(c));
    }
    menu.appendChild(swatches);
    menuItem(menu, "Color its layers too", function () {
      storeSet(KEY_COLOR_MEMBERS, colorMembers ? "0" : "1");
      openMenu(g, x, y, false);
    }, { checked: colorMembers });
    separator(menu);

    menuItem(menu, "Rename…", function () {
      closeMenu();
      var row = document.querySelector('.lf-row[data-id="' + g.id + '"] .lf-name');
      if (row) { startRename(g, row); }
    });
    menuItem(menu, "Select " + g.count + " layer" + (g.count === 1 ? "" : "s"), function () { act("lfSelect", [g.id, false]); });
    separator(menu);
    menuItem(menu, "Solo", function () { act("lfOverride", [g.id, "solo"], true); }, { checked: g.solo });
    menuItem(menu, "Hide", function () { act("lfOverride", [g.id, "hide"], true); }, { checked: g.hide });
    menuItem(menu, "Lock", function () { act("lfOverride", [g.id, "lock"], true); }, { checked: g.lock });
    separator(menu);
    menuItem(menu, "Up", function () { act("lfMove", [g.id, "up"], true); });
    menuItem(menu, "Down", function () { act("lfMove", [g.id, "down"], true); });
    menuItem(menu, "Duplicate", function () { act("lfDuplicate", [g.id]); });
    separator(menu);
    menuItem(menu, "Parent to folder", function () { act("lfParent", [g.id]); }, { checked: g.parenting, hint: "layers follow the Null" });
    var matteToggle = menuItem(menu, "Folder matte", function () {
      matteList.hidden = !matteList.hidden;
    }, { checked: !!g.matte, hint: "▾" });
    var matteList = document.createElement("div");
    matteList.className = "lf-submenu";
    matteList.hidden = true;
    if (!state.matteOk) {
      var note = document.createElement("div");
      note.className = "lf-menu-note";
      note.textContent = "Needs After Effects 2023 or later.";
      matteList.appendChild(note);
    } else {
      menuItem(matteList, "None", function () { act("lfMatte", [g.id, 0], true); }, { checked: !g.matte });
      for (var m = 0; m < g.matteChoices.length; m += 1) {
        (function (choice) {
          menuItem(matteList, choice.name, function () { act("lfMatte", [g.id, choice.id], true); }, { checked: g.matte === choice.id });
        }(g.matteChoices[m]));
      }
    }
    matteToggle.after(matteList);
    menuItem(menu, "Folder FX", function () { act("lfFx", [g.id]); }, { checked: g.fx, hint: "adjustment layer" });
    separator(menu);
    menuItem(menu, "Ungroup", function () { act("lfUngroup", [g.id]); }, { hint: "keep layers" });
    menuItem(menu, "Dissolve", function () { act("lfDissolve", [g.id]); }, { danger: true, hold: true, hint: "hold · deletes layers" });
    menuItem(menu, "Strip all folders", function () { act("lfStrip", []); }, { danger: true, hold: true, hint: "hold" });

    place(menu, x, y);
  }

  function labelName(label) {
    return (labelNames && labelNames[label - 1]) || LABEL_NAMES[label];
  }

  function place(menu, x, y) {
    document.body.appendChild(menu);
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;
    var left = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    var top = Math.max(6, Math.min(y, window.innerHeight - h - 6));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  // ---------------------------------------------------------------
  // Barra
  // ---------------------------------------------------------------
  function setAccordionButton() {
    var b = $("lf-accordion");
    if (!b) { return; }
    var on = storeGet(KEY_ACCORDION, "0") === "1";
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.classList.toggle("is-on", on);
  }

  function init() {
    if (!$("lf-tree")) { return; }
    $("lf-group").innerHTML = ICONS.group + "<span>Group</span>";
    $("lf-fold").innerHTML = ICONS.fold;
    $("lf-unfold").innerHTML = ICONS.unfold;
    $("lf-accordion").innerHTML = ICONS.accordion;
    setAccordionButton();

    $("lf-group").addEventListener("click", function (event) {
      act("lfGroup", [{ folded: !!event.shiftKey, parent: !!event.altKey }]);
    });
    $("lf-fold").addEventListener("click", function (event) { act("lfFoldAll", [true, !!event.altKey]); });
    $("lf-unfold").addEventListener("click", function (event) { act("lfFoldAll", [false, !!event.altKey]); });
    $("lf-accordion").addEventListener("click", function () {
      var on = storeGet(KEY_ACCORDION, "0") !== "1";
      storeSet(KEY_ACCORDION, on ? "1" : "0");
      setAccordionButton();
      status(on ? "Accordion on: opening a folder folds the others at the same level." : "Accordion off.", "success");
    });

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") { closeMenu(); } });
    window.addEventListener("blur", closeMenu);

    // Atualiza quando a aba Effects aparece, quando o painel ganha foco e
    // quando o mouse volta pra ele (o usuário mexeu na timeline).
    var page = $("page-effects");
    if (page && window.MutationObserver) {
      new MutationObserver(function () { if (!page.hidden) { lastSig = ""; refresh(); } })
        .observe(page, { attributes: true, attributeFilter: ["hidden"] });
    }
    var lastPing = 0;
    function ping() {
      var now = Date.now();
      if (now - lastPing < 400) { return; }
      lastPing = now;
      refresh();
    }
    window.addEventListener("focus", ping);
    document.addEventListener("mouseenter", ping);
    var section = document.querySelector('[data-section-id="layer-folders"]');
    if (section) { section.addEventListener("pointerenter", ping); }

    call("lfLabels", [], function (res) {
      if (res && res.ok) { labelNames = res.names; }
    });
    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);
}());
