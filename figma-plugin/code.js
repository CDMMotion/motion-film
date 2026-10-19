/*
 * Mótion Figma Layers -- lado Figma (thread principal do plugin).
 *
 * Lê a seleção atual e monta um "payload" que a janela Mótion Figma Layers
 * do After Effects transforma em camadas. Este arquivo NÃO fala com a rede:
 * quem envia é a ui.html (iframe), que recebe o payload por postMessage.
 *
 * Dois modos (os dois primeiros botões, no estilo do Overlord):
 *   - "layers": frame vira composição; formas viram shape layers editáveis,
 *     textos viram camadas de texto editáveis, frames que recortam viram
 *     precomps, grupos viram um Null (parent) com os filhos, e o que o AE
 *     não consegue representar nativamente (imagens, gradientes, tipos de
 *     nó exóticos) vai como PNG posicionado no lugar exato.
 *   - "raster": cada item selecionado vira UM PNG (grupos inteiros achatados).
 *
 * Coordenadas: tudo é calculado com a absoluteTransform de cada nó e a
 * inversa da transform do "container" (a composição de destino), então
 * auto layout, rotação e grupos aninhados caem no lugar certo sem casos
 * especiais.
 */

// Janela compacta no estilo do Overlord: só ícones + rodapé (o nome do
// plugin já aparece na barra de título nativa do Figma).
figma.showUI(__html__, { width: 220, height: 92 });

// ---------------------------------------------------------------
// Matrizes 2x3 do Figma: [[a, b, tx], [c, d, ty]] (x' = a*x + b*y + tx)
// ---------------------------------------------------------------
var IDENTITY = [[1, 0, 0], [0, 1, 0]];

function mul(A, B) {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1], A[0][0] * B[0][2] + A[0][1] * B[1][2] + A[0][2]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1], A[1][0] * B[0][2] + A[1][1] * B[1][2] + A[1][2]]
  ];
}

function inv(M) {
  var a = M[0][0], b = M[0][1], c = M[0][2], d = M[1][0], e = M[1][1], f = M[1][2];
  var det = a * e - b * d;
  if (Math.abs(det) < 1e-12) { det = 1e-12; }
  return [[e / det, -b / det, (b * f - c * e) / det], [-d / det, a / det, (c * d - a * f) / det]];
}

function translate(x, y) { return [[1, 0, x], [0, 1, y]]; }

function r4(n) { return Math.round(n * 10000) / 10000; }
function r3(n) { return Math.round(n * 1000) / 1000; }

// Posição da origem local, rotação (graus, horário = positivo como no AE)
// e escala com sinal (espelhamento vira escala negativa no eixo Y).
function decompose(M) {
  var sx = Math.sqrt(M[0][0] * M[0][0] + M[1][0] * M[1][0]) || 1;
  var det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  var rot = Math.atan2(M[1][0], M[0][0]) * 180 / Math.PI;
  return { x: r4(M[0][2]), y: r4(M[1][2]), rot: r4(rot), sx: r4(sx), sy: r4(det / sx) };
}

function isPlainXf(xf) {
  return Math.abs(xf.rot) < 0.01 && Math.abs(xf.sx - 1) < 0.001 && Math.abs(xf.sy - 1) < 0.001;
}

// ---------------------------------------------------------------
// Pinturas
// ---------------------------------------------------------------
function visiblePaints(paints) {
  if (!paints || paints === figma.mixed || !Array.isArray(paints)) { return []; }
  return paints.filter(function (p) {
    return p.visible !== false && (p.opacity === undefined || p.opacity > 0);
  });
}

function isSolid(p) { return p.type === "SOLID"; }

function solidColor(p) {
  return [r4(p.color.r), r4(p.color.g), r4(p.color.b), r4(p.opacity === undefined ? 1 : p.opacity)];
}

// Cor "representativa" de uma pintura não sólida (usada só em texto, que
// precisa continuar editável): o primeiro stop do gradiente.
function approxColor(p) {
  if (isSolid(p)) { return solidColor(p); }
  if (p.gradientStops && p.gradientStops.length) {
    var c = p.gradientStops[0].color;
    return [r4(c.r), r4(c.g), r4(c.b), r4(c.a * (p.opacity === undefined ? 1 : p.opacity))];
  }
  return null;
}

