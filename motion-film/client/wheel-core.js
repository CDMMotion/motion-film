/*
 * Mótion Film -- the Wheel: shared by the main panel (wheel-runner.js,
 * which shows it through the helper and runs what's picked) and the
 * "MF - Wheel" settings window (wheel.js).
 *
 * The settings are a file, not localStorage (each window has its own):
 *   Documents/Mótion Film Packs/wheel.json
 *   {
 *     v: 1, enabled, hotkey: { mods, vk, label },
 *     slices: [ 2..8 of
 *       { id, label, action }                       one action
 *       { id, label, group: true, children: [...] } opens 2..8 more on hover
 *     ]
 *   }
 * An action is one of
 *   { type: "elastic", kind: position|scale|rotation|selected }
 *   { type: "curve", n }                 favorite curve n (Home › 02)
 *   { type: "layer", kind: null|adjustment|solid }
 *   { type: "textanim" }                 Text Animation with its current settings
 *   { type: "textfav", n }               favorite text animation n (Text Animation › 02)
 *   { type: "transition", id }           Kit › Transitions effect
 *   { type: "command", id, name }        an After Effects menu command (id
 *                                        works in any AE language; name as fallback)
 *   { type: "effect", match, name }      add an effect to the selected layers
 *   { type: "script", path }             run a .jsx / .jsxbin
 *   { type: "preset", path }             apply an animation preset (.ffx)
 */
