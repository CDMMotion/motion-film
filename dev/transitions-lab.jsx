/*
 * Dev only (not shipped): sample scenes + frame dumps / preview renders
 * for the Kit › Transitions effects (motion-film/host/transitions.jsx).
 *
 *   $.evalFile(".../host/transitions.jsx"); $.evalFile(".../dev/transitions-lab.jsx");
 *   mftLabSample(w, h[, pathA, pathB])      -> builds "MF_TR_SAMPLE" (2 scenes, cut at 1.5 s;
 *                                              with paths, the scenes are those videos)
 *   mftLabFrames(id, dir, frames, outDir)   -> applies one effect, saves PNGs around the point
 *   mftLabRender(id, dir, frames, outPath)  -> applies one effect, renders an H.264 .mp4
 *   mftLabCleanup()                         -> removes everything the lab created
 *
 * The sample is ours: two gradient scenes with a word and a few shapes.
 */
(function () {
  var SAMPLE = "MF_TR_SAMPLE";
  var CUT = 1.5;

  function find(name) {
    for (var i = 1; i <= app.project.numItems; i += 1) { if (app.project.item(i).name === name) { return app.project.item(i); } }
    return null;
  }

  function scene(name, w, h, c1, c2, word, accent) {
    var old = find(name);
    if (old) { old.remove(); }
    var c = app.project.items.addComp(name, w, h, 1, 3, 30);
    var bg = c.layers.addShape();
    bg.name = "bg";
    var g = bg.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
    g.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([w, h]);
    g.addProperty("ADBE Vector Graphic - Fill");
    bg = c.layer(1);
    // the colors come from a Gradient Ramp over the whole layer
    var ramp = bg.property("ADBE Effect Parade").addProperty("ADBE Ramp");
    ramp = bg.property("ADBE Effect Parade").property(1);
    ramp.property(1).setValue([0, 0]);
    ramp.property(2).setValue(c1);
    ramp.property(3).setValue([w, h]);
    ramp.property(4).setValue(c2);
    ramp.property(5).setValue(2);
    // a few shapes for motion to read
    for (var i = 0; i < 6; i += 1) {
      var s = c.layers.addShape();
      var sg = s.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");
      sg.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([h * (0.08 + 0.05 * (i % 3)), h * (0.08 + 0.05 * (i % 3))]);
      sg.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(i % 2 ? [1, 1, 1] : accent);
      c.layer(1).property("ADBE Transform Group").property("ADBE Position").setValue([w * (0.12 + 0.15 * i), h * (i % 2 ? 0.2 : 0.82)]);
      c.layer(1).property("ADBE Transform Group").property("ADBE Opacity").setValue(70);
    }
    var t = c.layers.addText(word);
    var tp = t.property("ADBE Text Properties").property("ADBE Text Document");
    var td = tp.value;
    td.fontSize = h * 0.3;
    td.fillColor = [1, 1, 1];
    td.applyFill = true;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    try { td.font = "Arial-BoldMT"; } catch (e) {}
    tp.setValue(td);
    c.layer(1).property("ADBE Transform Group").property("ADBE Position").setValue([w / 2, h * 0.6]);
    return c;
  }

  // a scene from a video (dev/transitions-scenes): a comp as long as the
  // clip, the footage scaled to fill it
  function videoScene(name, w, h, path) {
    var old = find(name);
    if (old) { old.remove(); }
    var foot = app.project.importFile(new ImportOptions(new File(path)));
    foot.name = "MF_TR_FOOT_" + name;
    var c = app.project.items.addComp(name, w, h, 1, foot.duration, 30);
    var l = c.layers.add(foot);
    var s = Math.max(w / foot.width, h / foot.height) * 100;
    l.property("ADBE Transform Group").property("ADBE Scale").setValue([s, s]);
    return c;
  }

  // mftLabSample(w, h)             -> the gradient scenes
  // mftLabSample(w, h, pathA, pathB) -> video scenes: A ends at the cut, B starts there
  $.global.mftLabSample = function (w, h, pathA, pathB) {
    w = w || 640; h = h || 360;
    var old = find(SAMPLE);
    if (old) { old.remove(); }
    var video = !!(pathA && pathB);
    var A = video ? videoScene("MF_TR_SCENE_A", w, h, pathA) : scene("MF_TR_SCENE_A", w, h, [0.08, 0.2, 0.55], [0.1, 0.75, 0.85], "MÓTION", [1, 0.85, 0.2]);
    var B = video ? videoScene("MF_TR_SCENE_B", w, h, pathB) : scene("MF_TR_SCENE_B", w, h, [0.95, 0.45, 0.1], [0.75, 0.1, 0.45], "FILM", [0.2, 0.9, 1]);
    var c = app.project.items.addComp(SAMPLE, w, h, 1, 3, 30);
    var lb = c.layers.add(B);
    if (video) { lb.startTime = CUT; } else { lb.inPoint = CUT; }
    var la = c.layers.add(A);
    if (video) { la.startTime = CUT - A.duration; }
    la.outPoint = CUT;
    c.openInViewer();
    return "ok";
  };

  function sample() { return find(SAMPLE); }

  function clearEffects(c) {
    for (var i = c.numLayers; i >= 1; i -= 1) {
      if (String(c.layer(i).comment || "").indexOf("MFT|") === 0 || /^MF Transition/.test(c.layer(i).name)) { c.layer(i).remove(); }
    }
  }

  function selectScenes(c) {
    for (var i = 1; i <= c.numLayers; i += 1) { c.layer(i).selected = /^MF_TR_SCENE/.test(c.layer(i).name); }
  }

  function apply(id, dir, frames) {
    var c = sample();
    c.openInViewer();
    clearEffects(c);
    selectScenes(c);
    c.time = CUT;
    return $.global.mftApply({ id: id, name: id, frames: frames || 14, dir: dir || "right" });
  }

  // PNGs at 7 moments around the point
  $.global.mftLabFrames = function (id, dir, frames, outDir, slot) {
    var r = apply(id, dir, frames);
    var c = sample();
    var fd = c.frameDuration;
    var n = frames || 14;
    var times;
    if (slot === "in") { times = [CUT, CUT + fd * 2, CUT + n * fd * 0.25, CUT + n * fd * 0.5, CUT + n * fd * 0.75, CUT + n * fd - fd, CUT + n * fd + fd]; }
    else if (slot === "out") { times = [CUT - n * fd - fd, CUT - n * fd * 0.75, CUT - n * fd * 0.5, CUT - n * fd * 0.25, CUT - fd * 3, CUT - fd, CUT]; }
    else { times = [CUT - n * fd * 0.4, CUT - fd * 3, CUT - fd, CUT, CUT + fd * 2, CUT + n * fd * 0.4, CUT + n * fd * 0.5 + fd]; }
    for (var i = 0; i < times.length; i += 1) {
      c.saveFrameToPng(Math.round(times[i] / fd) * fd, new File(outDir + "/" + id + "_" + i + ".png"));
    }
    return r;
  };

  function h264(om) {
    var names = om.templates;
    for (var i = 0; i < names.length; i += 1) { if (/H\.264/i.test(names[i]) && /Match Render/i.test(names[i])) { return names[i]; } }
    for (i = 0; i < names.length; i += 1) { if (/H\.264/i.test(names[i])) { return names[i]; } }
    return null;
  }

  // an .mp4 of the effect (the span around the point, plus a little)
  $.global.mftLabRender = function (id, dir, frames, outPath, slot) {
    var r = apply(id, dir, frames);
    var c = sample();
    var fd = c.frameDuration;
    var n = frames || 14;
    var start = slot === "in" ? CUT - 8 * fd : (slot === "out" ? CUT - n * fd - 8 * fd : CUT - Math.round(n / 2) * fd - 8 * fd);
    var dur = n * fd + 16 * fd;
    var q = app.project.renderQueue;
    var parked = [];
    for (var i = 1; i <= q.numItems; i += 1) { try { if (q.item(i).render) { q.item(i).render = false; parked.push(q.item(i)); } } catch (e) {} }
    var item = q.items.add(c);
    item.timeSpanStart = Math.max(0, start);
    item.timeSpanDuration = dur;
    var om = item.outputModule(1);
    var t = h264(om);
    if (!t) { item.remove(); return "no h264"; }
    om.applyTemplate(t);
    try { om.postRenderAction = PostRenderAction.NONE; } catch (e2) {}
    om.file = new File(outPath);
    try { q.render(); } catch (e3) { r = "render error " + e3; }
    try { item.remove(); } catch (e4) {}
    for (var k = 0; k < parked.length; k += 1) { try { parked[k].render = true; } catch (e5) {} }
    return r;
  };

  $.global.mftLabCleanup = function () {
    var names = [SAMPLE, "MF_TR_SCENE_A", "MF_TR_SCENE_B"];
    for (var i = 0; i < names.length; i += 1) { var it = find(names[i]); if (it) { it.remove(); } }
    for (var j = app.project.numItems; j >= 1; j -= 1) {
      var x = app.project.item(j);
      if (x instanceof FootageItem && x.usedIn.length === 0 && (/^Mótion Film — Transitions/.test(x.name) || /^MF_TR_FOOT_/.test(x.name))) { x.remove(); }
    }
    return "clean";
  };
}());