var BLEND_MODES = {
  NORMAL: 1, PASS_THROUGH: 1, DARKEN: 1, MULTIPLY: 1, COLOR_BURN: 1, LIGHTEN: 1, SCREEN: 1,
  COLOR_DODGE: 1, OVERLAY: 1, SOFT_LIGHT: 1, HARD_LIGHT: 1, DIFFERENCE: 1, EXCLUSION: 1,
  HUE: 1, SATURATION: 1, COLOR: 1, LUMINOSITY: 1, LINEAR_BURN: 1, LINEAR_DODGE: 1
};

function blendOf(node) {
  var b = node.blendMode;
  if (!b || b === "NORMAL" || b === "PASS_THROUGH" || !BLEND_MODES[b]) { return null; }
  return b;
}

// ---------------------------------------------------------------
// SVG path (geometria do Figma: M L Q C Z absolutos) -> vértices do AE
// ---------------------------------------------------------------
function parsePath(d) {
  var tokens = String(d || "").match(/[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  var subs = [];
  var cur = null;
  var i = 0;
  var cmd = null;
  var px = 0, py = 0;
  function num() { return parseFloat(tokens[i++]); }
  function start(x, y) {
    cur = { closed: false, pts: [{ x: x, y: y, ix: x, iy: y, ox: x, oy: y }] };
    subs.push(cur);
  }
  function ensure() { if (!cur) { start(px, py); } }
  function last() { return cur.pts[cur.pts.length - 1]; }
  function push(x, y, ix, iy) { cur.pts.push({ x: x, y: y, ix: ix, iy: iy, ox: x, oy: y }); px = x; py = y; }

  while (i < tokens.length) {
    var t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") {
        if (cur) {
          cur.closed = true;
          px = cur.pts[0].x; py = cur.pts[0].y;
        }
        cur = null;
        continue;
      }
    }
    if (cmd === "M") {
      px = num(); py = num(); start(px, py);
      cmd = "L"; // pares extras depois de M são L implícitos
    } else if (cmd === "L") {
      ensure(); var lx = num(), ly = num(); push(lx, ly, lx, ly);
    } else if (cmd === "H") {
      ensure(); var hx = num(); push(hx, py, hx, py);
    } else if (cmd === "V") {
      ensure(); var vy = num(); push(px, vy, px, vy);
    } else if (cmd === "C") {
      ensure();
      var x1 = num(), y1 = num(), x2 = num(), y2 = num(), cx = num(), cy = num();
      var lp = last(); lp.ox = x1; lp.oy = y1;
      push(cx, cy, x2, y2);
    } else if (cmd === "Q") {
      ensure();
      var qx = num(), qy = num(), ex = num(), ey = num();
      var lq = last();
      lq.ox = lq.x + (2 / 3) * (qx - lq.x); lq.oy = lq.y + (2 / 3) * (qy - lq.y);
      push(ex, ey, ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey));
    } else {
      i++; // token inesperado: pula
    }
  }

  var out = [];
  for (var s = 0; s < subs.length; s++) {
    var sp = subs[s];
    var pts = sp.pts;
    // Subpath fechado que termina em cima do primeiro ponto: funde os dois
    // (senão o AE ganha um vértice duplicado no fechamento).
    if (sp.closed && pts.length > 1) {
      var f = pts[0], l = pts[pts.length - 1];
      if (Math.abs(f.x - l.x) < 0.001 && Math.abs(f.y - l.y) < 0.001) {
        f.ix = l.ix; f.iy = l.iy;
        pts.pop();
      }
    }
    if (pts.length < 2 && !sp.closed) { continue; }
    var v = [], ins = [], outs = [];
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k];
      v.push([r3(p.x), r3(p.y)]);
      ins.push([r3(p.ix - p.x), r3(p.iy - p.y)]);
      outs.push([r3(p.ox - p.x), r3(p.oy - p.y)]);
    }
    out.push({ closed: sp.closed, v: v, i: ins, o: outs });
  }
  return out;
}

function geometryPaths(list) {
  var paths = [];
  var winding = "NONZERO";
  if (!list || list === figma.mixed) { return { paths: paths, winding: winding }; }
  for (var i = 0; i < list.length; i++) {
    if (list[i].windingRule === "EVENODD") { winding = "EVENODD"; }
    paths = paths.concat(parsePath(list[i].data));
  }
  return { paths: paths, winding: winding };
}

