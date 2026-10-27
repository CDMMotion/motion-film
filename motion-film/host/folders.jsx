/*
 * Mótion Film -- Folders (pastas de camadas na timeline).
 *
 * Nossa versão da ideia do "Accordion" (Motion Fun): camadas relacionadas
 * ficam juntas embaixo de um Null "cabeçalho" e a pasta inteira some da
 * timeline ao fechar -- sem precompor. Fechar usa o switch Shy do AE (e
 * liga "Hide Shy Layers" da comp); as camadas continuam renderizando.
 *
 * Carregado sob demanda pela aba Effects (client/folders.js) via
 * $.evalFile, igual ao figma.jsx.
 *
 * Onde os dados ficam: no COMENTÁRIO do Null cabeçalho (vai junto com o
 * .aep, sem arquivo externo):
 *   "mf-folder:" + JSON {
 *     v, id, name,
 *     members:  [layer.id]      membros diretos, na ordem (cabeçalhos de
 *                               subpastas entram aqui também)
 *     folded:   bool
 *     base:     {id: bool}      shy "do usuário" de cada membro direto
 *     hid:      {id: true}      membros que ESTA pasta está escondendo agora
 *     parented: [id]            membros que o "Parent to header" ligou
 *     matte:    id | 0          membro usado como matte do grupo
 *     fx:       id | 0          adjustment layer "Group FX"
 *     ov:       {solo|hide|lock: {id: valor anterior}}  overrides ligados
 *   }
 * layer.id (AE 2022+) é estável dentro do projeto.
 *
 * Regras de ExtendScript: nada de Array.indexOf/forEach; um undo group por
 * ação (NUNCA aninhado -- ver HANDOFF: "Undo group mismatch" no AE 26.5).
 */
