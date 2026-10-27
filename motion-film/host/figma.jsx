/*
 * Mótion Figma Layers -- construtor do lado do After Effects.
 *
 * Carregado sob demanda pela janela "Mótion Figma Layers" (client/figma.js)
 * via $.evalFile, no mesmo motor ExtendScript compartilhado do bundle, pra
 * não inchar o host.jsx principal. Recebe o caminho de um JSON gravado pelo
 * painel (payload do plugin do Figma + caminhos dos PNGs já salvos em
 * disco) e monta comps/camadas.
 *
 * Formato do payload: ver figma-plugin/code.js (extract()). Cada "desc" de
 * camada traz uma transform já resolvida no espaço da comp de destino
 * (xf: x, y, rot, sx, sy) com âncora na origem local do nó (canto
 * superior esquerdo), então aqui só aplicamos -- nada de recalcular
 * layout.
 *
 * Regras do ExtendScript seguidas aqui (ver HANDOFF.md): nada de
 * Array.indexOf; terminar cada grupo de propriedades antes de adicionar o
 * próximo (addProperty invalida referências irmãs).
 */
(function () {
  function stringify(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '{"ok":false,"error":"Could not serialize host response."}';
    }
  }

  function readJsonFile(path) {
    var f = new File(path);
    f.encoding = "UTF-8";
    if (!f.open("r")) {
      throw new Error("Não consegui abrir " + path);
    }
    var text = f.read();
    f.close();
    try {
      return JSON.parse(text);
    } catch (jsonError) {
      return eval("(" + text + ")");
    }
  }

  function activeComp() {
    var item = app.project ? app.project.activeItem : null;
    return (item && item instanceof CompItem) ? item : null;
  }

  function num(v, fallback) {
    return (typeof v === "number" && !isNaN(v)) ? v : fallback;
  }

  function clampSize(v) {
    return Math.max(4, Math.min(30000, Math.ceil(num(v, 100))));
  }

  function findOrCreateFolder(name, parent) {
    parent = parent || app.project.rootFolder;
    for (var i = 1; i <= parent.numItems; i += 1) {
      var it = parent.item(i);
      if (it instanceof FolderItem && it.name === name) {
        return it;
      }
    }
    var folder = app.project.items.addFolder(name);
    folder.parentFolder = parent;
    return folder;
  }

  function note(ctx, text) {
    for (var i = 0; i < ctx.warnings.length; i += 1) {
      if (ctx.warnings[i] === text) {
        return;
      }
    }
    ctx.warnings.push(text);
  }

  // ---------------------------------------------------------------
  // Fontes: nome de família/estilo do Figma -> PostScript name do AE
  // ---------------------------------------------------------------
  function normStyle(s) {
    return String(s || "").toLowerCase().replace(/[\s\-_]/g, "");
  }

  var STYLE_ALIASES = {
    regular: ["regular", "normal", "book", "roman", "plain"],
    italic: ["italic", "regularitalic", "oblique"]
  };

  function resolveFont(family, style, ctx) {
    var key = family + "|" + style;
    if (ctx.fontCache.hasOwnProperty(key)) {
      return ctx.fontCache[key];
    }
    var ps = null;
    try {
      var list = app.fonts.getFontsByFamilyNameAndStyleName(family, style);
      if (list && list.length) {
        ps = list[0].postScriptName;
      }
    } catch (directError) {}

    if (!ps) {
      try {
        if (!ctx.allFonts) {
          ctx.allFonts = app.fonts.allFonts;
        }
        var famLower = String(family).toLowerCase();
        var wanted = normStyle(style);
        var aliases = STYLE_ALIASES[wanted] || [wanted];
        var familyFonts = null;
        for (var g = 0; g < ctx.allFonts.length && !familyFonts; g += 1) {
          var group = ctx.allFonts[g];
          if (group && group.length && String(group[0].familyName).toLowerCase() === famLower) {
            familyFonts = group;
          }
        }
        if (familyFonts) {
          for (var a = 0; a < aliases.length && !ps; a += 1) {
            for (var f = 0; f < familyFonts.length; f += 1) {
              if (normStyle(familyFonts[f].styleName) === aliases[a]) {
                ps = familyFonts[f].postScriptName;
                break;
              }
            }
          }
          if (!ps) {
            note(ctx, "Estilo \"" + style + "\" da fonte " + family + " não encontrado — usei " + familyFonts[0].styleName);
            ps = familyFonts[0].postScriptName;
          }
        }
      } catch (scanError) {}
    }

    if (!ps) {
      ctx.missingFonts[family + " " + style] = 1;
    }
    ctx.fontCache[key] = ps;
    return ps;
  }

  // ---------------------------------------------------------------
  // Transform / propriedades comuns
  // ---------------------------------------------------------------
  function transformOf(layer) {
    return layer.property("ADBE Transform Group");
  }

  function applyTransform(layer, xf, offset, anchor, scaleMul) {
    var tg = transformOf(layer);
    var k = num(scaleMul, 1);
    tg.property("ADBE Anchor Point").setValue(anchor || [0, 0]);
    tg.property("ADBE Position").setValue([num(xf.x, 0) + offset[0], num(xf.y, 0) + offset[1]]);
    if (Math.abs(num(xf.rot, 0)) > 0.0001) {
      tg.property("ADBE Rotate Z").setValue(xf.rot);
    }
    var sx = num(xf.sx, 1) * 100 * k;
    var sy = num(xf.sy, 1) * 100 * k;
    if (Math.abs(sx - 100) > 0.0001 || Math.abs(sy - 100) > 0.0001) {
      tg.property("ADBE Scale").setValue([sx, sy]);
    }
  }

  function applyCommon(layer, d, opacityMul, ctx) {
    try {
      layer.name = String(d.name || "Camada").substring(0, 250);
    } catch (nameError) {}
    var op = num(d.opacity, 1) * num(opacityMul, 1) * 100;
    if (op < 99.999) {
      transformOf(layer).property("ADBE Opacity").setValue(Math.max(0, op));
    }
    if (d.blend && typeof BlendingMode[d.blend] !== "undefined") {
      try {
        layer.blendingMode = BlendingMode[d.blend];
      } catch (blendError) {}
    }
    if (d.effects && d.effects.length) {
      applyEffects(layer, d.effects, ctx);
    }
  }

  function applyEffects(layer, effects, ctx) {
    for (var i = 0; i < effects.length; i += 1) {
      var e = effects[i];
      try {
        var parade = layer.property("ADBE Effect Parade");
        if (e.type === "shadow") {
          var fx = parade.addProperty("ADBE Drop Shadow");
          fx.property("ADBE Drop Shadow-0001").setValue([e.color[0], e.color[1], e.color[2], 1]);
          fx.property("ADBE Drop Shadow-0002").setValue(Math.max(0, Math.min(255, num(e.color[3], 1) * 255)));
          // Direção do AE: 0° = pra cima, sentido horário.
          var dir = Math.atan2(num(e.dx, 0), -num(e.dy, 0)) * 180 / Math.PI;
          if (dir < 0) {
            dir += 360;
          }
          fx.property("ADBE Drop Shadow-0003").setValue(dir);
          fx.property("ADBE Drop Shadow-0004").setValue(Math.sqrt(e.dx * e.dx + e.dy * e.dy));
          fx.property("ADBE Drop Shadow-0005").setValue(num(e.radius, 0));
          if (e.spread) {
            note(ctx, "Spread da sombra não existe no Drop Shadow do AE (ignorado)");
          }
        } else if (e.type === "blur") {
          var gb = parade.addProperty("ADBE Gaussian Blur 2");
          gb.property("ADBE Gaussian Blur 2-0001").setValue(num(e.radius, 0));
          gb.property("ADBE Gaussian Blur 2-0003").setValue(1);
        }
      } catch (fxError) {
        note(ctx, "Não consegui aplicar um efeito: " + fxError);
      }
    }
  }

  // ---------------------------------------------------------------
  // Shape layers
  // ---------------------------------------------------------------
  function makeShape(path) {
    var s = new Shape();
    s.vertices = path.v;
    s.inTangents = path.i;
    s.outTangents = path.o;
    s.closed = !!path.closed;
    return s;
  }

  function addGeometry(vecs, geom) {
    if (geom.kind === "rect") {
      var r = vecs.addProperty("ADBE Vector Shape - Rect");
      r.property("ADBE Vector Rect Size").setValue([geom.w, geom.h]);
      r.property("ADBE Vector Rect Position").setValue([geom.x + geom.w / 2, geom.y + geom.h / 2]);
      if (geom.r) {
        r.property("ADBE Vector Rect Roundness").setValue(geom.r);
      }
    } else if (geom.kind === "ellipse") {
      var e = vecs.addProperty("ADBE Vector Shape - Ellipse");
      e.property("ADBE Vector Ellipse Size").setValue([geom.w, geom.h]);
      e.property("ADBE Vector Ellipse Position").setValue([geom.x + geom.w / 2, geom.y + geom.h / 2]);
    } else {
      var paths = geom.paths || [];
      for (var i = 0; i < paths.length; i += 1) {
        var p = vecs.addProperty("ADBE Vector Shape - Group");
        p.property("ADBE Vector Shape").setValue(makeShape(paths[i]));
      }
    }
  }

  var CAPS = { butt: 1, round: 2, square: 3 };
  var JOINS = { miter: 1, round: 2, bevel: 3 };

  function addStroke(vecs, color, st) {
    var s = vecs.addProperty("ADBE Vector Graphic - Stroke");
    s.property("ADBE Vector Stroke Color").setValue([color[0], color[1], color[2], 1]);
    s.property("ADBE Vector Stroke Opacity").setValue(num(color[3], 1) * 100);
    s.property("ADBE Vector Stroke Width").setValue(st.weight);
    s.property("ADBE Vector Stroke Line Cap").setValue(CAPS[st.cap] || 1);
    s.property("ADBE Vector Stroke Line Join").setValue(JOINS[st.join] || 1);
    try {
      s.property("ADBE Vector Stroke Miter Limit").setValue(Math.max(1, num(st.miter, 4)));
    } catch (miterError) {}
    if (st.dash && st.dash.length) {
      var pattern = st.dash.slice(0);
      if (pattern.length % 2 === 1) {
        pattern = pattern.concat(pattern);
      }
      for (var k = 0; k < pattern.length && k < 6; k += 2) {
        try {
          var dashes = s.property("ADBE Vector Stroke Dashes");
          dashes.addProperty("ADBE Vector Stroke Dash " + (k / 2 + 1)).setValue(pattern[k]);
          dashes = s.property("ADBE Vector Stroke Dashes");
          dashes.addProperty("ADBE Vector Stroke Gap " + (k / 2 + 1)).setValue(pattern[k + 1]);
        } catch (dashError) {}
      }
    }
  }

  function addFill(vecs, color, winding) {
    var f = vecs.addProperty("ADBE Vector Graphic - Fill");
    f.property("ADBE Vector Fill Color").setValue([color[0], color[1], color[2], 1]);
    f.property("ADBE Vector Fill Opacity").setValue(num(color[3], 1) * 100);
    if (winding === "EVENODD") {
      f.property("ADBE Vector Fill Rule").setValue(2);
    }
  }

  function buildShape(comp, d, ctx) {
    var layer = comp.layers.addShape();
    var root = layer.property("ADBE Root Vectors Group");
    // parts vem de baixo pra cima; no AE o primeiro item da lista fica
    // por cima, então adiciona do topo pra base.
    for (var p = d.parts.length - 1; p >= 0; p -= 1) {
      var part = d.parts[p];
      var grp = root.addProperty("ADBE Vector Group");
      grp.name = String(part.name || "Shape").substring(0, 250);
      var vecs = grp.property("ADBE Vectors Group");
      addGeometry(vecs, part.geom);
      var winding = part.geom.winding;
      if (part.stroke) {
        for (var s = part.stroke.colors.length - 1; s >= 0; s -= 1) {
          addStroke(vecs, part.stroke.colors[s], part.stroke);
        }
      }
      for (var f = part.fills.length - 1; f >= 0; f -= 1) {
        addFill(vecs, part.fills[f], winding);
      }
    }
    return layer;
  }

  // ---------------------------------------------------------------
  // Texto
  // ---------------------------------------------------------------
  var JUSTIFY = {
    LEFT: "LEFT_JUSTIFY",
    CENTER: "CENTER_JUSTIFY",
    RIGHT: "RIGHT_JUSTIFY",
    JUSTIFIED: "FULL_JUSTIFY_LASTLINE_LEFT"
  };

  function applyCharStyle(target, seg, ctx, isRange) {
    var ps = resolveFont(seg.family, seg.style, ctx);
    if (ps) {
      try { target.font = ps; } catch (fontError) {}
    }
    try { target.fontSize = seg.size; } catch (sizeError) {}
    if (seg.color) {
      try {
        if (!isRange) { target.applyFill = true; }
        target.fillColor = [seg.color[0], seg.color[1], seg.color[2]];
      } catch (fillError) {}
    }
    try { target.tracking = Math.round(num(seg.tracking, 0)); } catch (trackError) {}
    try {
      if (seg.leading === null || seg.leading === undefined) {
        target.autoLeading = true;
      } else {
        target.autoLeading = false;
        target.leading = seg.leading;
      }
    } catch (leadError) {}
    try { target.allCaps = seg.caps === "all"; } catch (capsError) {}
    try { target.smallCaps = seg.caps === "small"; } catch (smallError) {}
  }

  function buildText(comp, d, ctx) {
    var t = d.text;
    var chars = String(t.chars || "");
    if (!chars.replace(/\s/g, "").length) {
      return null;
    }
    // Figma: "\n" = parágrafo, U+2028 = quebra de linha. AE: "\r" e U+0003.
    // Troca 1:1, então os índices dos segmentos continuam batendo.
    chars = chars.replace(/\n/g, "\r").split(String.fromCharCode(0x2028)).join(String.fromCharCode(3));

    var segs = t.segments || [];
    var seg0 = segs[0] || { size: 16, family: "Arial", style: "Regular" };
    var maxSize = 0;
    for (var i = 0; i < segs.length; i += 1) {
      if (segs[i].size > maxSize) { maxSize = segs[i].size; }
    }
    if (!maxSize) { maxSize = 16; }

    // Caixa de parágrafo com folga: texto "auto width" no Figma não pode
    // quebrar linha no AE só porque a métrica difere um pixel. A folga vai
    // pro lado oposto ao alinhamento, pra não mover o texto.
    var w = Math.max(1, num(d.w, 10));
    var h = Math.max(1, num(d.h, 10));
    var slack = t.autoResize === "WIDTH_AND_HEIGHT" ? Math.max(6, maxSize * 0.6) : 2;
    var boxW = w + slack;
    var boxX = 0;
    if (t.alignH === "RIGHT") { boxX = -slack; }
    else if (t.alignH === "CENTER") { boxX = -slack / 2; }
    var boxH = h + maxSize * 1.5;

    var layer = comp.layers.addBoxText([boxW, boxH], chars);
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var td = prop.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (resetError) {}
    applyCharStyle(td, seg0, ctx, false);
    try {
      td.justification = ParagraphJustification[JUSTIFY[t.alignH] || "LEFT_JUSTIFY"];
    } catch (justError) {}
    if (t.paragraphSpacing) {
      try { td.spaceAfter = t.paragraphSpacing; } catch (spaceError) {}
    }
    if (t.stroke && t.stroke.color) {
      try {
        td.applyStroke = true;
        td.strokeColor = [t.stroke.color[0], t.stroke.color[1], t.stroke.color[2]];
        td.strokeWidth = t.stroke.align === "CENTER" ? t.stroke.weight : t.stroke.weight * 2;
        td.strokeOverFill = t.stroke.align === "INSIDE";
      } catch (strokeError) {}
    }
    prop.setValue(td);

    if (segs.length > 1) {
      td = prop.value;
      for (var s = 0; s < segs.length; s += 1) {
        try {
          var cr = td.characterRange(segs[s].start, segs[s].end);
          applyCharStyle(cr, segs[s], ctx, true);
        } catch (rangeError) {
          note(ctx, "Estilos mistos dentro de um texto: parte não aplicada (" + rangeError + ")");
        }
      }
      prop.setValue(td);
    }

    // Âncora = canto da caixa de texto, pra a origem da camada cair na
    // origem do nó do Figma (mesma convenção das outras camadas).
    var boxPos = [-boxW / 2, -boxH / 2];
    try { boxPos = prop.value.boxTextPos; } catch (posError) {}
    var anchor = [boxPos[0] - boxX, boxPos[1]];

    // Correção fina: casa o topo dos glifos (e a borda do alinhamento) com
    // o que o Figma mediu, absorvendo a diferença de métrica da 1a linha.
    if (t.glyph) {
      try {
        var rect = layer.sourceRectAtTime(0, false);
        if (rect.width > 0 && rect.height > 0) {
          var dy = t.glyph.y - (rect.top - anchor[1]);
          if (Math.abs(dy) <= maxSize * 2) {
            anchor[1] -= dy;
          }
          var dx;
          if (t.alignH === "CENTER") {
            dx = (t.glyph.x + t.glyph.w / 2) - (rect.left + rect.width / 2 - anchor[0]);
          } else if (t.alignH === "RIGHT") {
            dx = (t.glyph.x + t.glyph.w) - (rect.left + rect.width - anchor[0]);
          } else {
            dx = t.glyph.x - (rect.left - anchor[0]);
          }
          if (Math.abs(dx) <= maxSize * 0.5) {
            anchor[0] -= dx;
          }
        }
      } catch (rectError) {}
    }

    // Opacidade da cor do texto (o AE não tem alfa por caractere).
    var alpha = seg0.color ? num(seg0.color[3], 1) : 1;
    d.__textAlpha = alpha;
    return { layer: layer, anchor: anchor };
  }

  // ---------------------------------------------------------------
  // Imagens
  // ---------------------------------------------------------------
  function footageFor(ctx, assetId) {
    if (ctx.footage[assetId]) {
      return ctx.footage[assetId];
    }
    var path = ctx.assetPaths[assetId];
    if (!path) {
      throw new Error("PNG não recebido (" + assetId + ")");
    }
    var file = new File(path);
    if (!file.exists) {
      throw new Error("PNG não encontrado em disco: " + path);
    }
    var item = app.project.importFile(new ImportOptions(file));
    try { item.parentFolder = ctx.assetFolder; } catch (folderError) {}
    ctx.footage[assetId] = item;
    return item;
  }

  // ---------------------------------------------------------------
  // Máscara arredondada (precomp de frame com cantos arredondados)
  // ---------------------------------------------------------------
  function roundedRectShape(w, h, radii) {
    var r = radii;
    if (typeof r === "number") { r = [r, r, r, r]; }
    var lim = Math.min(w, h) / 2;
    for (var i = 0; i < 4; i += 1) { r[i] = Math.max(0, Math.min(lim, num(r[i], 0))); }
    var k = 0.5522847;
    var s = new Shape();
    s.vertices = [[r[0], 0], [w - r[1], 0], [w, r[1]], [w, h - r[2]], [w - r[2], h], [r[3], h], [0, h - r[3]], [0, r[0]]];
    s.inTangents = [[-k * r[0], 0], [0, 0], [0, -k * r[1]], [0, 0], [k * r[2], 0], [0, 0], [0, k * r[3]], [0, 0]];
    s.outTangents = [[0, 0], [k * r[1], 0], [0, 0], [0, k * r[2]], [0, 0], [-k * r[3], 0], [0, 0], [0, -k * r[0]]];
    s.closed = true;
    return s;
  }

  // Cantos arredondados do frame do Figma como Mask na camada da comp.
  function addCornerMask(layer, w, h, radii) {
    try {
      var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
      m.property("ADBE Mask Shape").setValue(roundedRectShape(w, h, radii));
      m.name = "Cantos";
    } catch (maskError) {}
  }

  function hasRadius(radii) {
    if (typeof radii === "number") { return radii > 0; }
    if (radii && radii.length) {
      for (var i = 0; i < radii.length; i += 1) { if (radii[i] > 0) { return true; } }
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Árvore
  // ---------------------------------------------------------------
  function newComp(name, w, h, ctx, folder) {
    var comp = app.project.items.addComp(String(name || "Figma").substring(0, 250), clampSize(w), clampSize(h), 1, ctx.duration, ctx.fps);
    try { comp.parentFolder = folder || ctx.rootFolder; } catch (folderError) {}
    return comp;
  }

  // Retorna { top: [camadas do nível atual, pra parentear], all: [todas,
  // pra receber track matte] } ou null.
  function buildDesc(comp, d, ctx, offset, opacityMul) {
    var layer = null;
    var anchor = [0, 0];
    var scaleMul = 1;

    if (d.type === "group") {
      // Grupo (ou frame sem recorte) é achatado: os filhos entram direto na
      // comp, cada um já com a transform final -- sem Null de controle
      // (pedido do usuário: só as camadas). A opacidade do grupo é
      // multiplicada nos filhos.
      if (d.blend) {
        note(ctx, "Modo de mesclagem em grupo não é suportado (aplique na camada)");
      }
      return buildList(comp, d.children || [], ctx, offset, num(d.opacity, 1) * num(opacityMul, 1));
    }

    if (d.type === "shape") {
      layer = buildShape(comp, d, ctx);
    } else if (d.type === "text") {
      var built = buildText(comp, d, ctx);
      if (!built) { return null; }
      layer = built.layer;
      anchor = built.anchor;
      if (d.__textAlpha < 1) { opacityMul = num(opacityMul, 1) * d.__textAlpha; }
    } else if (d.type === "image") {
      layer = comp.layers.add(footageFor(ctx, d.asset));
      scaleMul = 1 / num(d.scale, 1);
    } else if (d.type === "precomp") {
      var sub = newComp(d.name, d.w, d.h, ctx, ctx.precompFolder);
      buildList(sub, d.children || [], ctx, [0, 0], 1);
      layer = comp.layers.add(sub);
      if (hasRadius(d.clipRadius)) {
        addCornerMask(layer, d.w, d.h, d.clipRadius);
      }
    } else {
      return null;
    }

    applyTransform(layer, d.xf, offset, anchor, scaleMul);
    applyCommon(layer, d, opacityMul, ctx);
    ctx.layerCount += 1;
    return { top: [layer], all: [layer] };
  }

  function buildList(comp, descs, ctx, offset, opacityMul) {
    var res = { top: [], all: [] };
    var matte = null;
    var matteType = null;
    for (var i = 0; i < descs.length; i += 1) {
      var d = descs[i];
      var r = null;
      try {
        r = buildDesc(comp, d, ctx, offset, opacityMul);
      } catch (buildError) {
        note(ctx, "Falha em \"" + d.name + "\": " + buildError + (buildError.line ? " (linha " + buildError.line + ")" : ""));
      }
      if (!r) { continue; }

      if (d.mask) {
        // No Figma a máscara recorta todos os irmãos acima dela.
        matte = r.all.length ? r.all[0] : r.top[0];
        matteType = d.mask === "LUMINANCE" ? TrackMatteType.LUMA : TrackMatteType.ALPHA;
        try { matte.name = "◩ " + matte.name; } catch (matteNameError) {}
      } else if (matte) {
        for (var a = 0; a < r.all.length; a += 1) {
          var L = r.all[a];
          var already = null;
          try { already = L.trackMatteLayer; } catch (tmError) {}
          if (already || L.nullLayer) { continue; }
          try { L.setTrackMatte(matte, matteType); } catch (setMatteError) {
            note(ctx, "Não consegui aplicar a máscara do Figma como track matte: " + setMatteError);
          }
        }
        try { matte.enabled = false; } catch (enableError) {}
      }

      for (var t = 0; t < r.top.length; t += 1) { res.top.push(r.top[t]); }
      for (var b = 0; b < r.all.length; b += 1) { res.all.push(r.all[b]); }
    }
    return res;
  }

  function mflBuild(jsonPath) {
    var data;
    try {
      data = readJsonFile(jsonPath);
    } catch (readError) {
      return stringify({ ok: false, error: "Não consegui ler os dados do Figma: " + readError });
    }
    var payload = data.payload || {};
    var groups = payload.groups || [];
    if (!groups.length) {
      return stringify({ ok: false, error: "Nada pra importar." });
    }
    if (!app.project) {
      app.newProject();
    }

    var active = activeComp();

    // Botão "Criar composição": comps vazias com o nome e o tamanho em
    // pixels de cada item selecionado no Figma. Vão pra raiz do projeto
    // (são comps de trabalho, não material importado), com fps/duração da
    // comp ativa quando houver; a última criada abre no viewer.
    if (payload.mode === "comp") {
      var made = [];
      var last = null;
      app.beginUndoGroup("Mótion Figma Layers: Criar composição");
      try {
        for (var e = 0; e < groups.length; e += 1) {
          var eg = groups[e];
          var w = Math.max(4, Math.min(30000, Math.round(num(eg.w, 1920))));
          var h = Math.max(4, Math.min(30000, Math.round(num(eg.h, 1080))));
          last = app.project.items.addComp(String(eg.name || "Figma").substring(0, 250), w, h, 1,
            active ? active.duration : 10, active ? active.frameRate : 30);
          made.push(last.name + " (" + w + "×" + h + ")");
        }
      } catch (compError) {
        app.endUndoGroup();
        return stringify({ ok: false, error: String(compError) });
      }
      app.endUndoGroup();
      if (last) {
        try { last.openInViewer(); } catch (openError) {}
      }
      return stringify({
        ok: true,
        message: made.length === 1 ? "Comp \"" + made[0].replace(/ \(([^)]*)\)$/, "\" criada ($1)") : made.length + " comps criadas",
        warnings: [],
        layers: 0,
        comps: made
      });
    }

    var ctx = {
      assetPaths: data.assetPaths || {},
      footage: {},
      warnings: [],
      fontCache: {},
      missingFonts: {},
      layerCount: 0,
      fps: active ? active.frameRate : 30,
      duration: active ? active.duration : 10
    };

    var rootName = payload.mode === "raster" ? "Figma PNG" : "Figma Layers";
    ctx.rootFolder = findOrCreateFolder("Mótion Figma Layers");
    // data.batchName comes from mflBatchName: unique, and the same name as
    // the folder on disk that holds this import's PNGs
    var batchName = String(data.batchName || groups[0].name || (groups[0].container && groups[0].container.name) || rootName);
    ctx.batchFolder = findOrCreateFolder(batchName, ctx.rootFolder);
    ctx.assetFolder = ctx.batchFolder;
    ctx.precompFolder = ctx.batchFolder;

    // Frames importados como comp: caixa total por frame de topo (ou página)
    // de onde vieram, pra manter o layout do Figma (ver placeOffset).
    var placeUnion = {};
    for (var pu = 0; pu < groups.length; pu += 1) {
      var pg = groups[pu].place;
      if (groups[pu].kind !== "comp" || !pg || !pg.bounds) { continue; }
      var u = placeUnion[pg.key] || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      u.x0 = Math.min(u.x0, pg.bounds.x); u.y0 = Math.min(u.y0, pg.bounds.y);
      u.x1 = Math.max(u.x1, pg.bounds.x + pg.bounds.w); u.y1 = Math.max(u.y1, pg.bounds.y + pg.bounds.h);
      placeUnion[pg.key] = u;
    }
    // Comp ativa do tamanho do frame de topo (ex.: o "quadro" já importado
    // ou criado com o botão Comp): mesma posição do Figma. Comp de outro
    // tamanho: o frame de topo fica centralizado e cada frame cai onde
    // estaria dentro dele -- importar um por vez dá o mesmo resultado que
    // todos juntos. Frames soltos na página (sem frame de topo): o conjunto
    // vai pro centro, mantendo a posição de um em relação ao outro.
    function placeOffset(place, target) {
      var c = place.container;
      if (c) {
        if (Math.abs(target.width - c.w) < 1 && Math.abs(target.height - c.h) < 1) {
          return [0, 0];
        }
        return [(target.width - c.w) / 2, (target.height - c.h) / 2];
      }
      var un = placeUnion[place.key];
      return [target.width / 2 - (un.x0 + un.x1) / 2, target.height / 2 - (un.y0 + un.y1) / 2];
    }

    var created = [];
    var placedInto = null;
    var toOpen = null;
    // Tudo que chega numa comp que já estava aberta fica selecionado lá
    // no fim (camadas soltas, PNGs e as comps dos frames).
    var arrivals = [];
    var arrivalComp = null;

    app.beginUndoGroup("Mótion Figma Layers: " + (payload.mode === "raster" ? "Rasterizar" : "Importar"));
    try {
      for (var g = 0; g < groups.length; g += 1) {
        var grp = groups[g];
        if (grp.kind === "comp") {
          var comp = newComp(grp.name, grp.w, grp.h, ctx, ctx.rootFolder);
          buildList(comp, grp.layers || [], ctx, [0, 0], 1);
          created.push(comp.name);
          if (active) {
            // Frame vira comp e entra como camada na comp ativa, no lugar
            // em que está no Figma (placeOffset); o usuário continua na
            // comp em que estava. Payload antigo, sem `place`: centralizada.
            var frameLayer = active.layers.add(comp);
            if (grp.place && grp.place.xf) {
              applyTransform(frameLayer, grp.place.xf, placeOffset(grp.place, active), [0, 0], 1);
            }
            if (hasRadius(grp.clipRadius)) {
              addCornerMask(frameLayer, grp.w, grp.h, grp.clipRadius);
            }
            arrivals.push(frameLayer);
            arrivalComp = active;
            placedInto = active.name;
            ctx.layerCount += 1;
          } else {
            toOpen = comp;
          }
        } else {
          var target = active;
          var offset = [0, 0];
          var cont = grp.container || { w: 100, h: 100, isFrame: false };
          var b = grp.bounds || { x: 0, y: 0, w: cont.w, h: cont.h };
          if (!target) {
            // Sem comp aberta: cria uma do tamanho do frame (mantém o layout)
            // ou, fora de frame, do tamanho da própria seleção.
            if (cont.isFrame) {
              target = newComp(cont.name, cont.w, cont.h, ctx, ctx.rootFolder);
            } else {
              target = newComp(cont.name, b.w, b.h, ctx, ctx.rootFolder);
              offset = [-b.x, -b.y];
            }
            active = target;
            toOpen = target;
            created.push(target.name);
          } else if (!(cont.isFrame && Math.abs(target.width - cont.w) < 1 && Math.abs(target.height - cont.h) < 1)) {
            // Comp de outro tamanho: centraliza a seleção nela.
            offset = [target.width / 2 - (b.x + b.w / 2), target.height / 2 - (b.y + b.h / 2)];
          }
          var res = buildList(target, grp.layers || [], ctx, offset, 1);
          placedInto = target.name;
          if (arrivalComp !== target) { arrivals = []; arrivalComp = target; }
          for (var t = 0; t < res.top.length; t += 1) { arrivals.push(res.top[t]); }
        }
      }
      // Deixa selecionado o que acabou de chegar.
      if (arrivalComp) {
        try {
          for (var s = 1; s <= arrivalComp.numLayers; s += 1) { arrivalComp.layer(s).selected = false; }
          for (var q = 0; q < arrivals.length; q += 1) { arrivals[q].selected = true; }
        } catch (selectError) {}
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) + (error.line ? " (linha " + error.line + ")" : ""), warnings: ctx.warnings });
    }
    app.endUndoGroup();

    if (toOpen) {
      try { toOpen.openInViewer(); } catch (openError) {}
    }

    var missing = [];
    for (var key in ctx.missingFonts) {
      if (ctx.missingFonts.hasOwnProperty(key)) { missing.push(key); }
    }
    if (missing.length) {
      ctx.warnings.unshift("Fontes não instaladas neste computador (texto ficou com a fonte padrão): " + missing.join(", "));
    }

    var msg;
    if (payload.mode === "raster") {
      msg = ctx.layerCount + " PNG" + (ctx.layerCount === 1 ? "" : "s") + " em \"" + (placedInto || created.join(", ")) + "\"";
    } else if (created.length && !placedInto) {
      msg = (created.length === 1 ? "Comp \"" + created[0] + "\"" : created.length + " comps") + " criada" + (created.length === 1 ? "" : "s") + " com " + ctx.layerCount + " camadas";
    } else if (created.length) {
      msg = (created.length === 1 ? "Comp \"" + created[0] + "\"" : created.length + " comps") + " adicionada" + (created.length === 1 ? "" : "s") + " em \"" + placedInto + "\"";
    } else {
      msg = ctx.layerCount + " camada" + (ctx.layerCount === 1 ? "" : "s") + " em \"" + placedInto + "\"";
    }
    return stringify({ ok: true, message: msg, warnings: ctx.warnings, layers: ctx.layerCount, comps: created });
  }

  function mflProjectDir() {
    try {
      if (app.project && app.project.file) {
        return stringify({ ok: true, dir: app.project.file.parent.fsName, name: app.project.file.name.replace(/\.aep$/i, "") });
      }
    } catch (error) {}
    return stringify({ ok: true, dir: "", name: "" });
  }

  // Name for one import: the project folder "Mótion Figma Layers › <name>"
  // and the disk folder "<diskRoot>/<name>" share it. A name already used
  // by either gets " 2", " 3"... so a re-import never mixes with (or
  // overwrites) an earlier one -- Collect Files mirrors the project folders,
  // and two PNGs with the same name in one folder would collide there.
  function mflBatchName(base, diskRoot) {
    base = String(base || "Figma");
    var taken = {};
    try {
      var root = app.project.rootFolder;
      for (var i = 1; i <= root.numItems; i += 1) {
        var it = root.item(i);
        if (it instanceof FolderItem && it.name === "Mótion Figma Layers") {
          for (var j = 1; j <= it.numItems; j += 1) { taken[it.item(j).name] = true; }
        }
      }
    } catch (scanError) {}
    for (var n = 1; n < 1000; n += 1) {
      var name = n === 1 ? base : base + " " + n;
      if (taken[name]) { continue; }
      if (diskRoot && new Folder(diskRoot + "/" + name).exists) { continue; }
      return stringify({ ok: true, name: name });
    }
    return stringify({ ok: true, name: base + " " + new Date().getTime() });
  }

  // Unsaved project: where this session's Figma images go
  function mflPickFolder() {
    var f = null;
    try { f = Folder.myDocuments.selectDlg("O projeto ainda não foi salvo. Escolha onde salvar as imagens do Figma desta sessão (de preferência a pasta onde o projeto vai ficar):"); } catch (dialogError) {}
    return stringify({ ok: true, dir: f ? f.fsName : "" });
  }

  function mflInfo() {
    return stringify({ ok: true, ae: app.version, loaded: true });
  }

  $.global.mflBuild = mflBuild;
  $.global.mflProjectDir = mflProjectDir;
  $.global.mflBatchName = mflBatchName;
  $.global.mflPickFolder = mflPickFolder;
  $.global.mflInfo = mflInfo;
}());