// ---------------------------------------------------------------
// Exportação PNG
// ---------------------------------------------------------------
function pngSize(bytes) {
  // IHDR: largura/altura big-endian nos bytes 16..23
  var w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  var h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { w: w >>> 0, h: h >>> 0 };
}

function addAsset(ctx, bytes, name) {
  ctx.assetCounter += 1;
  var id = "a" + ctx.assetCounter;
  ctx.assets.push({ id: id, name: String(name || "image"), bytes: bytes });
  return id;
}

// Acha o retângulo absoluto que o PNG exportado cobre, casando o tamanho
// em pixels com os bounds conhecidos do nó (render bounds incluem sombra/
// stroke; bounding box não). Sem casamento: centraliza no render bounds.
function exportRegion(node, dims, scale, originX, originY) {
  var wPt = dims.w / scale, hPt = dims.h / scale;
  var tol = 2 / scale + 0.01;
  var cands = [node.absoluteRenderBounds, node.absoluteBoundingBox];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (c && Math.abs(c.width - wPt) <= tol && Math.abs(c.height - hPt) <= tol) {
      return { x: c.x - (originX || 0), y: c.y - (originY || 0), w: wPt, h: hPt };
    }
  }
  var ref = node.absoluteRenderBounds || node.absoluteBoundingBox || { x: 0, y: 0, width: wPt, height: hPt };
  return { x: ref.x + ref.width / 2 - wPt / 2 - (originX || 0), y: ref.y + ref.height / 2 - hPt / 2 - (originY || 0), w: wPt, h: hPt };
}

// "Assa" o nó inteiro (com filhos, efeitos, opacidade) num PNG alinhado
// aos eixos, posicionado em coordenadas do container C.
async function bake(node, C, ctx, reason) {
  var bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: ctx.scale } });
  var dims = pngSize(bytes);
  var region = exportRegion(node, dims, ctx.scale, 0, 0);
  if (reason) { ctx.notes[reason] = (ctx.notes[reason] || 0) + 1; }
  return {
    type: "image",
    asset: addAsset(ctx, bytes, node.name),
    xf: decompose(mul(C, translate(region.x, region.y))),
    w: r4(region.w),
    h: r4(region.h),
    scale: ctx.scale,
    baked: true
  };
}

// ---------------------------------------------------------------
// Formas
// ---------------------------------------------------------------
function samePathData(a, b) {
  if (!a || !b || a === figma.mixed || b === figma.mixed || a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) {
    if (String(a[i].data).replace(/\s+/g, " ").trim() !== String(b[i].data).replace(/\s+/g, " ").trim()) { return false; }
  }
  return true;
}

function strokeWeightOf(node) {
  if (typeof node.strokeWeight === "number") { return node.strokeWeight; }
  var sides = [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight];
  var m = 0;
  for (var i = 0; i < sides.length; i++) { if (typeof sides[i] === "number" && sides[i] > m) { m = sides[i]; } }
  return m;
}

function hasMixedSideStrokes(node) {
  if (typeof node.strokeWeight === "number") { return false; }
  return typeof node.strokeTopWeight === "number"; // frame/retângulo com espessura por lado
}

function radiiOf(node) {
  if (!("cornerRadius" in node)) { return 0; }
  if (node.cornerRadius !== figma.mixed) { return node.cornerRadius || 0; }
  return [node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0];
}

function isRectLike(node) {
  return node.type === "RECTANGLE" || node.type === "FRAME" || node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET" || node.type === "INSTANCE" || node.type === "SECTION";
}

function fullEllipse(node) {
  var a = node.arcData;
  if (!a) { return true; }
  return (a.innerRadius || 0) === 0 && Math.abs((a.endingAngle - a.startingAngle) - Math.PI * 2) < 0.001;
}

var STROKE_CAPS = { NONE: "butt", ROUND: "round", SQUARE: "square" };
var STROKE_JOINS = { MITER: "miter", BEVEL: "bevel", ROUND: "round" };

function nodeNeedsRaster(node) {
  var all = visiblePaints(node.fills).concat(visiblePaints(node.strokes));
  for (var i = 0; i < all.length; i++) { if (!isSolid(all[i])) { return true; } }
  return false;
}

