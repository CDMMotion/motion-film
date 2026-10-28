/*
 * Mótion Film -- the Wheel's After Effects actions (client/wheel-runner.js
 * runs the Mótion Film ones itself). Loaded on demand with $.evalFile.
 *
 *   mfWheelRun(action)  command | effect | script | preset (see wheel-core.js)
 *   mfWheelEffects()    every installed effect, for the settings window
 */
(function () {
  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  function selected() {
    var c = activeComp();
    return c ? c.selectedLayers : [];
  }

  $.global.mfWheelRun = function (a) {
    if (!a || !a.type) { return stringify({ ok: false, error: "Nothing set for this slice." }); }
    try {
      if (a.type === "command") {
        var id = a.id || 0;
        if (!id && a.name) { id = app.findMenuCommandId(a.name); }
        if (!id) { return stringify({ ok: false, error: "Menu command not found: " + (a.name || "?") }); }
        app.executeCommand(id);
        return stringify({ ok: true });
      }
      if (a.type === "effect") {
        if (!a.match) { return stringify({ ok: false, error: "No effect chosen for this slice yet (MF - Wheel)." }); }
        var layers = selected();
        if (!layers.length) { return stringify({ ok: false, error: "Select the layers for the effect." }); }
        app.beginUndoGroup("Mótion Film: " + (a.name || a.match));
        var n = 0;
        try {
          for (var i = 0; i < layers.length; i += 1) {
            var fx = layers[i].property("ADBE Effect Parade");
            if (fx && fx.canAddProperty(a.match)) { fx.addProperty(a.match); n += 1; }
          }
        } finally { app.endUndoGroup(); }
        if (!n) { return stringify({ ok: false, error: "This effect can't go on the selected layers." }); }
        return stringify({ ok: true });
      }
      if (a.type === "script") {
        var f = new File(a.path);
        if (!f.exists) { return stringify({ ok: false, error: "Script not found: " + a.path }); }
        $.evalFile(f);
        return stringify({ ok: true });
      }
      if (a.type === "preset") {
        var p = new File(a.path);
        if (!p.exists) { return stringify({ ok: false, error: "Preset not found: " + a.path }); }
        var sel = selected();
        if (!sel.length) { return stringify({ ok: false, error: "Select the layers for the preset." }); }
        app.beginUndoGroup("Mótion Film: preset");
        try { sel[0].applyPreset(p); } finally { app.endUndoGroup(); } // AE applies it to every selected layer
        return stringify({ ok: true });
      }
    } catch (e) {
      return stringify({ ok: false, error: String(e.message || e) });
    }
    return stringify({ ok: false, error: "Unknown action." });
  };

  $.global.mfWheelEffects = function () {
    var out = [];
    for (var i = 0; i < app.effects.length; i += 1) {
      var e = app.effects[i];
      if (!e.category || /^_/.test(e.category)) { continue; } // obsolete ones
      out.push({ match: e.matchName, name: e.displayName, cat: e.category });
    }
    return stringify({ ok: true, effects: out });
  };
}());