(function (root) {
  "use strict";

  var MIN = 2;
  var MAX = 8;

  var COMMANDS = [
    { id: 2071, name: "Pre-compose...", label: "Pre-compose" },
    { id: 2158, name: "Split Layer", label: "Split Layer" },
    { id: 2080, name: "Duplicate", label: "Duplicate" },
    { id: 2509, name: "Easy Ease", label: "Easy Ease" },
    { id: 2510, name: "Easy Ease In", label: "Easy Ease In" },
    { id: 2511, name: "Easy Ease Out", label: "Easy Ease Out" },
    { id: 2226, name: "Toggle Hold Keyframe", label: "Hold Keyframe" },
    { id: 3693, name: "Time-Reverse Keyframes", label: "Reverse Keys" },
    { id: 2227, name: "Keyframe Interpolation...", label: "Interpolation" },
    { id: 2228, name: "Keyframe Velocity...", label: "Velocity" },
    { id: 10312, name: "Center Anchor Point in Layer Content", label: "Center Anchor" },
    { id: 2156, name: "Fit to Comp", label: "Fit to Comp" },
    { id: 2732, name: "Fit to Comp Width", label: "Fit Width" },
    { id: 2733, name: "Fit to Comp Height", label: "Fit Height" },
    { id: 2360, name: "Trim Comp to Work Area", label: "Trim to Work Area" },
    { id: 4217, name: "Sequence Layers...", label: "Sequence Layers" },
    { id: 3799, name: "Convert to Editable Text", label: "Editable Text" },
    { id: 3781, name: "Create Shapes from Text", label: "Shapes from Text" },
    { id: 2933, name: "Create Masks from Text", label: "Masks from Text" },
    { id: 3973, name: "Create Shapes from Vector Layer", label: "Shapes from Vector" },
    { id: 2153, name: "Enable Time Remapping", label: "Time Remap" },
    { id: 3695, name: "Freeze Frame", label: "Freeze Frame" },
    { id: 2541, name: "3D Layer", label: "3D Layer" },
    { id: 2797, name: "Motion Blur", label: "Motion Blur" },
    { id: 2731, name: "Reveal Expression Errors", label: "Expression Errors" },
    { id: 3736, name: "Shape Layer", label: "New Shape" },
    { id: 7023, name: "Text", label: "New Text" },
    { id: 2564, name: "Camera...", label: "New Camera" },
    { id: 5070, name: "Align", label: "Align panel" },
    { id: 3011, name: "Character", label: "Character panel" },
    { id: 3718, name: "Effects & Presets", label: "Effects & Presets" }
  ];

  // The fixed choices of the settings window, by group. Effects, scripts,
  // presets and other menu commands are entered there.
  var CATALOG = [
    { group: "Elastic", items: [
      { label: "Position", action: { type: "elastic", kind: "position" } },
      { label: "Scale", action: { type: "elastic", kind: "scale" } },
      { label: "Rotation", action: { type: "elastic", kind: "rotation" } },
      { label: "Select", action: { type: "elastic", kind: "selected" } }
    ] },
    { group: "Favorite curves", items: [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return { label: "Curve " + n, action: { type: "curve", n: n } };
    }) },
    { group: "Layers", items: [
      { label: "Null", action: { type: "layer", kind: "null" } },
      { label: "Adjustment", action: { type: "layer", kind: "adjustment" } },
      { label: "Solid", action: { type: "layer", kind: "solid" } }
    ] },
    { group: "Text", items: [
      { label: "Text Anim", action: { type: "textanim" } }
    ] },
    { group: "Text favorites", items: [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return { label: "Text " + n, action: { type: "textfav", n: n } };
    }) },
    { group: "After Effects", items: COMMANDS.map(function (c) {
      return { label: c.label, action: { type: "command", id: c.id, name: c.name } };
    }) }
  ];

  var uidN = 0;
  function uid() { uidN += 1; return "w" + Date.now().toString(36) + uidN.toString(36); }

  function item(label, action) { return { id: uid(), label: label, action: action }; }

  function defaults() {
    return {
      v: 1,
      enabled: true,
      hotkey: { mods: 2, vk: 9, label: "Ctrl + Tab" },
      slices: [
        { id: uid(), label: "Elastic", group: true, children: [
          item("Position", { type: "elastic", kind: "position" }),
          item("Scale", { type: "elastic", kind: "scale" }),
          item("Rotation", { type: "elastic", kind: "rotation" }),
          item("Select", { type: "elastic", kind: "selected" })
        ] },
        { id: uid(), label: "Curves", group: true, children: [
          item("Curve 1", { type: "curve", n: 1 }),
          item("Curve 2", { type: "curve", n: 2 }),
          item("Curve 3", { type: "curve", n: 3 }),
          item("Curve 4", { type: "curve", n: 4 })
        ] },
        item("Null", { type: "layer", kind: "null" }),
        item("Adjustment", { type: "layer", kind: "adjustment" }),
        item("Pre-compose", { type: "command", id: 2071, name: "Pre-compose..." }),
        item("Text Anim", { type: "textanim" })
      ]
    };
  }

  // keeps a loaded file inside the rules (2..8 slices, groups with 2..8
  // plain actions, ids everywhere)
  function clean(cfg) {
    var d = defaults();
    if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.slices)) { return d; }
    var out = {
      v: 1,
      enabled: cfg.enabled !== false,
      hotkey: cfg.hotkey && cfg.hotkey.vk > 0 ? { mods: cfg.hotkey.mods | 0, vk: cfg.hotkey.vk | 0, label: String(cfg.hotkey.label || "") } : d.hotkey,
      slices: []
    };
    cfg.slices.slice(0, MAX).forEach(function (s) {
      if (!s || typeof s !== "object") { return; }
      var slice = { id: String(s.id || uid()), label: String(s.label || "").slice(0, 28) };
      if (s.group) {
        slice.group = true;
        slice.children = (Array.isArray(s.children) ? s.children : []).slice(0, MAX).filter(function (c) { return c && c.action; }).map(function (c) {
          return { id: String(c.id || uid()), label: String(c.label || "").slice(0, 28), action: c.action };
        });
      } else {
        slice.action = s.action || null;
      }
      out.slices.push(slice);
    });
    if (out.slices.length < MIN) { return d; }
    return out;
  }

  // ------------------------------------------------------------------ file

  function req(name) {
    var r = (window.cep_node && window.cep_node.require) || window.require || null;
    if (!r) { throw new Error("no node"); }
    return r(name);
  }
  function file() {
    var path = req("path");
    var docs = "";
    try { docs = decodeURIComponent(String(window.__adobe_cep__.getSystemPath("myDocuments")).replace(/^file:\/+/, "")); } catch (e) {}
    if (!docs) { docs = path.join(req("os").homedir(), "Documents"); }
    if (!/^[A-Za-z]:/.test(docs) && docs.charAt(0) !== "/") { docs = "/" + docs; }
    return path.join(path.normalize(docs), "Mótion Film Packs", "wheel.json");
  }
  function load() {
    try { return clean(JSON.parse(req("fs").readFileSync(file(), "utf8"))); } catch (e) { return defaults(); }
  }
  function save(cfg) {
    var fs = req("fs");
    var f = file();
    fs.mkdirSync(req("path").dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(clean(cfg), null, 1), "utf8");
  }
  function mtime() {
    try { return req("fs").statSync(file()).mtimeMs; } catch (e) { return 0; }
  }

  // a short description of an action, for the settings window
  function describe(a) {
    if (!a) { return "Nothing yet"; }
    switch (a.type) {
      case "elastic": return "Elastic " + (a.kind === "selected" ? "Select" : a.kind);
      case "curve": return "Favorite curve " + a.n;
      case "layer": return "New " + a.kind;
      case "textanim": return "Text Animation (current settings)";
      case "textfav": return "Favorite text animation " + a.n;
      case "transition": return "Transition " + a.id;
      case "command": return "AE command: " + (a.name || a.id);
      case "effect": return "Effect: " + (a.name || a.match);
      case "script": return "Script: " + String(a.path || "").split(/[\\/]/).pop();
      case "preset": return "Preset: " + String(a.path || "").split(/[\\/]/).pop();
    }
    return "?";
  }

  root.MFWheel = {
    MIN: MIN, MAX: MAX, COMMANDS: COMMANDS, CATALOG: CATALOG,
    defaults: defaults, clean: clean, load: load, save: save, mtime: mtime, file: file,
    uid: uid, describe: describe
  };
}(this));