// Monta as "partes" (cada uma vira um grupo de vetores no AE), de baixo
// pra cima. M é a matriz do espaço local do nó -> container.
function shapeDesc(node, M, ctx) {
  var fills = visiblePaints(node.fills).map(solidColor);
  var strokes = visiblePaints(node.strokes).map(solidColor);
  var sw = strokeWeightOf(node);
  var align = node.strokeAlign || "CENTER";
  var w = node.width, h = node.height;
  var parts = [];

  var simple = null; // geometria nativa (rect/ellipse) quando possível
  if (isRectLike(node)) {
    var radii = radiiOf(node);
    if (typeof radii === "number") { simple = { kind: "rect", x: 0, y: 0, w: r4(w), h: r4(h), r: r4(radii) }; }
  } else if (node.type === "ELLIPSE" && fullEllipse(node)) {
    simple = { kind: "ellipse", x: 0, y: 0, w: r4(w), h: r4(h) };
  }

  var fillGeom = simple;
  if (!fillGeom) {
    var g = geometryPaths(node.fillGeometry);
    fillGeom = { kind: "path", paths: g.paths, winding: g.winding };
  }

  var stroke = null;
  if (strokes.length && sw > 0) {
    var cap = node.strokeCap;
    var arrowCap = cap === figma.mixed || (cap && !STROKE_CAPS[cap]);
    var join = node.strokeJoin;
    stroke = {
      colors: strokes,
      weight: r4(sw),
      cap: STROKE_CAPS[cap] || "butt",
      join: STROKE_JOINS[join] || "miter",
      miter: r4(node.strokeMiterLimit || 4),
      dash: (node.dashPattern && node.dashPattern.length) ? node.dashPattern.map(r4) : null
    };

    if (simple && !hasMixedSideStrokes(node)) {
      if (align === "CENTER") {
        parts.push({ name: node.name, geom: simple, fills: fills, stroke: stroke });
      } else {
        // Stroke interno/externo em rect/elipse: continua editável, só
        // desloca a linha central do stroke meio traço pra dentro/fora.
        var off = align === "INSIDE" ? -sw / 2 : sw / 2;
        var sg = { kind: simple.kind, x: r4(-off), y: r4(-off), w: r4(w + off * 2), h: r4(h + off * 2) };
        if (simple.kind === "rect") { sg.r = r4(Math.max(0, simple.r + off)); }
        if (fills.length) { parts.push({ name: "Fill", geom: simple, fills: fills, stroke: null }); }
        parts.push({ name: "Stroke", geom: sg, fills: [], stroke: stroke });
      }
    } else if (align === "CENTER" && !arrowCap && !hasMixedSideStrokes(node)) {
      var strokeGeom = fillGeom;
      if (node.type === "VECTOR" && node.vectorPaths && !samePathData(node.vectorPaths, node.fillGeometry)) {
        var vp = geometryPaths(node.vectorPaths);
        strokeGeom = { kind: "path", paths: vp.paths, winding: vp.winding };
      } else if (node.type === "LINE") {
        strokeGeom = { kind: "path", paths: [{ closed: false, v: [[0, 0], [r4(w), 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] }], winding: "NONZERO" };
      }
      if (strokeGeom === fillGeom) {
        parts.push({ name: node.name, geom: fillGeom, fills: fills, stroke: stroke });
      } else {
        if (fills.length && fillGeom.paths && fillGeom.paths.length) { parts.push({ name: "Fill", geom: fillGeom, fills: fills, stroke: null }); }
        parts.push({ name: "Stroke", geom: strokeGeom, fills: [], stroke: stroke });
      }
    } else {
      // Stroke que o AE não reproduz com fidelidade (interno/externo em
      // path, setas, espessura por lado): vira o contorno exato do Figma,
      // preenchido com a cor do stroke.
      var og = geometryPaths(node.strokeGeometry);
      if (fills.length) { parts.push({ name: "Fill", geom: fillGeom, fills: fills, stroke: null }); }
      parts.push({ name: "Stroke", geom: { kind: "path", paths: og.paths, winding: "NONZERO" }, fills: strokes, stroke: null });
    }
  } else if (fills.length) {
    parts.push({ name: node.name, geom: fillGeom, fills: fills, stroke: null });
  }

  return { type: "shape", xf: decompose(M), parts: parts, effects: effectsOf(node, ctx) };
}

function effectsOf(node, ctx) {
  var list = node.effects;
  if (!list || list === figma.mixed) { return []; }
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.visible === false) { continue; }
    if (e.type === "DROP_SHADOW") {
      out.push({ type: "shadow", color: [r4(e.color.r), r4(e.color.g), r4(e.color.b), r4(e.color.a)], dx: r4(e.offset.x), dy: r4(e.offset.y), radius: r4(e.radius), spread: r4(e.spread || 0) });
    } else if (e.type === "LAYER_BLUR") {
      out.push({ type: "blur", radius: r4(e.radius) });
    } else {
      ctx.notes["Efeito " + e.type + " ignorado (use Rasterizar para manter)"] = (ctx.notes["Efeito " + e.type + " ignorado (use Rasterizar para manter)"] || 0) + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Texto
// ---------------------------------------------------------------
function applyCase(str, textCase) {
  if (textCase === "LOWER") { return str.toLowerCase(); }
  if (textCase === "TITLE") { return str.replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  return str;
}

function textDesc(node, M, ctx) {
  var segs = node.getStyledTextSegments(["fontName", "fontSize", "fills", "letterSpacing", "lineHeight", "textCase", "textDecoration"]);
  var chars = "";
  var segments = [];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    var piece = applyCase(s.characters, s.textCase);
    var paints = visiblePaints(s.fills);
    var color = null;
    if (paints.length) {
      var top = paints[paints.length - 1];
      if (!isSolid(top)) { ctx.notes["Texto com gradiente/imagem vira cor sólida"] = (ctx.notes["Texto com gradiente/imagem vira cor sólida"] || 0) + 1; }
      color = approxColor(top);
    }
    var tracking = 0;
    if (s.letterSpacing) {
      tracking = s.letterSpacing.unit === "PERCENT" ? s.letterSpacing.value * 10 : (s.letterSpacing.value / (s.fontSize || 1)) * 1000;
    }
    var leading = null;
    if (s.lineHeight && s.lineHeight.unit === "PIXELS") { leading = s.lineHeight.value; }
    else if (s.lineHeight && s.lineHeight.unit === "PERCENT") { leading = s.fontSize * s.lineHeight.value / 100; }
    segments.push({
      start: s.start,
      end: s.end,
      family: s.fontName.family,
      style: s.fontName.style,
      size: r4(s.fontSize),
      color: color,
      tracking: r4(tracking),
      leading: leading === null ? null : r4(leading),
      caps: s.textCase === "UPPER" ? "all" : (s.textCase === "SMALL_CAPS" || s.textCase === "SMALL_CAPS_FORCED" ? "small" : null)
    });
    chars += piece;
    ctx.fonts[s.fontName.family + " " + s.fontName.style] = 1;
  }

  var strokes = visiblePaints(node.strokes);
  var stroke = null;
  if (strokes.length && strokeWeightOf(node) > 0) {
    stroke = { color: approxColor(strokes[strokes.length - 1]), weight: r4(strokeWeightOf(node)), align: node.strokeAlign || "CENTER" };
  }

  // Deslocamento do topo dos glifos em relação ao topo da caixa de texto,
  // medido no próprio Figma. O AE posiciona a 1a linha com métrica
  // própria; o lado do AE mede o mesmo valor e corrige a diferença.
  var glyph = null;
  var xf = decompose(M);
  var rb = node.absoluteRenderBounds;
  var abs = node.absoluteTransform;
  if (rb && Math.abs(abs[0][1]) < 1e-6 && Math.abs(abs[1][0]) < 1e-6 && abs[0][0] > 0 && abs[1][1] > 0) {
    glyph = { x: r4(rb.x - abs[0][2]), y: r4(rb.y - abs[1][2]), w: r4(rb.width), h: r4(rb.height) };
  }

  return {
    type: "text",
    xf: xf,
    w: r4(node.width),
    h: r4(node.height),
    text: {
      chars: chars,
      autoResize: node.textAutoResize,
      alignH: node.textAlignHorizontal,
      alignV: node.textAlignVertical,
      paragraphSpacing: typeof node.paragraphSpacing === "number" ? node.paragraphSpacing : 0,
      segments: segments,
      stroke: stroke,
      glyph: glyph
    },
    effects: effectsOf(node, ctx)
  };
}

// ---------------------------------------------------------------
// Árvore
// ---------------------------------------------------------------
function isFrameLike(node) {
  return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET" ||
    node.type === "INSTANCE" || node.type === "SECTION";
}

var SHAPE_TYPES = { RECTANGLE: 1, ELLIPSE: 1, VECTOR: 1, STAR: 1, POLYGON: 1, LINE: 1, BOOLEAN_OPERATION: 1 };

// Fundo (fills/strokes) de um frame como camada própria. M: local -> container.
async function frameBackground(node, M, ctx) {
  var paints = visiblePaints(node.fills).concat(visiblePaints(node.strokes));
  if (!paints.length) { return null; }
  if (!nodeNeedsRaster(node)) {
    var d = shapeDesc(node, M, ctx);
    d.name = (node.name || "Frame") + " (fundo)";
    d.effects = [];
    return d.parts.length ? d : null;
  }
  // Fundo com imagem/gradiente: exporta um retângulo temporário com as
  // mesmas pinturas (exportar o frame traria os filhos junto).
  var tmp = figma.createRectangle();
  try {
    tmp.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
    tmp.fills = node.fills;
    try { tmp.strokes = node.strokes; tmp.strokeAlign = node.strokeAlign; tmp.strokeWeight = strokeWeightOf(node); } catch (e) {}
    var radii = radiiOf(node);
    if (typeof radii === "number") { tmp.cornerRadius = radii; }
    else { tmp.topLeftRadius = radii[0]; tmp.topRightRadius = radii[1]; tmp.bottomRightRadius = radii[2]; tmp.bottomLeftRadius = radii[3]; }
    var bytes = await tmp.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: ctx.scale } });
    var dims = pngSize(bytes);
    var region = exportRegion(tmp, dims, ctx.scale, tmp.absoluteTransform[0][2], tmp.absoluteTransform[1][2]);
    ctx.notes["Fundo com imagem/gradiente vira PNG"] = (ctx.notes["Fundo com imagem/gradiente vira PNG"] || 0) + 1;
    return {
      type: "image",
      name: (node.name || "Frame") + " (fundo)",
      asset: addAsset(ctx, bytes, (node.name || "Frame") + " fundo"),
      xf: decompose(mul(M, translate(region.x, region.y))),
      w: r4(region.w),
      h: r4(region.h),
      scale: ctx.scale,
      opacity: 1
    };
  } finally {
    tmp.remove();
  }
}