(function () {
  var MARK = "mf-folder:";
  // Ciclo de cores de pasta nova (índices de label do AE): Blue, Green,
  // Orange, Purple, Cyan, Pink, Yellow, Red.
  var CYCLE = [8, 9, 11, 10, 14, 4, 2, 1];

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }

  function fail(msg) { return stringify({ ok: false, error: msg }); }

  function activeComp() {
    var item = app.project ? app.project.activeItem : null;
    return (item && item instanceof CompItem) ? item : null;
  }

  function has(list, v) {
    for (var i = 0; i < list.length; i += 1) { if (list[i] === v) { return true; } }
    return false;
  }

  function without(list, v) {
    var out = [];
    for (var i = 0; i < list.length; i += 1) { if (list[i] !== v) { out.push(list[i]); } }
    return out;
  }

  // ---------------------------------------------------------------
  // Leitura da comp: cabeçalhos, árvore, descendentes
  // ---------------------------------------------------------------
  function readData(layer) {
    var c = "";
    try { c = layer.comment; } catch (e) { return null; }
    if (!c || c.indexOf(MARK) !== 0) { return null; }
    try {
      var d = JSON.parse(c.substring(MARK.length));
      if (!d || !d.id) { return null; }
      d.members = d.members || [];
      d.base = d.base || {};
      d.hid = d.hid || {};
      d.parented = d.parented || [];
      d.ov = d.ov || {};
      return d;
    } catch (parseError) {
      return null;
    }
  }

  function scan(comp) {
    var st = { comp: comp, byId: {}, list: [], groups: [], byGid: {}, byHeader: {} };
    for (var i = 1; i <= comp.numLayers; i += 1) {
      var L = comp.layer(i);
      st.byId[L.id] = L;
      st.list.push(L);
      var d = readData(L);
      if (d) {
        var g = { data: d, header: L, parent: null, children: [] };
        // Pasta duplicada à mão (mesmo id em dois cabeçalhos): a 2a ganha
        // id novo pra não brigar.
        if (st.byGid[d.id]) { d.id = newGid(); g.dirty = true; }
        st.groups.push(g);
        st.byGid[d.id] = g;
        st.byHeader[L.id] = g;
      }
    }
    // Membros que não existem mais saem; liga pai/filhos.
    for (var k = 0; k < st.groups.length; k += 1) {
      var gr = st.groups[k];
      var kept = [];
      for (var m = 0; m < gr.data.members.length; m += 1) {
        var id = gr.data.members[m];
        if (st.byId[id] && id !== gr.header.id) { kept.push(id); }
      }
      if (kept.length !== gr.data.members.length) { gr.data.members = kept; gr.dirty = true; }
    }
    for (var p = 0; p < st.groups.length; p += 1) {
      var gp = st.groups[p];
      for (var q = 0; q < gp.data.members.length; q += 1) {
        var child = st.byHeader[gp.data.members[q]];
        if (child && !child.parent) {
          child.parent = gp;
          gp.children.push(child);
        }
      }
    }
    return st;
  }

  // Todos os layers dentro da pasta (membros + subpastas inteiras), sem o
  // próprio cabeçalho.
  function descendants(st, g, out) {
    out = out || [];
    for (var i = 0; i < g.data.members.length; i += 1) {
      var L = st.byId[g.data.members[i]];
      if (!L) { continue; }
      out.push(L);
      var child = st.byHeader[L.id];
      if (child && child.parent === g) { descendants(st, child, out); }
    }
    return out;
  }

  function sortByIndex(layers) {
    return layers.sort(function (a, b) { return a.index - b.index; });
  }

  // Bloco = cabeçalho + descendentes na ordem atual da timeline.
  function block(st, g) {
    return sortByIndex([g.header].concat(descendants(st, g)));
  }

  function ownerOf(st, id) {
    for (var i = 0; i < st.groups.length; i += 1) {
      if (has(st.groups[i].data.members, id)) { return st.groups[i]; }
    }
    return null;
  }

  function depthOf(g) {
    var d = 0;
    var p = g.parent;
    while (p) { d += 1; p = p.parent; }
    return d;
  }

  // Descendentes estão logo abaixo do cabeçalho, sem nada no meio?
  function isMoved(st, g) {
    var desc = descendants(st, g);
    if (!desc.length) { return false; }
    var h = g.header.index;
    var seen = {};
    for (var i = 0; i < desc.length; i += 1) {
      var idx = desc[i].index;
      if (idx <= h || idx > h + desc.length || seen[idx]) { return true; }
      seen[idx] = true;
    }
    return false;
  }

  function save(g) {
    try { g.header.comment = MARK + JSON.stringify(g.data); } catch (e) {}
  }

  function newGid() {
    return "f" + new Date().getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------------------------------------------------------------
  // Mexer em layer travado: destrava, faz, trava de novo
  // ---------------------------------------------------------------
  function withUnlocked(L, fn) {
    var was = false;
    try { was = L.locked; } catch (e) {}
    if (was) { try { L.locked = false; } catch (e2) {} }
    try { fn(L); } catch (e3) {}
    if (was) { try { L.locked = true; } catch (e4) {} }
  }

  function setShy(L, v) {
    if (L.shy === v) { return; }
    withUnlocked(L, function (x) { x.shy = v; });
  }

  // ---------------------------------------------------------------
  // Aplica o estado aberto/fechado de todas as pastas nos switches Shy.
  // Cada layer gerenciado: shy = shy do usuário OU escondido por alguma
  // pasta fechada acima dele. "base" é atualizado a partir do layer
  // enquanto ele está visível, então um Shy que o usuário mexeu à mão
  // com a pasta aberta é respeitado.
  // ---------------------------------------------------------------
  function headerName(g, st) {
    var n = String(g.data.name || "Group");
    return g.data.folded ? "▸ " + n + " (" + descendants(st, g).length + ")" : "▾ " + n;
  }

  function applyFolds(st) {
    var anyFolded = false;
    function visit(g, hiddenAbove) {
      if (g.data.folded) { anyFolded = true; }
      var hideKids = hiddenAbove || g.data.folded;
      for (var i = 0; i < g.data.members.length; i += 1) {
        var id = g.data.members[i];
        var L = st.byId[id];
        if (!L) { continue; }
        if (hideKids) {
          if (!g.data.hid[id]) { g.data.base[id] = !!L.shy; g.data.hid[id] = true; }
          setShy(L, true);
        } else {
          if (g.data.hid[id]) { setShy(L, !!g.data.base[id]); delete g.data.hid[id]; }
          else { g.data.base[id] = !!L.shy; }
        }
        var child = st.byHeader[id];
        if (child && child.parent === g) { visit(child, hideKids); }
      }
      var nm = headerName(g, st);
      if (g.header.name !== nm) { withUnlocked(g.header, function (x) { x.name = nm; }); }
      save(g);
    }
    for (var t = 0; t < st.groups.length; t += 1) {
      if (!st.groups[t].parent) { visit(st.groups[t], false); }
    }
    if (anyFolded) {
      try { st.comp.hideShyLayers = true; } catch (e) {}
    }
  }

  // ---------------------------------------------------------------
  // Mover blocos de layers
  // ---------------------------------------------------------------
  // Põe `layers` (na ordem dada) logo abaixo de `anchor`.
  function placeAfter(layers, anchor) {
    var prev = anchor;
    for (var i = 0; i < layers.length; i += 1) {
      var L = layers[i];
      if (L === prev) { continue; }
      withUnlocked(L, function (x) { x.moveAfter(prev); });
      prev = L;
    }
  }

  // Põe `layers` (na ordem dada) logo acima de `anchor`.
  function placeBefore(layers, anchor) {
    for (var i = 0; i < layers.length; i += 1) {
      var L = layers[i];
      if (L === anchor) { continue; }
      withUnlocked(L, function (x) { x.moveBefore(anchor); });
    }
  }

  function spanOf(layers) {
    var a = null, b = null;
    for (var i = 0; i < layers.length; i += 1) {
      var L = layers[i];
      if (a === null || L.inPoint < a) { a = L.inPoint; }
      if (b === null || L.outPoint > b) { b = L.outPoint; }
    }
    return { a: a, b: b };
  }

  function fitHeader(st, g) {
    var desc = descendants(st, g);
    if (!desc.length) { return; }
    var s = spanOf(desc);
    withUnlocked(g.header, function (h) {
      try { h.inPoint = s.a; h.outPoint = s.b; } catch (e) {
        try { h.startTime = s.a; h.inPoint = s.a; h.outPoint = s.b; } catch (e2) {}
      }
    });
  }

  function uniqueName(st, base) {
    base = String(base || "Group").replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, "").substring(0, 80) || "Group";
    var used = {};
    for (var i = 0; i < st.groups.length; i += 1) { used[String(st.groups[i].data.name)] = true; }
    if (!used[base]) { return base; }
    for (var n = 2; n < 1000; n += 1) {
      if (!used[base + " " + n]) { return base + " " + n; }
    }
    return base;
  }

  // ---------------------------------------------------------------
  // Estado pra montar a lista no painel
  // ---------------------------------------------------------------
  function groupInfo(st, g) {
    var desc = descendants(st, g);
    var dots = [];
    for (var i = 0; i < g.data.members.length && dots.length < 5; i += 1) {
      var L = st.byId[g.data.members[i]];
      if (L) { dots.push(L.label); }
    }
    var matteChoices = [];
    for (var j = 0; j < g.data.members.length && matteChoices.length < 40; j += 1) {
      var M = st.byId[g.data.members[j]];
      if (M && !st.byHeader[M.id] && M.id !== g.data.fx) {
        matteChoices.push({ id: M.id, name: M.name });
      }
    }
    var ancestorFolded = false;
    var p = g.parent;
    while (p) { if (p.data.folded) { ancestorFolded = true; } p = p.parent; }
    return {
      id: g.data.id,
      name: g.data.name,
      label: g.header.label,
      folded: !!g.data.folded,
      depth: depthOf(g),
      parentId: g.parent ? g.parent.data.id : null,
      ancestorFolded: ancestorFolded,
      count: desc.length,
      dots: dots,
      moved: isMoved(st, g),
      solo: !!g.data.ov.solo,
      hide: !!g.data.ov.hide,
      lock: !!g.data.ov.lock,
      parenting: g.data.parented.length > 0,
      matte: g.data.matte || 0,
      fx: !!g.data.fx,
      matteChoices: matteChoices
    };
  }

  // Ordem da lista = ordem da timeline, com subpastas logo abaixo da mãe.
  function orderedGroups(st) {
    var out = [];
    function walk(g) {
      out.push(g);
      var kids = g.children.slice(0).sort(function (a, b) { return a.header.index - b.header.index; });
      for (var i = 0; i < kids.length; i += 1) { walk(kids[i]); }
    }
    var tops = [];
    for (var t = 0; t < st.groups.length; t += 1) { if (!st.groups[t].parent) { tops.push(st.groups[t]); } }
    tops.sort(function (a, b) { return a.header.index - b.header.index; });
    for (var k = 0; k < tops.length; k += 1) { walk(tops[k]); }
    return out;
  }

  function stateOf(st) {
    var groups = orderedGroups(st);
    var out = [];
    for (var i = 0; i < groups.length; i += 1) { out.push(groupInfo(st, groups[i])); }
    var aeOk = parseFloat(app.version) >= 22;
    return { ok: true, comp: st.comp.name, compId: st.comp.id, groups: out, matteOk: parseFloat(app.version) >= 23, aeOk: aeOk };
  }

  function lfState() {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: null, groups: [] }); }
    var st = scan(comp);
    // Pastas que tiveram membros apagados: grava a lista limpa.
    for (var i = 0; i < st.groups.length; i += 1) { if (st.groups[i].dirty) { save(st.groups[i]); } }
    return stringify(stateOf(st));
  }

  // Executa uma ação de edição dentro de UM undo group e devolve o estado
  // novo junto (o painel redesenha sem outra chamada).
  function run(label, fn) {
    var comp = activeComp();
    if (!comp) { return fail("Open a composition first."); }
    if (parseFloat(app.version) < 22) { return fail("Folders need After Effects 2022 or later."); }
    var res;
    app.beginUndoGroup("Mótion Film Folders: " + label);
    try {
      var st = scan(comp);
      res = fn(st, comp) || { ok: true };
    } catch (error) {
      res = { ok: false, error: String(error) + (error.line ? " (line " + error.line + ")" : "") };
    }
    app.endUndoGroup();
    if (res.ok !== false) {
      var fresh = stateOf(scan(comp));
      res.state = fresh;
    }
    return stringify(res);
  }

  function findGroup(st, gid) {
    var g = st.byGid[gid];
    if (!g) { throw new Error("That folder is gone. Refresh the list."); }
    return g;
  }

  // ---------------------------------------------------------------
  // Criar pasta
  // ---------------------------------------------------------------
  // Unidades da seleção da timeline: layer solto, ou uma pasta inteira
  // (cabeçalho + bloco). Selecionar cabeçalho e conteúdo não conta o
  // conteúdo duas vezes: tudo que está DENTRO de uma pasta cujo cabeçalho
  // foi selecionado já vai junto com ela. Em ordem de timeline.
  function selectedUnits(st, comp) {
    var sel = sortByIndex(toArray(comp.selectedLayers));
    var covered = {};
    var units = [];
    var skipped = 0;
    for (var i = 0; i < sel.length; i += 1) {
      var hg = st.byHeader[sel[i].id];
      if (hg) {
        var inner = descendants(st, hg);
        for (var b = 0; b < inner.length; b += 1) { covered[inner[b].id] = true; }
      }
    }
    for (var j = 0; j < sel.length; j += 1) {
      var L = sel[j];
      if (covered[L.id]) { continue; }
      var asHeader = st.byHeader[L.id];
      if (!asHeader && L.locked) { skipped += 1; continue; }
      units.push({ head: L, layers: asHeader ? block(st, asHeader) : [L] });
    }
    return { units: units, skipped: skipped, any: sel.length > 0 };
  }

  // Tira um membro direto dos dados da pasta (não move nem mexe no layer).
  function detach(g, id) {
    g.data.members = without(g.data.members, id);
    delete g.data.hid[id];
    delete g.data.base[id];
    if (g.data.matte === id) { g.data.matte = 0; }
    if (g.data.fx === id) { g.data.fx = 0; }
  }

  // Último layer do bloco da pasta que não está entre os que vão mudar de
  // lugar: é ali embaixo que eles entram (ou saem).
  function blockEnd(st, g, moving) {
    var blk = block(st, g);
    for (var i = blk.length - 1; i >= 0; i -= 1) {
      if (!moving[blk[i].id]) { return blk[i]; }
    }
    return g.header;
  }

  function lfGroup(opts) {
    opts = opts || {};
    return run("Group", function (st, comp) {
      var picked = selectedUnits(st, comp);
      var units = picked.units;
      var skipped = picked.skipped;
      if (!units.length) {
        return { ok: false, error: skipped ? "Selected layers are locked." : "Select layers to group." };
      }
      // A pasta nova entra na pasta (se houver) de quem está mais acima.
      var container = ownerOf(st, units[0].head.id);
      // Tira as unidades das pastas antigas.
      for (var u = 0; u < units.length; u += 1) {
        var old = ownerOf(st, units[u].head.id);
        if (old) { detach(old, units[u].head.id); }
      }

      var name = uniqueName(st, opts.name || "Group");
      var header = comp.layers.addNull();
      header.moveBefore(units[0].layers[0]);
      var gid = newGid();
      var color = opts.color > 0 ? opts.color : CYCLE[st.groups.length % CYCLE.length];
      try { header.label = color; } catch (e) {}
      header.name = "▾ " + name;
      try { header.enabled = false; } catch (eEnabled) {} // Null não renderiza mesmo; olho desligado deixa claro que é só organização
      var data = { v: 1, id: gid, name: name, members: [], folded: false, base: {}, hid: {}, parented: [], matte: 0, fx: 0, ov: {} };
      var ordered = [];
      for (var w = 0; w < units.length; w += 1) {
        data.members.push(units[w].head.id);
        data.base[units[w].head.id] = !!units[w].head.shy;
        for (var x = 0; x < units[w].layers.length; x += 1) { ordered.push(units[w].layers[x]); }
      }
      placeAfter(ordered, header);
      var g = { data: data, header: header, parent: null, children: [] };
      save(g);
      if (container) {
        // No lugar do primeiro membro movido.
        var pos = 0;
        for (var c = 0; c < container.data.members.length; c += 1) {
          var cl = st.byId[container.data.members[c]];
          if (cl && cl.index < header.index) { pos = c + 1; }
        }
        container.data.members.splice(pos, 0, header.id);
        container.data.base[header.id] = false;
        save(container);
      }
      st = scan(comp);
      g = st.byHeader[header.id];
      fitHeader(st, g);
      if (opts.folded) { g.data.folded = true; }
      if (opts.parent) { setParenting(st, g, true); }
      applyFolds(st);
      for (var d = 1; d <= comp.numLayers; d += 1) { comp.layer(d).selected = false; }
      header.selected = true;
      return { ok: true, message: "Grouped " + descendants(st, g).length + " layer" + (descendants(st, g).length === 1 ? "" : "s") + (opts.folded ? " (folded)" : "") + (skipped ? " · skipped " + skipped + " locked" : ""), id: gid };
    });
  }

  function toArray(c) {
    var out = [];
    for (var i = 0; i < c.length; i += 1) { out.push(c[i]); }
    return out;
  }

  // ---------------------------------------------------------------
  // Abrir / fechar
  // ---------------------------------------------------------------
  function siblingsOf(st, g) {
    var out = [];
    for (var i = 0; i < st.groups.length; i += 1) {
      var o = st.groups[i];
      if (o !== g && o.parent === g.parent) { out.push(o); }
    }
    return out;
  }

  function setTree(g, folded) {
    g.data.folded = folded;
    for (var i = 0; i < g.children.length; i += 1) { setTree(g.children[i], folded); }
  }

  // mode: toggle | open | recursive (Alt) | solo (Shift: abre e fecha as
  // irmãs) | soloRecursive (Shift+Alt).
  function lfToggle(gid, mode) {
    return run("Fold", function (st) {
      var g = findGroup(st, gid);
      if (mode === "recursive") {
        setTree(g, !g.data.folded);
      } else if (mode === "solo" || mode === "soloRecursive") {
        if (mode === "soloRecursive") { setTree(g, false); } else { g.data.folded = false; }
        var sib = siblingsOf(st, g);
        for (var i = 0; i < sib.length; i += 1) { sib[i].data.folded = true; }
      } else if (mode === "open") {
        g.data.folded = false;
      } else {
        g.data.folded = !g.data.folded;
      }
      applyFolds(st);
      return { ok: true };
    });
  }

  // Header spans grow with what came in (the folder and the ones above it).
  function fitUp(st, g) {
    while (g) { fitHeader(st, g); g = g.parent; }
  }

  // Botão "Add": os layers selecionados na timeline entram na pasta
  // selecionada no painel, no fim dela (saem da pasta onde estavam).
  function lfAdd(gid) {
    return run("Add to folder", function (st, comp) {
      var g = findGroup(st, gid);
      var picked = selectedUnits(st, comp);
      // não entram: a própria pasta e as que estão acima dela (laço) nem
      // quem já é membro direto dela
      var above = {};
      for (var p = g; p; p = p.parent) { above[p.header.id] = true; }
      var units = [];
      for (var i = 0; i < picked.units.length; i += 1) {
        var u = picked.units[i];
        if (above[u.head.id] || has(g.data.members, u.head.id)) { continue; }
        units.push(u);
      }
      if (!units.length) {
        if (!picked.any) { return { ok: false, error: "Select layers in the timeline to add to “" + g.data.name + "”." }; }
        if (picked.units.length) { return { ok: false, error: "Those layers are already in “" + g.data.name + "”." }; }
        return { ok: false, error: picked.skipped ? "Selected layers are locked." : "Select layers in the timeline to add." };
      }
      var moving = {};
      var ordered = [];
      for (var m = 0; m < units.length; m += 1) {
        for (var x = 0; x < units[m].layers.length; x += 1) {
          moving[units[m].layers[x].id] = true;
          ordered.push(units[m].layers[x]);
        }
      }
      var anchor = blockEnd(st, g, moving);
      for (var d = 0; d < units.length; d += 1) {
        var old = ownerOf(st, units[d].head.id);
        if (old) { detach(old, units[d].head.id); save(old); }
      }
      for (var n = 0; n < units.length; n += 1) {
        var head = units[n].head;
        g.data.members.push(head.id);
        g.data.base[head.id] = !!head.shy;
        // "Parent to folder" ligado: quem entra segue o Null também
        if (g.data.parented.length && !st.byHeader[head.id]) {
          var hasParent = false;
          try { hasParent = !!head.parent; } catch (e) {}
          if (!hasParent) {
            withUnlocked(head, function (L) { L.parent = g.header; });
            g.data.parented.push(head.id);
          }
        }
      }
      save(g);
      placeAfter(ordered, anchor);
      st = scan(comp);
      g = st.byGid[gid];
      fitUp(st, g);
      applyFolds(st);
      var count = units.length;
      return { ok: true, message: "Added " + count + " layer" + (count === 1 ? "" : "s") + " to “" + g.data.name + "”" + (g.data.folded ? " (folded)" : "") };
    });
  }

  // Botão "Remove": os layers selecionados saem da pasta onde estão e
  // ficam logo abaixo dela (numa subpasta, sobem um nível: entram na mãe).
  function lfRemove() {
    return run("Remove from folder", function (st, comp) {
      var picked = selectedUnits(st, comp);
      var units = [];
      for (var i = 0; i < picked.units.length; i += 1) {
        if (ownerOf(st, picked.units[i].head.id)) { units.push(picked.units[i]); }
      }
      if (!units.length) {
        return { ok: false, error: picked.any ? "The selected layers aren't in a folder." : "Select layers in the timeline to take out of their folder." };
      }
      // De baixo pra cima: cada um vai pra logo abaixo do bloco, então a
      // ordem entre eles se mantém.
      for (var k = units.length - 1; k >= 0; k -= 1) {
        var u = units[k];
        var id = u.head.id;
        var owner = ownerOf(st, id);
        if (!owner) { continue; }
        if (owner.data.hid[id]) { setShy(u.head, !!owner.data.base[id]); }
        // solta o que a pasta ligou nele: parent no Null, matte do grupo
        if (has(owner.data.parented, id)) {
          try { if (u.head.parent && u.head.parent.id === owner.header.id) { withUnlocked(u.head, function (L) { L.parent = null; }); } } catch (e1) {}
          owner.data.parented = without(owner.data.parented, id);
        }
        if (owner.data.matte) {
          if (owner.data.matte === id) {
            for (var a = 0; a < owner.data.members.length; a += 1) {
              var M = st.byId[owner.data.members[a]];
              try { if (M && M.trackMatteLayer && M.trackMatteLayer.id === id) { withUnlocked(M, function (L) { L.removeTrackMatte(); }); } } catch (e2) {}
            }
          } else {
            try { if (u.head.trackMatteLayer && u.head.trackMatteLayer.id === owner.data.matte) { withUnlocked(u.head, function (L) { L.removeTrackMatte(); }); } } catch (e3) {}
          }
        }
        var moving = {};
        for (var x = 0; x < u.layers.length; x += 1) { moving[u.layers[x].id] = true; }
        var anchor = blockEnd(st, owner, moving);
        detach(owner, id);
        save(owner);
        var up = owner.parent;
        if (up) {
          var pos = up.data.members.length;
          for (var q = 0; q < up.data.members.length; q += 1) { if (up.data.members[q] === owner.header.id) { pos = q + 1; } }
          up.data.members.splice(pos, 0, id);
          up.data.base[id] = !!u.head.shy;
          save(up);
        }
        placeAfter(u.layers, anchor);
        st = scan(comp);
      }
      applyFolds(st);
      var count = units.length;
      return { ok: true, message: "Took " + count + " layer" + (count === 1 ? "" : "s") + " out of " + (count === 1 ? "its folder" : "their folders") };
    });
  }

  // ---------------------------------------------------------------
  // Nome, cor, seleção
  // ---------------------------------------------------------------
  function lfRename(gid, name) {
    name = String(name || "").replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, "").substring(0, 80);
    if (!name) { return stringify({ ok: true, ignored: true }); }
    return run("Rename", function (st) {
      var g = findGroup(st, gid);
      g.data.name = name;
      applyFolds(st);
      return { ok: true };
    });
  }

  function lfColor(gid, label, withMembers) {
    return run("Color", function (st) {
      var g = findGroup(st, gid);
      withUnlocked(g.header, function (h) { h.label = label; });
      if (withMembers) {
        for (var i = 0; i < g.data.members.length; i += 1) {
          var L = st.byId[g.data.members[i]];
          if (L && !st.byHeader[L.id]) { withUnlocked(L, function (x) { x.label = label; }); }
        }
      }
      return { ok: true };
    });
  }

  // Seleção não entra no undo (igual ao Accordion).
  function lfSelect(gid, add) {
    var comp = activeComp();
    if (!comp) { return fail("Open a composition first."); }
    var st = scan(comp);
    var g = st.byGid[gid];
    if (!g) { return fail("That folder is gone. Refresh the list."); }
    if (!add) { for (var i = 1; i <= comp.numLayers; i += 1) { comp.layer(i).selected = false; } }
    var desc = descendants(st, g);
    for (var j = 0; j < desc.length; j += 1) { try { desc[j].selected = true; } catch (e) {} }
    return stringify({ ok: true, message: "Selected " + desc.length + " layer" + (desc.length === 1 ? "" : "s") });
  }

  // ---------------------------------------------------------------
  // Solo / Hide / Lock com memória dos switches de cada layer
  // ---------------------------------------------------------------
  var OVERRIDES = {
    solo: { prop: "solo", on: true, headers: false },
    hide: { prop: "enabled", on: false, headers: false },
    lock: { prop: "locked", on: true, headers: true }
  };

  function lfOverride(gid, kind) {
    var spec = OVERRIDES[kind];
    if (!spec) { return fail("Unknown switch."); }
    return run(kind.charAt(0).toUpperCase() + kind.substring(1), function (st) {
      var g = findGroup(st, gid);
      var desc = descendants(st, g);
      var mem = g.data.ov[kind];
      if (mem) {
        // Desliga: cada layer volta ao que era.
        for (var i = 0; i < desc.length; i += 1) {
          var L = desc[i];
          if (mem.hasOwnProperty(L.id)) {
            var prev = mem[L.id];
            if (kind === "lock") { try { L.locked = prev; } catch (e) {} }
            else { withUnlocked(L, function (x) { try { x[spec.prop] = prev; } catch (e2) {} }); }
          }
        }
        delete g.data.ov[kind];
      } else {
        mem = {};
        for (var j = 0; j < desc.length; j += 1) {
          var M = desc[j];
          if (st.byHeader[M.id] && !spec.headers) { continue; }
          try {
            mem[M.id] = M[spec.prop];
            if (kind === "lock") { M.locked = true; }
            else { withUnlocked(M, function (x) { try { x[spec.prop] = spec.on; } catch (e3) {} }); }
          } catch (e4) {}
        }
        g.data.ov[kind] = mem;
      }
      save(g);
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------
  // Subir / descer entre as irmãs
  // ---------------------------------------------------------------
  function lfMove(gid, dir) {
    return run(dir === "up" ? "Up" : "Down", function (st, comp) {
      var g = findGroup(st, gid);
      var mine = block(st, g);
      var sibs = siblingsOf(st, g).sort(function (a, b) { return a.header.index - b.header.index; });
      var target = null;
      for (var i = 0; i < sibs.length; i += 1) {
        if (dir === "up" && sibs[i].header.index < g.header.index) { target = sibs[i]; }
        if (dir === "down" && sibs[i].header.index > g.header.index && !target) { target = sibs[i]; }
      }
      if (target) {
        var tb = block(st, target);
        if (dir === "up") { placeBefore(mine, tb[0]); }
        else { var rev = mine.slice(0).reverse(); for (var r = 0; r < rev.length; r += 1) { (function (L, after) { withUnlocked(L, function (x) { x.moveAfter(after); }); }(rev[r], tb[tb.length - 1])); } }
        return { ok: true };
      }
      // Sem irmã nessa direção: vai pra borda da pasta mãe / da comp.
      if (dir === "up") {
        var top = g.parent ? g.parent.header : null;
        var firstIdx = top ? top.index + 1 : 1;
        if (g.header.index === firstIdx) { return { ok: false, error: "Already at the top." }; }
        if (top) { placeAfter(mine, top); } else { placeBefore(mine, comp.layer(1)); }
      } else {
        var lastIdx;
        var anchor;
        if (g.parent) { var pb = block(st, g.parent); anchor = pb[pb.length - 1]; lastIdx = anchor.index; }
        else { anchor = comp.layer(comp.numLayers); lastIdx = comp.numLayers; }
        if (mine[mine.length - 1].index === lastIdx) { return { ok: false, error: "Already at the bottom." }; }
        var rev2 = mine.slice(0).reverse();
        for (var k = 0; k < rev2.length; k += 1) { (function (L) { withUnlocked(L, function (x) { x.moveAfter(anchor); }); }(rev2[k])); }
      }
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------
  // Duplicar a pasta inteira (com subpastas), logo acima da original
  // ---------------------------------------------------------------
  function lfDuplicate(gid) {
    return run("Duplicate", function (st, comp) {
      var g = findGroup(st, gid);
      var blk = block(st, g);
      var map = {};
      var copies = [];
      for (var i = 0; i < blk.length; i += 1) {
        var c = null;
        withUnlocked(blk[i], function (x) { c = x.duplicate(); });
        if (c) { map[blk[i].id] = c; copies.push(c); }
      }
      placeBefore(copies, blk[0]);
      // Parent e matte entre layers copiados apontam pras cópias.
      for (var j = 0; j < blk.length; j += 1) {
        var orig = blk[j];
        var cp = map[orig.id];
        if (!cp) { continue; }
        try { if (orig.parent && map[orig.parent.id]) { withUnlocked(cp, function (x) { x.parent = map[orig.parent.id]; }); } } catch (e1) {}
        try {
          if (orig.trackMatteLayer && map[orig.trackMatteLayer.id]) {
            var tmt = orig.trackMatteType;
            withUnlocked(cp, function (x) { x.setTrackMatte(map[orig.trackMatteLayer.id], tmt); });
          }
        } catch (e2) {}
      }
      // Cabeçalhos copiados: id novo e listas apontando pras cópias.
      function remapList(list) {
        var out = [];
        for (var a = 0; a < list.length; a += 1) { if (map[list[a]]) { out.push(map[list[a]].id); } }
        return out;
      }
      function remapObj(obj) {
        var out = {};
        for (var key in obj) { if (obj.hasOwnProperty(key) && map[key]) { out[map[key].id] = obj[key]; } }
        return out;
      }
      for (var h = 0; h < blk.length; h += 1) {
        var og = st.byHeader[blk[h].id];
        if (!og || !map[blk[h].id]) { continue; }
        var d = JSON.parse(JSON.stringify(og.data));
        d.id = newGid();
        d.members = remapList(d.members);
        d.base = remapObj(d.base);
        d.hid = remapObj(d.hid);
        d.parented = remapList(d.parented);
        d.matte = d.matte && map[d.matte] ? map[d.matte].id : 0;
        d.fx = d.fx && map[d.fx] ? map[d.fx].id : 0;
        var ov = {};
        for (var k in d.ov) { if (d.ov.hasOwnProperty(k)) { ov[k] = remapObj(d.ov[k]); } }
        d.ov = ov;
        if (og === g) { d.name = uniqueName(st, og.data.name + " copy"); }
        map[blk[h].id].comment = MARK + JSON.stringify(d);
      }
      // A cópia é irmã da original na mesma pasta mãe.
      if (g.parent) {
        var mem = g.parent.data.members;
        for (var m = 0; m < mem.length; m += 1) {
          if (mem[m] === g.header.id) { mem.splice(m, 0, map[g.header.id].id); break; }
        }
        g.parent.data.base[map[g.header.id].id] = false;
        save(g.parent);
      }
      st = scan(comp);
      applyFolds(st);
      for (var s = 1; s <= comp.numLayers; s += 1) { comp.layer(s).selected = false; }
      map[g.header.id].selected = true;
      return { ok: true, message: "Duplicated “" + g.data.name + "”" };
    });
  }

  // ---------------------------------------------------------------
  // Parent to header / Group matte / Group FX
  // ---------------------------------------------------------------
  function setParenting(st, g, on) {
    if (on) {
      var done = [];
      for (var i = 0; i < g.data.members.length; i += 1) {
        var L = st.byId[g.data.members[i]];
        if (!L || L.id === g.data.fx) { continue; }
        var hasParent = false;
        try { hasParent = !!L.parent; } catch (e) {}
        if (hasParent) { continue; }
        // .parent = mantém a posição na tela (o AE recalcula os valores).
        withUnlocked(L, function (x) { x.parent = g.header; });
        done.push(L.id);
      }
      g.data.parented = done;
    } else {
      for (var j = 0; j < g.data.parented.length; j += 1) {
        var M = st.byId[g.data.parented[j]];
        try { if (M && M.parent && M.parent.id === g.header.id) { withUnlocked(M, function (x) { x.parent = null; }); } } catch (e2) {}
      }
      g.data.parented = [];
    }
    save(g);
  }

  function lfParent(gid) {
    return run("Parent to header", function (st) {
      var g = findGroup(st, gid);
      var on = !g.data.parented.length;
      setParenting(st, g, on);
      return { ok: true, message: on ? "Layers follow “" + g.data.name + "”" : "Parenting released" };
    });
  }

  function lfMatte(gid, matteId) {
    if (parseFloat(app.version) < 23) { return fail("Group matte needs After Effects 2023 or later."); }
    return run("Group matte", function (st) {
      var g = findGroup(st, gid);
      var old = g.data.matte ? st.byId[g.data.matte] : null;
      // Tira as ligações da matte antiga.
      for (var i = 0; i < g.data.members.length; i += 1) {
        var L = st.byId[g.data.members[i]];
        if (!L || !old) { continue; }
        try { if (L.trackMatteLayer && L.trackMatteLayer.id === old.id) { withUnlocked(L, function (x) { x.removeTrackMatte(); }); } } catch (e) {}
      }
      g.data.matte = 0;
      if (matteId) {
        var matte = st.byId[matteId];
        if (!matte || !has(g.data.members, matteId)) { throw new Error("Pick a layer from this folder."); }
        for (var j = 0; j < g.data.members.length; j += 1) {
          var M = st.byId[g.data.members[j]];
          if (!M || M.id === matteId || M.id === g.data.fx || st.byHeader[M.id]) { continue; }
          withUnlocked(M, function (x) { x.setTrackMatte(matte, TrackMatteType.ALPHA); });
        }
        g.data.matte = matteId;
      }
      save(g);
      return { ok: true };
    });
  }

  function lfFx(gid) {
    return run("Group FX", function (st, comp) {
      var g = findGroup(st, gid);
      var cur = g.data.fx ? st.byId[g.data.fx] : null;
      if (cur) {
        var src = null;
        try { src = cur.source; } catch (e) {}
        withUnlocked(cur, function (x) { x.remove(); });
        try { if (src && src.usedIn && src.usedIn.length === 0) { src.remove(); } } catch (e2) {}
        g.data.members = without(g.data.members, g.data.fx);
        g.data.fx = 0;
        save(g);
        st = scan(comp);
        applyFolds(st);
        return { ok: true, message: "Group FX removed" };
      }
      var fx = comp.layers.addSolid([1, 1, 1], g.data.name + " · FX", comp.width, comp.height, comp.pixelAspect, comp.duration);
      fx.adjustmentLayer = true;
      fx.moveAfter(g.header);
      try { fx.label = g.header.label; } catch (e3) {}
      try { fx.inPoint = g.header.inPoint; fx.outPoint = g.header.outPoint; } catch (e4) {}
      g.data.members.unshift(fx.id);
      g.data.base[fx.id] = false;
      g.data.fx = fx.id;
      save(g);
      st = scan(comp);
      applyFolds(st);
      for (var s = 1; s <= comp.numLayers; s += 1) { comp.layer(s).selected = false; }
      fx.selected = true;
      return { ok: true, message: "Group FX added -- its effects also reach layers below the folder" };
    });
  }

  // ---------------------------------------------------------------
  // Desfazer pasta / apagar tudo / remover todas
  // ---------------------------------------------------------------
  // Tira o cabeçalho e devolve os layers: shy salvo restaurado, membros
  // passam pra pasta mãe, layers com parent no cabeçalho vão pro parent
  // dele (ou ficam sem).
  function removeHeader(st, g) {
    for (var id in g.data.hid) {
      if (g.data.hid.hasOwnProperty(id) && st.byId[id]) { setShy(st.byId[id], !!g.data.base[id]); }
    }
    var newParent = null;
    try { newParent = g.header.parent; } catch (e) {}
    for (var i = 0; i < st.list.length; i += 1) {
      var L = st.list[i];
      try { if (L.parent && L.parent.id === g.header.id) { withUnlocked(L, function (x) { x.parent = newParent; }); } } catch (e2) {}
    }
    if (g.parent) {
      var pm = g.parent.data.members;
      var out = [];
      for (var m = 0; m < pm.length; m += 1) {
        if (pm[m] === g.header.id) {
          for (var k = 0; k < g.data.members.length; k += 1) {
            out.push(g.data.members[k]);
            g.parent.data.base[g.data.members[k]] = !!g.data.base[g.data.members[k]];
          }
        } else { out.push(pm[m]); }
      }
      g.parent.data.members = out;
      delete g.parent.data.hid[g.header.id];
      delete g.parent.data.base[g.header.id];
      save(g.parent);
    }
    var src = null;
    try { src = g.header.source; } catch (e3) {}
    withUnlocked(g.header, function (x) { x.remove(); });
    try { if (src && src.usedIn && src.usedIn.length === 0) { src.remove(); } } catch (e4) {}
  }

  function lfUngroup(gid) {
    return run("Ungroup", function (st, comp) {
      var g = findGroup(st, gid);
      var n = g.data.members.length;
      removeHeader(st, g);
      st = scan(comp);
      applyFolds(st);
      return { ok: true, message: "Ungrouped " + n + " layer" + (n === 1 ? "" : "s") };
    });
  }

  function lfDissolve(gid) {
    return run("Dissolve", function (st) {
      var g = findGroup(st, gid);
      var blk = block(st, g);
      if (g.parent) {
        g.parent.data.members = without(g.parent.data.members, g.header.id);
        save(g.parent);
      }
      for (var i = blk.length - 1; i >= 0; i -= 1) {
        try { blk[i].locked = false; } catch (e) {}
        try { blk[i].remove(); } catch (e2) {}
      }
      return { ok: true, message: "Dissolved " + (blk.length - 1) + " layer" + (blk.length === 2 ? "" : "s") };
    });
  }

  function lfStrip() {
    return run("Strip all folders", function (st, comp) {
      var n = st.groups.length;
      if (!n) { return { ok: false, error: "No folders in this comp." }; }
      // Das mais fundas pras de fora (cada uma passa os membros pra mãe).
      while (st.groups.length) {
        var deepest = st.groups[0];
        for (var i = 1; i < st.groups.length; i += 1) {
          if (depthOf(st.groups[i]) > depthOf(deepest)) { deepest = st.groups[i]; }
        }
        removeHeader(st, deepest);
        st = scan(comp);
      }
      return { ok: true, message: "Stripped " + n + " folder" + (n === 1 ? "" : "s") + " · shy switches restored" };
    });
  }

  // ---------------------------------------------------------------
  // Reparar pasta "moved"
  // ---------------------------------------------------------------
  function gatherOrder(st, g) {
    var out = [];
    var direct = [];
    for (var i = 0; i < g.data.members.length; i += 1) { if (st.byId[g.data.members[i]]) { direct.push(st.byId[g.data.members[i]]); } }
    sortByIndex(direct);
    for (var j = 0; j < direct.length; j += 1) {
      out.push(direct[j]);
      var child = st.byHeader[direct[j].id];
      if (child && child.parent === g) { out = out.concat(gatherOrder(st, child)); }
    }
    return out;
  }

  function lfRepair(gid, how) {
    return run(how === "update" ? "Update folder" : "Regather layers", function (st, comp) {
      var g = findGroup(st, gid);
      if (how === "update") {
        var desc = descendants(st, g);
        var end = g.header.index;
        for (var i = 0; i < desc.length; i += 1) { if (desc[i].index > end) { end = desc[i].index; } }
        var childIds = {};
        for (var c = 0; c < g.children.length; c += 1) {
          var cd = descendants(st, g.children[c]);
          for (var d = 0; d < cd.length; d += 1) { childIds[cd[d].id] = true; }
        }
        var members = [];
        for (var idx = g.header.index + 1; idx <= end; idx += 1) {
          var L = comp.layer(idx);
          var other = st.byHeader[L.id];
          if (other && other.parent !== g) { break; } // cabeçalho de outra pasta: para aqui
          if (childIds[L.id]) { continue; }
          var ow = ownerOf(st, L.id);
          if (ow && ow !== g) {
            ow.data.members = without(ow.data.members, L.id);
            save(ow);
          }
          members.push(L.id);
          if (!g.data.base.hasOwnProperty(L.id)) { g.data.base[L.id] = !!L.shy; }
        }
        // Quem saiu do bloco volta ao shy do usuário.
        for (var m = 0; m < g.data.members.length; m += 1) {
          var oldId = g.data.members[m];
          if (!has(members, oldId) && g.data.hid[oldId] && st.byId[oldId]) {
            setShy(st.byId[oldId], !!g.data.base[oldId]);
            delete g.data.hid[oldId];
          }
        }
        g.data.members = members;
        save(g);
      } else {
        // Primeiro as subpastas, depois esta.
        var kids = g.children;
        for (var k = 0; k < kids.length; k += 1) {
          var kb = gatherOrder(st, kids[k]);
          placeAfter(kb, kids[k].header);
        }
        placeAfter(gatherOrder(st, g), g.header);
      }
      st = scan(comp);
      var g2 = st.byGid[gid];
      if (g2) { fitHeader(st, g2); }
      applyFolds(st);
      return { ok: true };
    });
  }

  function lfInfo() { return stringify({ ok: true, loaded: true }); }

  // Nomes de label que o usuário configurou no AE (Preferences > Labels),
  // pro menu de cores. (As CORES vêm como bytes crus que o ExtendScript
  // corrompe acima de 127 -- testado: Red saía #671819 --, então o painel
  // usa a tabela padrão do AE.)
  function lfLabels() {
    var names = [];
    for (var i = 1; i <= 16; i += 1) {
      var n = "";
      try { n = app.preferences.getPrefAsString("Label Preference Text Section 7", "Label Text ID 2 # " + i, PREFType.PREF_Type_MACHINE_INDEPENDENT); } catch (e) {}
      names.push(n || "");
    }
    return stringify({ ok: true, names: names });
  }
  $.global.lfLabels = lfLabels;

  $.global.lfInfo = lfInfo;
  $.global.lfState = lfState;
  $.global.lfGroup = lfGroup;
  $.global.lfToggle = lfToggle;
  $.global.lfAdd = lfAdd;
  $.global.lfRemove = lfRemove;
  $.global.lfRename = lfRename;
  $.global.lfColor = lfColor;
  $.global.lfSelect = lfSelect;
  $.global.lfOverride = lfOverride;
  $.global.lfMove = lfMove;
  $.global.lfDuplicate = lfDuplicate;
  $.global.lfParent = lfParent;
  $.global.lfMatte = lfMatte;
  $.global.lfFx = lfFx;
  $.global.lfUngroup = lfUngroup;
  $.global.lfDissolve = lfDissolve;
  $.global.lfStrip = lfStrip;
  $.global.lfRepair = lfRepair;
}());