async function convertChildren(node, C, ctx) {
  var out = [];
  var kids = node.children || [];
  for (var i = 0; i < kids.length; i++) {
    var d = await convertNode(kids[i], C, ctx);
    if (d) { out.push(d); }
  }
  return out;
}

async function convertNode(node, C, ctx) {
  if (node.visible === false || node.type === "SLICE") { return null; }
  ctx.count += 1;
  var M = mul(C, node.absoluteTransform);
  var base = {
    id: node.id,
    name: node.name,
    opacity: typeof node.opacity === "number" ? r4(node.opacity) : 1,
    blend: blendOf(node)
  };
  var isMask = ("isMask" in node) && node.isMask;
  if (isMask) { base.mask = node.maskType || "ALPHA"; }

  var d = null;
  try {
    if (isMask && !SHAPE_TYPES[node.type]) {
      d = await bake(node, C, ctx, null); // máscara composta: PNG serve como matte
    } else if (node.type === "TEXT") {
      d = textDesc(node, M, ctx);
    } else if (node.type === "GROUP") {
      d = { type: "group", xf: decompose(M), children: await convertChildren(node, C, ctx) };
    } else if (isFrameLike(node)) {
      if (node.clipsContent !== false) {
        var Ci = inv(node.absoluteTransform);
        var kids = [];
        var bg = await frameBackground(node, IDENTITY, ctx);
        if (bg) { kids.push(bg); }
        kids = kids.concat(await convertChildren(node, Ci, ctx));
        var radii = radiiOf(node);
        d = { type: "precomp", xf: decompose(M), w: r4(node.width), h: r4(node.height), clipRadius: radii, children: kids, effects: effectsOf(node, ctx) };
      } else {
        var kids2 = [];
        var bg2 = await frameBackground(node, M, ctx);
        if (bg2) { bg2.effects = effectsOf(node, ctx); kids2.push(bg2); }
        kids2 = kids2.concat(await convertChildren(node, C, ctx));
        d = { type: "group", xf: decompose(M), children: kids2 };
      }
    } else if (SHAPE_TYPES[node.type]) {
      if (nodeNeedsRaster(node)) {
        d = await bake(node, C, ctx, "Forma com imagem/gradiente vira PNG");
      } else {
        d = shapeDesc(node, M, ctx);
        if (!d.parts.length) { return null; }
      }
    } else {
      d = await bake(node, C, ctx, "Tipo " + node.type + " vira PNG");
    }
  } catch (err) {
    ctx.notes["Falha em \"" + node.name + "\": " + (err && err.message ? err.message : err)] = 1;
    try { d = await bake(node, C, ctx, null); } catch (bakeErr) { return null; }
  }
  if (d && d.baked) { base.opacity = 1; } // o PNG exportado já carrega a opacidade
  var result = Object.assign(base, d);
  if (d && d.name) { result.name = d.name; }
  return result;
}

// ---------------------------------------------------------------
// Seleção -> payload
// ---------------------------------------------------------------
function treePath(node) {
  var path = [];
  var n = node;
  while (n && n.parent) {
    path.unshift(n.parent.children.indexOf(n));
    n = n.parent;
  }
  return path;
}

function compareTree(a, b) {
  var pa = treePath(a), pb = treePath(b);
  for (var i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) { return pa[i] - pb[i]; }
  }
  return pa.length - pb.length;
}

// Frame de nível mais alto (filho direto da página ou de uma section).
function topFrameOf(node) {
  var top = null;
  var n = node.parent;
  while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") {
    if (isFrameLike(n) && n.type !== "SECTION") { top = n; }
    n = n.parent;
  }
  return top;
}

function boundsOf(node) {
  return node.absoluteRenderBounds || node.absoluteBoundingBox;
}

function unionBounds(nodes) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var b = boundsOf(nodes[i]);
    if (!b) { continue; }
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (x0 === Infinity) { return { x: 0, y: 0, w: 1, h: 1 }; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Onde um frame importado como comp fica: transform (origem = canto
// superior esquerdo, como as outras camadas) e caixa no espaço do frame de
// topo em que ele está -- ou da página, se ele mesmo é de topo. Assim o AE
// põe cada comp no mesmo lugar do Figma, mesmo importando um frame por vez
// (antes todas entravam centralizadas, uma em cima da outra).
function framePlacement(node) {
  var top = topFrameOf(node);
  var C = top ? inv(top.absoluteTransform) : IDENTITY;
  var M = mul(C, node.absoluteTransform);
  var corners = [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]];
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var i = 0; i < corners.length; i++) {
    var px = M[0][0] * corners[i][0] + M[0][1] * corners[i][1] + M[0][2];
    var py = M[1][0] * corners[i][0] + M[1][1] * corners[i][1] + M[1][2];
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return {
    key: top ? String(top.id || ("frame:" + top.name)) : "__page__",
    container: top ? { name: top.name, w: r4(top.width), h: r4(top.height) } : null,
    xf: decompose(M),
    bounds: { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) }
  };
}

async function extract(mode, options) {
  options = options || {};
  var scale = [1, 2, 3, 4].indexOf(Number(options.scale)) >= 0 ? Number(options.scale) : 2;
  var selection = figma.currentPage.selection.filter(function (n) { return n.visible !== false; });
  if (!selection.length) {
    throw new Error("Selecione pelo menos um frame ou camada no Figma.");
  }
  selection.sort(compareTree);

  // "comp": só nome + tamanho de cada item selecionado (normalmente um
  // frame) -- o AE cria composições vazias do mesmo tamanho em pixels.
  if (mode === "comp") {
    return {
      payload: {
        version: 1,
        mode: "comp",
        fileName: figma.root.name,
        pageName: figma.currentPage.name,
        groups: selection.map(function (n) {
          return { kind: "empty", name: n.name, w: Math.max(1, Math.round(n.width)), h: Math.max(1, Math.round(n.height)) };
        }),
        notes: []
      },
      assets: []
    };
  }

  var ctx = { assets: [], assetCounter: 0, scale: scale, notes: {}, fonts: {}, count: 0 };
  var groups = [];

  // Itens que vão pra comp ativa ("place"), agrupados pelo frame de topo
  // em que estão, pra manter a posição relativa entre eles.
  var placeByContainer = {};
  var placeOrder = [];

  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    if (mode === "layers" && isFrameLike(node)) {
      var Ci = inv(node.absoluteTransform);
      var layers = [];
      var bg = await frameBackground(node, IDENTITY, ctx);
      if (bg) { layers.push(bg); }
      layers = layers.concat(await convertChildren(node, Ci, ctx));
      groups.push({
        kind: "comp", name: node.name, w: r4(node.width), h: r4(node.height), layers: layers,
        place: framePlacement(node),
        // Cantos arredondados de um frame que recorta: no AE viram uma Mask
        // na camada da comp (a silhueta do Figma).
        clipRadius: node.clipsContent !== false ? radiiOf(node) : 0
      });
      continue;
    }
    var container = (mode === "raster" && isFrameLike(node) && !topFrameOf(node)) ? node : topFrameOf(node);
    var key = container ? container.id : "__page__";
    if (!placeByContainer[key]) {
      placeByContainer[key] = { container: container, nodes: [] };
      placeOrder.push(key);
    }
    placeByContainer[key].nodes.push(node);
  }

  for (var k = 0; k < placeOrder.length; k++) {
    var entry = placeByContainer[placeOrder[k]];
    var cont = entry.container;
    var ub = unionBounds(entry.nodes);
    var C, originX, originY;
    if (cont) {
      C = inv(cont.absoluteTransform);
      originX = cont.absoluteTransform[0][2];
      originY = cont.absoluteTransform[1][2];
    } else {
      C = translate(-ub.x, -ub.y);
      originX = ub.x;
      originY = ub.y;
    }
    var placed = [];
    for (var n = 0; n < entry.nodes.length; n++) {
      var d = mode === "raster" ? await bake(entry.nodes[n], C, ctx, null) : await convertNode(entry.nodes[n], C, ctx);
      if (d) {
        if (mode === "raster") { d.id = entry.nodes[n].id; d.name = entry.nodes[n].name; d.opacity = 1; d.blend = blendOf(entry.nodes[n]); }
        placed.push(d);
      }
    }
    groups.push({
      kind: "place",
      container: cont ? { name: cont.name, w: r4(cont.width), h: r4(cont.height), isFrame: true } : { name: entry.nodes[0].name, w: r4(ub.w), h: r4(ub.h), isFrame: false },
      bounds: { x: r4(ub.x - originX), y: r4(ub.y - originY), w: r4(ub.w), h: r4(ub.h) },
      layers: placed
    });
  }

  var notes = [];
  for (var key2 in ctx.notes) { notes.push(ctx.notes[key2] > 1 ? key2 + " (" + ctx.notes[key2] + "x)" : key2); }

  return {
    payload: {
      version: 1,
      mode: mode,
      fileName: figma.root.name,
      pageName: figma.currentPage.name,
      scale: scale,
      nodeCount: ctx.count,
      fonts: Object.keys(ctx.fonts),
      notes: notes,
      groups: groups
    },
    assets: ctx.assets
  };
}

// ---------------------------------------------------------------
// Mensagens com a UI
// ---------------------------------------------------------------
function postSelection() {
  var sel = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "selection",
    count: sel.length,
    names: sel.slice(0, 3).map(function (n) { return n.name; }),
    frames: sel.filter(isFrameLike).length
  });
}

figma.on("selectionchange", postSelection);
figma.on("currentpagechange", postSelection);

figma.ui.onmessage = async function (msg) {
  if (!msg || !msg.type) { return; }
  if (msg.type === "ready") {
    var saved = null;
    try { saved = await figma.clientStorage.getAsync("mfl-settings"); } catch (e) {}
    figma.ui.postMessage({ type: "settings", settings: saved || {} });
    postSelection();
  } else if (msg.type === "save-settings") {
    try { await figma.clientStorage.setAsync("mfl-settings", msg.settings || {}); } catch (e) {}
  } else if (msg.type === "extract") {
    try {
      var result = await extract(msg.mode, msg.options);
      figma.ui.postMessage({ type: "payload", requestId: msg.requestId, payload: result.payload, assets: result.assets });
    } catch (err) {
      figma.ui.postMessage({ type: "extract-error", requestId: msg.requestId, error: err && err.message ? err.message : String(err) });
    }
  } else if (msg.type === "notify") {
    figma.notify(String(msg.text || ""), { error: !!msg.error, timeout: 3500 });
  }
};
