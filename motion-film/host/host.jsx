/*
 * Mótion Film host bridge
 * Independent implementation using the public After Effects scripting API.
 * This file intentionally does not import or execute code from third-party
 * extensions.
 */

(function () {
  function stringify(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '{"ok":false,"error":"Could not serialize host response."}';
    }
  }

  function parse(value) {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (jsonError) {
      try {
        return eval("(" + value + ")");
      } catch (evalError) {
        return {};
      }
    }
  }

  function activeComp() {
    var item = app.project ? app.project.activeItem : null;
    if (!item || !(item instanceof CompItem)) {
      return null;
    }
    return item;
  }

  function selectedLayers() {
    var comp = activeComp();
    return comp ? comp.selectedLayers : [];
  }

  // Generic guard used anywhere a captured/parsed JSON value needs a
  // numeric fallback (timestamps, offsets, durations) -- typeof, not
  // isNaN, since a genuine 0 must survive (isNaN(0) is false but so is
  // isNaN(undefined + 1), the usual footgun this avoids).
  function numberOr(value, fallback) {
    return typeof value === "number" ? value : fallback;
  }

  function allLayersInComp() {
    var comp = activeComp();
    var layers = [];
    if (!comp) {
      return layers;
    }
    for (var i = 1; i <= comp.numLayers; i += 1) {
      layers.push(comp.layer(i));
    }
    return layers;
  }
  function cloneValue(value) {
    if (value instanceof Array) {
      var result = [];
      for (var i = 0; i < value.length; i += 1) {
        result.push(Number(value[i]) || 0);
      }
      return result;
    }
    return Number(value) || 0;
  }

  // A path property's value (shape-layer path, mask path) is a Shape
  // object, which does not survive a JSON round trip. kitShapeSafe
  // flattens it to a plain marker object on capture; reviveShapeValue
  // rebuilds a real Shape on apply. Both are no-ops for every other
  // value type, so they are safe to call from the shared capture/apply
  // helpers (captureStyleNode / applyStyleLeaf) -- the Style Presets
  // path is text-only and never produces a Shape.
  function kitShapeSafe(value) {
    try {
      if (value && !value.__shape && value.vertices && value.vertices.length !== undefined) {
        return {
          __shape: 1,
          closed: !!value.closed,
          vertices: value.vertices,
          inTangents: value.inTangents,
          outTangents: value.outTangents
        };
      }
    } catch (shapeCheckError) {
      // Not a Shape -- fall through.
    }
    return value;
  }

  function reviveShapeValue(value) {
    if (value && value.__shape) {
      var shape = new Shape();
      try {
        shape.closed = !!value.closed;
        shape.vertices = value.vertices || [];
        shape.inTangents = value.inTangents || [];
        shape.outTangents = value.outTangents || [];
      } catch (buildError) {
        // Non-fatal -- caller just gets a default Shape.
      }
      return shape;
    }
    return value;
  }

  function propertyDimensionCount(property, keyIndex) {
    if (property && keyIndex) {
      try {
        var incoming = property.keyInTemporalEase(keyIndex);
        if (incoming && incoming.length > 0) {
          return incoming.length;
        }
      } catch (incomingError) {
        // Fall through to the property value.
      }
      try {
        var outgoing = property.keyOutTemporalEase(keyIndex);
        if (outgoing && outgoing.length > 0) {
          return outgoing.length;
        }
      } catch (outgoingError) {
        // Fall through to the property value.
      }
    }
    try {
      if (property.value instanceof Array && property.value.length > 0) {
        return property.value.length;
      }
    } catch (error) {
      return 1;
    }
    return 1;
  }

  function isNumericValue(value) {
    if (typeof value === "number") {
      return true;
    }
    if (!(value instanceof Array) || value.length < 1) {
      return false;
    }
    for (var i = 0; i < value.length; i += 1) {
      if (typeof value[i] !== "number") {
        return false;
      }
    }
    return true;
  }

  function isNumericProperty(property) {
    try {
      return isNumericValue(property.value);
    } catch (error) {
      return false;
    }
  }


  var TRANSFORM_MATCH_NAMES = {
    anchor: "ADBE Anchor Point",
    position: "ADBE Position",
    scale: "ADBE Scale",
    rotation: "ADBE Rotate Z",
    opacity: "ADBE Opacity"
  };

  var TRANSFORM_ORDER = ["anchor", "position", "scale", "rotation", "opacity"];

  function transformGroupOf(layer) {
    try {
      return layer.property("ADBE Transform Group");
    } catch (error) {
      return null;
    }
  }

  function transformProp(layer, name) {
    var group = transformGroupOf(layer);
    if (!group) {
      return null;
    }
    var matchName = TRANSFORM_MATCH_NAMES[name];
    if (!matchName) {
      return null;
    }
    try {
      return group.property(matchName) || null;
    } catch (error) {
      return null;
    }
  }

  function readLayerTransform() {
    var comp = activeComp();
    var layers = selectedLayers();
    if (!comp) {
      return stringify({ ok: true, comp: null, count: 0, layer: null });
    }
    if (!layers.length) {
      return stringify({ ok: true, comp: comp.name, count: 0, layer: null });
    }

    var layer = layers[0];
    var props = {};
    for (var i = 0; i < TRANSFORM_ORDER.length; i += 1) {
      var name = TRANSFORM_ORDER[i];
      var property = transformProp(layer, name);
      if (!property) {
        continue;
      }
      try {
        var raw = cloneValue(property.value);
        var values = raw instanceof Array ? raw : [raw];
        props[name] = {
          values: values,
          animated: property.numKeys > 0,
          // "keyedNow" drives the filled stopwatch state: true when a
          // keyframe sits exactly at the current time, like AE's own
          // keyframe navigator diamond.
          keyedNow: property.numKeys > 0 && keyExistsAtTime(property, comp.time)
        };
      } catch (propError) {
        // Skip a property this layer type does not really expose.
      }
    }

    return stringify({
      ok: true,
      comp: comp.name,
      count: layers.length,
      layer: {
        // Deliberately NOT `name: layer.name` -- confirmed live this
        // was the actual persisting source of the "cursor jumps to
        // start while typing" bug, running independently of anything
        // in the commitTextField/refreshText fix (see HANDOFF.md):
        // this whole function is called every 700ms completely
        // unguarded ("safe to poll continuously" -- true for the real
        // Transform properties below, NOT for `.name`), and for an
        // unnamed text layer, `.name` mirrors the live Source Text --
        // reading it appears to carry the same cursor-interrupting
        // side effect as reading sourceText.value directly. Confirmed
        // via panel.js (layerSignature/updateTransformValues) that
        // nothing on the client ever actually used this field -- it
        // was read on every single tick for zero purpose.
        index: layer.index,
        threeD: !!layer.threeDLayer,
        // Lets the panel throttle this 700ms poll while a text layer is
        // selected (any evalScript touching a selected text layer during
        // an in-viewport edit can drop the caret to the layer start).
        // A plain instanceof, safe to read every tick.
        isText: (function () {
          try { return layer instanceof TextLayer; } catch (e) { return false; }
        })(),
        props: props
      }
    });
  }

  function keyExistsAtTime(property, time) {
    for (var i = 1; i <= property.numKeys; i += 1) {
      if (Math.abs(property.keyTime(i) - time) < 0.0001) {
        return true;
      }
    }
    return false;
  }

  function setTransformValue(name, rawValue, shouldKeyframe) {
    var comp = activeComp();
    var layers = selectedLayers();
    if (!comp || !layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }
    var parsed = parse(rawValue);
    var value = parsed instanceof Array && parsed.length === 1 ? parsed[0] : parsed;
    var changed = 0;

    app.beginUndoGroup("Mótion Film: " + name);
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var property = transformProp(layers[i], name);
        if (!property) {
          continue;
        }
        // Writing at the current time is required once a property is
        // animated -- setValue() throws on a keyframed property.
        if (shouldKeyframe || property.numKeys > 0) {
          property.setValueAtTime(comp.time, value);
        } else {
          property.setValue(value);
        }
        changed += 1;
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "That property is not available on the selected layer(s)." });
    }
    return stringify({ ok: true, changed: changed });
  }

  // Mirrors the native stopwatch: with no keyframes it starts animating
  // (one keyframe at the current time); with keyframes it stops animating
  // and discards them, keeping the value held at the current time.
  function toggleTransformStopwatch(name) {
    var comp = activeComp();
    var layers = selectedLayers();
    if (!comp || !layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }
    var changed = 0;
    var animating = false;

    app.beginUndoGroup("Mótion Film: Toggle " + name + " keyframes");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var property = transformProp(layers[i], name);
        if (!property) {
          continue;
        }
        if (property.numKeys > 0) {
          var held = cloneValue(property.valueAtTime(comp.time, false));
          for (var k = property.numKeys; k >= 1; k -= 1) {
            property.removeKey(k);
          }
          property.setValue(held);
        } else {
          property.setValueAtTime(comp.time, cloneValue(property.value));
          animating = true;
          try {
            // Selecting the property reveals its track in the Timeline,
            // so the new keyframe is visible without pressing U.
            property.selected = true;
          } catch (selectError) {
            // Not fatal.
          }
        }
        changed += 1;
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "That property is not available on the selected layer(s)." });
    }
    return stringify({ ok: true, animating: animating });
  }

  function resetLayerTransform() {
    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }
    var changed = 0;
    app.beginUndoGroup("Mótion Film: Reset Transform");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        for (var j = 0; j < TRANSFORM_ORDER.length; j += 1) {
          var property = transformProp(layers[i], TRANSFORM_ORDER[j]);
          if (!property) {
            continue;
          }
          try {
            for (var k = property.numKeys; k >= 1; k -= 1) {
              property.removeKey(k);
            }
            property.setValue(defaultTransformValue(layers[i], TRANSFORM_ORDER[j]));
            changed += 1;
          } catch (propError) {
            // Skip properties this layer refuses to reset.
          }
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "Nothing to reset on the selected layer(s)." });
    }
    return stringify({ ok: true, changed: changed });
  }

  function defaultTransformValue(layer, name) {
    var is3D = !!layer.threeDLayer;
    var comp = activeComp();
    if (name === "scale") {
      return is3D ? [100, 100, 100] : [100, 100];
    }
    if (name === "rotation") {
      return 0;
    }
    if (name === "opacity") {
      return 100;
    }
    if (name === "anchor") {
      // Footage-backed layers reset their anchor to the centre of their
      // own source; shape and text layers reset to their local origin.
      var source = null;
      try {
        source = layer.source || null;
      } catch (sourceError) {
        source = null;
      }
      if (source && source.width) {
        return is3D ? [source.width / 2, source.height / 2, 0] : [source.width / 2, source.height / 2];
      }
      return is3D ? [0, 0, 0] : [0, 0];
    }
    // position
    var cx = comp ? comp.width / 2 : 0;
    var cy = comp ? comp.height / 2 : 0;
    return is3D ? [cx, cy, 0] : [cx, cy];
  }

  // ---------------------------------------------------------------
  // Shape layers
  //
  // Groups are addressed by a numeric path: each element indexes into a
  // "contents" collection, starting at the layer's root Contents. So
  // [2] is the second item of Contents, and [2,1] is the first item
  // inside that group's own Contents. This lets the panel target any
  // group in a nested tree instead of assuming the first shape found.
  // ---------------------------------------------------------------

  function isShapeLayer(layer) {
    // `instanceof ShapeLayer` is not dependable across every evalScript
    // context, so identify the layer by its definitive matchName and fall
    // back to simply having a Contents group.
    try {
      if (layer.matchName === "ADBE Vector Layer") {
        return true;
      }
    } catch (matchError) {
      // Some layer types do not expose matchName; fall through.
    }
    try {
      return !!layer.property("ADBE Root Vectors Group");
    } catch (error) {
      return false;
    }
  }

  function rootContentsOf(layer) {
    try {
      return layer.property("ADBE Root Vectors Group");
    } catch (error) {
      return null;
    }
  }

  // The Home tab's Text and Shape property sections were removed (AE's
  // own Properties panel covers them). textPropertyOf survives because
  // Style Presets and the Colour Palette still branch on "is this a text
  // layer" and reach for its TextDocument.
  function textPropertyOf(layer) {
    try {
      var group = layer.property("ADBE Text Properties");
      if (!group) {
        return null;
      }
      return group.property("ADBE Text Document") || null;
    } catch (error) {
      return null;
    }
  }

  // Opens After Effects' own colour picker -- the only one with a
  // working eyedropper inside AE. There is no scripting API for it, so
  // the established workaround is used: attach a Color Control to a
  // temporary null, select its colour property, and invoke the
  // "Edit Value..." menu command (id 2240). The dialog that opens is the
  // real AE picker. The null is removed afterwards.
  //
  // Note: $.colorPicker() is deliberately not used -- on Windows it
  // opens the basic system dialog, which cannot sample screen colours.
  function pickColorNative(rawHex) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }

    var hex = String(parse(rawHex) || "#ffffff").replace("#", "");
    var startValue = [
      (parseInt(hex.substring(0, 2), 16) || 0) / 255,
      (parseInt(hex.substring(2, 4), 16) || 0) / 255,
      (parseInt(hex.substring(4, 6), 16) || 0) / 255
    ];

    var selectedIndices = [];
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).selected) {
        selectedIndices.push(i);
      }
    }

    var originalShy = comp.hideShyLayers;
    var tempNull = null;
    var result = null;

    try {
      tempNull = comp.layers.addNull();
      // Keep the helper null out of sight while the dialog is open.
      if (originalShy === false) {
        comp.hideShyLayers = true;
      }
      tempNull.shy = true;
      tempNull.enabled = false;

      var control = tempNull.property("ADBE Effect Parade").addProperty("ADBE Color Control");
      var colorProp = control.property("ADBE Color Control-0001");
      colorProp.setValue(startValue);
      colorProp.selected = true;

      // 2240 is the "Edit Value..." command. The numeric id is used so
      // this keeps working on non-English installs of After Effects.
      app.executeCommand(2240);

      result = colorProp.value;
    } catch (error) {
      if (tempNull) {
        try { tempNull.remove(); } catch (removeError) {}
      }
      comp.hideShyLayers = originalShy;
      return stringify({ ok: false, error: String(error) });
    }

    if (tempNull) {
      try { tempNull.remove(); } catch (removeError) {}
    }
    comp.hideShyLayers = originalShy;
    for (var s = 0; s < selectedIndices.length; s += 1) {
      try { comp.layer(selectedIndices[s]).selected = true; } catch (selectError) {}
    }

    if (!result) {
      return stringify({ ok: true, cancelled: true });
    }

    // Cancelling leaves the value untouched, so an unchanged colour is
    // treated as a cancel.
    var unchanged = Math.abs(result[0] - startValue[0]) < 0.0001 &&
      Math.abs(result[1] - startValue[1]) < 0.0001 &&
      Math.abs(result[2] - startValue[2]) < 0.0001;
    if (unchanged) {
      return stringify({ ok: true, cancelled: true });
    }

    // Note: this helper must not be named "byte" -- that is an ES3
    // reserved word and ExtendScript refuses to parse the whole file.
    function toHexPair(v) {
      var channel = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
      return channel.length === 1 ? "0" + channel : channel;
    }
    return stringify({ ok: true, hex: "#" + toHexPair(result[0]) + toHexPair(result[1]) + toHexPair(result[2]) });
  }

  // ---------------------------------------------------------------
  // Layer creators
  //
  // Three shape-layer stand-ins for the built-in layer types. Shape
  // layers are used because they can carry expressions that keep them
  // matched to the composition size, which solids and adjustment layers
  // cannot do on their own.
  // ---------------------------------------------------------------

  function uniqueLayerName(comp, base) {
    var index = 1;
    var taken = {};
    for (var i = 1; i <= comp.numLayers; i += 1) {
      taken[comp.layer(i).name] = true;
    }
    while (taken[base + " " + index]) {
      index += 1;
    }
    return base + " " + index;
  }

  function addShapeGroup(layer, groupName) {
    var root = layer.property("ADBE Root Vectors Group");
    var group = root.addProperty("ADBE Vector Group");
    group.name = groupName;
    return group;
  }

  // Builds a rectangle inside the given shape layer whose size tracks the
  // composition. The expression is what makes it re-fit automatically
  // when the comp dimensions change later.
  function addFullFrameRect(layer, fillColor, useStroke) {
    var group = addShapeGroup(layer, "Frame");
    var contents = group.property("ADBE Vectors Group");

    var rect = contents.addProperty("ADBE Vector Shape - Rect");
    var size = rect.property("ADBE Vector Rect Size");
    size.expression = "[thisComp.width, thisComp.height]";

    if (useStroke) {
      var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
      stroke.property("ADBE Vector Stroke Color").setValue(fillColor);
      stroke.property("ADBE Vector Stroke Width").setValue(2);
    } else {
      var fill = contents.addProperty("ADBE Vector Graphic - Fill");
      fill.property("ADBE Vector Fill Color").setValue(fillColor);
    }
    return group;
  }

  function lockLayerToCompCentre(layer) {
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Anchor Point").setValue([0, 0]);
    transform.property("ADBE Position").expression =
      "[thisComp.width / 2, thisComp.height / 2]";
  }

  // Returns the topmost selected layer as an object reference. An index
  // would be wrong the moment a new layer is added, because every index
  // below it shifts by one.
  function topmostSelectedLayer(comp) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).selected) {
        return comp.layer(i);
      }
    }
    return null;
  }

  // Comp-space position of a layer's anchor point, walking up the parent
  // chain and composing each ancestor's Position / Scale / Rotation (2D).
  // For an unparented layer this is just its own Position value, so the
  // null-from-selection centre keeps behaving exactly as before for the
  // common case; for parented layers it uses where they actually sit in
  // the composition instead of their (parent-relative) Position value.
  // Best-effort: a missing/odd property contributes an identity step.
  function layerWorldAnchor(layer) {
    function num(value, fallback) {
      return typeof value === "number" && !isNaN(value) ? value : fallback;
    }
    function tprop(target, matchName) {
      try {
        return target.property("ADBE Transform Group").property(matchName);
      } catch (propError) {
        return null;
      }
    }
    function vec2(prop, dx, dy) {
      if (!prop) { return [dx, dy]; }
      try {
        var v = prop.value;
        return [num(v[0], dx), num(v[1], dy)];
      } catch (valueError) {
        return [dx, dy];
      }
    }
    function scalar(prop, d) {
      if (!prop) { return d; }
      try { return num(prop.value, d); } catch (valueError) { return d; }
    }

    var pt = vec2(tprop(layer, "ADBE Position"), 0, 0);
    var node = null;
    try { node = layer.parent; } catch (parentError) { node = null; }
    while (node) {
      var nPos = vec2(tprop(node, "ADBE Position"), 0, 0);
      var nAnchor = vec2(tprop(node, "ADBE Anchor Point"), 0, 0);
      var nScale = vec2(tprop(node, "ADBE Scale"), 100, 100);
      var nRot = scalar(tprop(node, "ADBE Rotate Z"), 0) * Math.PI / 180;
      // A child's Position lives in the parent's layer space, whose
      // origin is the parent's top-left -- relative to the parent's
      // anchor it is (pt - anchor), then scale/rotate, then + Position.
      var x = (pt[0] - nAnchor[0]) * (nScale[0] / 100);
      var y = (pt[1] - nAnchor[1]) * (nScale[1] / 100);
      var cos = Math.cos(nRot);
      var sin = Math.sin(nRot);
      pt = [nPos[0] + x * cos - y * sin, nPos[1] + x * sin + y * cos];
      try { node = node.parent; } catch (nextError) { node = null; }
    }
    return pt;
  }

  // Places a freshly created layer above the given reference layer,
  // tolerating the case where they are the same layer.
  function placeAbove(created, reference) {
    if (!reference || reference === created) {
      return;
    }
    try {
      created.moveBefore(reference);
    } catch (moveError) {
      // Position in the stack is cosmetic -- never abort over it.
    }
  }

  // Size (px) of the null's square marker, chosen in the main panel's
  // Settings. Kept in AE's own preferences (app.settings) rather than a
  // panel's localStorage: it survives AE restarts and is the same value
  // for every window that creates nulls (main panel and "MF - Camadas"
  // each have their own localStorage).
  var NULL_MARKER_SECTION = "MotionFilm";
  var NULL_MARKER_KEY = "nullMarkerSize";
  var NULL_MARKER_DEFAULT = 44;

  function clampNullMarkerSize(value) {
    var size = Math.round(Number(value));
    if (isNaN(size)) { return NULL_MARKER_DEFAULT; }
    return Math.max(4, Math.min(2000, size));
  }

  function readNullMarkerSize() {
    try {
      if (app.settings.haveSetting(NULL_MARKER_SECTION, NULL_MARKER_KEY)) {
        return clampNullMarkerSize(app.settings.getSetting(NULL_MARKER_SECTION, NULL_MARKER_KEY));
      }
    } catch (readError) {}
    return NULL_MARKER_DEFAULT;
  }

  function getNullMarkerSize() {
    var saved = false;
    try { saved = app.settings.haveSetting(NULL_MARKER_SECTION, NULL_MARKER_KEY); } catch (haveError) {}
    return stringify({ ok: true, size: readNullMarkerSize(), saved: saved });
  }

  function setNullMarkerSize(rawPayload) {
    var payload = parse(rawPayload) || {};
    var size = clampNullMarkerSize(payload.size);
    try {
      app.settings.saveSetting(NULL_MARKER_SECTION, NULL_MARKER_KEY, String(size));
      // Prefs are otherwise only flushed on a clean quit -- write now so
      // a crash doesn't lose the choice.
      try { app.preferences.saveToDisk(); } catch (flushError) {}
    } catch (saveError) {
      return stringify({ ok: false, error: String(saveError) });
    }
    return stringify({ ok: true, size: size });
  }

  // Button 1: a shape layer that stands in for a null. It is created at
  // the average anchor-point position of the selected layers, then those
  // layers are parented to it, so the whole group can be moved from its
  // shared centre.
  //
  // rawOptions (optional): { compCentre: true } -- Shift+click in the
  // panel. The null goes to the centre of the comp instead of the
  // selection's centre, so scaling it scales every child around the
  // middle of the frame. Timing and parenting are unchanged.
  function createShapeNull(rawOptions) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var options = parse(rawOptions) || {};
    var atCompCentre = options.compCentre === true;
    var layers = selectedLayers();

    var centre = [comp.width / 2, comp.height / 2];
    // Span the null exactly across the selected layers' combined
    // in/out range instead of the whole composition, so it doesn't
    // outlive (or start before) what it's parenting.
    var minIn = null;
    var maxOut = null;
    if (layers.length) {
      var sumX = 0;
      var sumY = 0;
      var counted = 0;
      for (var i = 0; i < layers.length; i += 1) {
        try {
          // A layer's anchor point in comp space -- averaging these gives
          // the centre of the selection. layerWorldAnchor resolves the
          // parent chain, so a layer that's parented elsewhere still
          // contributes where it actually sits, not its parent-relative
          // Position value.
          var position = layerWorldAnchor(layers[i]);
          sumX += Number(position[0]) || 0;
          sumY += Number(position[1]) || 0;
          counted += 1;
        } catch (positionError) {
          // Layer types without a plain Position are skipped.
        }
        try {
          var layerIn = layers[i].inPoint;
          var layerOut = layers[i].outPoint;
          minIn = minIn === null ? layerIn : Math.min(minIn, layerIn);
          maxOut = maxOut === null ? layerOut : Math.max(maxOut, layerOut);
        } catch (timeError) {
          // Layer types without inPoint/outPoint are skipped.
        }
      }
      if (counted && !atCompCentre) {
        centre = [sumX / counted, sumY / counted];
      }
      // Layer in/out points read back from AE carry tiny floating-point
      // noise (e.g. 2.08366666...7 instead of an exact multiple of the
      // frame duration). Setting outPoint to a value that's a hair past
      // its true frame rounds up to the next frame instead of landing on
      // it, which is what made the null consistently overshoot by a
      // sliver -- quantizing to the nearest frame removes that noise.
      if (minIn !== null && maxOut !== null && comp.frameDuration) {
        var frameDuration = comp.frameDuration;
        minIn = Math.round(minIn / frameDuration) * frameDuration;
        maxOut = Math.round(maxOut / frameDuration) * frameDuration;
      }
    }

    // 3D: if any selected layer is 3D -- or is a camera/light, which are
    // always 3D -- the null is created as a 3D layer too, centred on the
    // selection's real 3D world position (see the expression step below).
    var make3D = false;
    for (var t3 = 0; t3 < layers.length; t3 += 1) {
      try {
        if (layers[t3] instanceof CameraLayer || layers[t3] instanceof LightLayer || layers[t3].threeDLayer === true) {
          make3D = true;
          break;
        }
      } catch (threeDError) {}
    }

    var reference = topmostSelectedLayer(comp);
    app.beginUndoGroup("Mótion Film: Null layer");
    var created;
    var parented = 0;
    var nullParentName = null;
    try {
      created = comp.layers.addShape();
      created.name = uniqueLayerName(comp, "Null");

      // A small crosshair marker so the helper is visible while working.
      var group = addShapeGroup(created, "Marker");
      var contents = group.property("ADBE Vectors Group");
      var rect = contents.addProperty("ADBE Vector Shape - Rect");
      var markerSize = readNullMarkerSize();
      rect.property("ADBE Vector Rect Size").setValue([markerSize, markerSize]);
      var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
      stroke.property("ADBE Vector Stroke Color").setValue([1, 0.35, 0.35]);
      stroke.property("ADBE Vector Stroke Width").setValue(2);

      var transform = created.property("ADBE Transform Group");
      if (make3D) {
        created.threeDLayer = true;
        transform.property("ADBE Anchor Point").setValue([0, 0, 0]);
        var centre3D = [centre[0], centre[1], 0];
        if (layers.length && !atCompCentre) {
          // layerWorldAnchor is 2D-only (no Z, no X/Y rotation). For 3D,
          // let AE itself resolve each selected layer's world position:
          // a temporary expression averaging toWorld() of every selected
          // layer (anchor point for AV layers, layer origin for cameras /
          // lights, which have no anchor), read back at the current time,
          // then baked as a plain value. By index, not name: names can
          // repeat. Indices are read now, after addShape() shifted them.
          var sumParts = [];
          for (var w = 0; w < layers.length; w += 1) {
            try {
              var li = layers[w].index;
              var isRig = layers[w] instanceof CameraLayer || layers[w] instanceof LightLayer;
              sumParts.push("thisComp.layer(" + li + ").toWorld(" + (isRig ? "[0,0,0]" : "thisComp.layer(" + li + ").anchorPoint") + ")");
            } catch (indexError) {}
          }
          if (sumParts.length) {
            var posProp = transform.property("ADBE Position");
            try {
              posProp.expression = "var s = [0,0,0];\n" +
                "s = add(s, " + sumParts.join(");\ns = add(s, ") + ");\n" +
                "div(s, " + sumParts.length + ");";
              var worldValue = posProp.value;
              posProp.expression = "";
              if (worldValue && worldValue.length >= 2) {
                centre3D = [Number(worldValue[0]) || 0, Number(worldValue[1]) || 0, Number(worldValue[2]) || 0];
              }
            } catch (expressionError) {
              try { posProp.expression = ""; } catch (clearError) {}
            }
          }
        }
        transform.property("ADBE Position").setValue(centre3D);
      } else {
        transform.property("ADBE Anchor Point").setValue([0, 0]);
        transform.property("ADBE Position").setValue(centre);
      }

      // Guide layers stay visible in the viewer but are excluded from
      // renders, which is the behaviour a null needs.
      created.guideLayer = true;

      if (minIn !== null && maxOut !== null) {
        // Order matters, and not for the reason assumed earlier: setting
        // inPoint moves the whole layer to preserve its *current*
        // duration instead of trimming in place, shifting outPoint along
        // with it. Confirmed from a live diagnostic -- requesting
        // 10..49f produced 10..59f, a 10-frame (== the new inPoint)
        // overshoot on outPoint. So inPoint has to be set first (while
        // outPoint is still at its wide default, the resulting shift is
        // harmless), and outPoint set last so it lands on the exact
        // requested value no matter what the inPoint assignment did to it.
        created.inPoint = minIn;
        created.outPoint = maxOut;
      }

      // Parent first: this is the whole point of the button, so it must
      // not be skipped if restacking runs into trouble.
      //
      // The null is INSERTED into the hierarchy (user request, replacing
      // the older "link the top of the chain" rule): each selected layer
      // now follows the null, and the null follows whatever that layer
      // followed before -- layer -> null -> old parent. So a rig keeps
      // working from its old parent, with the new null as an extra level
      // right above the selected layers.
      //
      // - A selected layer whose parent is ALSO selected is left alone
      //   (it keeps following its selected parent, which now follows the
      //   null) -- re-parenting it would break the user's own chain.
      // - The null can only have one parent. If the linked layers had
      //   different parents, the null follows the one most of them shared
      //   (tie: the parent of the topmost one). Every linked layer still
      //   follows the null; nothing moves on screen either way.
      // - Plain `.parent =` (not setParentWithJump) recalculates the
      //   transform so nothing moves. The null gets its parent first,
      //   while it still sits at its world-space centre.
      // Indices are compared live (after addShape() shifted them), since
      // two AE references to the same layer are not === to each other.
      var selectedIdx = {};
      for (var s = 0; s < layers.length; s += 1) {
        try { selectedIdx[layers[s].index] = true; } catch (idxError) {}
      }
      var roots = [];
      var parentVotes = {};
      var bestParent = null;
      var bestVotes = 0;
      var bestRootIndex = Infinity;
      for (var p = 0; p < layers.length; p += 1) {
        try {
          if (layers[p].index === created.index) {
            continue;
          }
          var oldParent = layers[p].parent;
          if (oldParent && selectedIdx[oldParent.index]) {
            continue;
          }
          roots.push(layers[p]);
          if (oldParent) {
            var key = oldParent.index;
            parentVotes[key] = (parentVotes[key] || 0) + 1;
            var rootIndex = layers[p].index;
            if (parentVotes[key] > bestVotes || (parentVotes[key] === bestVotes && rootIndex < bestRootIndex)) {
              bestParent = oldParent;
              bestVotes = parentVotes[key];
              bestRootIndex = rootIndex;
            }
          }
        } catch (scanError) {}
      }
      if (bestParent) {
        try {
          created.parent = bestParent;
          nullParentName = bestParent.name;
        } catch (nullParentError) {
          nullParentName = null;
        }
      }
      for (var r = 0; r < roots.length; r += 1) {
        try {
          roots[r].parent = created;
          parented += 1;
        } catch (parentError) {
          // Some layer types refuse parenting; leave them alone.
        }
      }

      placeAbove(created, reference);
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();

    // Diagnostic for the reported overshoot: read created.inPoint/outPoint
    // back *after* the assignment (rather than trusting the values we
    // wrote) alongside each source layer's own in/out. If AE stored
    // something other than what was assigned, the mismatch shows up here
    // instead of requiring another guess from a timeline screenshot.
    var diag = null;
    if (minIn !== null && maxOut !== null) {
      diag = {
        requestedIn: minIn,
        requestedOut: maxOut,
        frameDuration: comp.frameDuration,
        createdIn: created.inPoint,
        createdOut: created.outPoint,
        layers: []
      };
      for (var d = 0; d < layers.length; d += 1) {
        try {
          diag.layers.push({ name: layers[d].name, inPoint: layers[d].inPoint, outPoint: layers[d].outPoint });
        } catch (diagError) {
          // Skip layer types without in/out.
        }
      }
    }
    return stringify({ ok: true, name: created.name, parented: parented, nullParent: nullParentName, threeD: make3D, compCentre: atCompCentre, diag: diag });
  }

  // Button 2: a shape layer acting as an adjustment layer, sized to the
  // comp by expression so it keeps covering the frame if the comp is
  // resized later.
  function createShapeAdjustment() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var reference = topmostSelectedLayer(comp);
    app.beginUndoGroup("Mótion Film: Adjustment layer");
    var created;
    try {
      created = comp.layers.addShape();
      created.name = uniqueLayerName(comp, "Adjustment");
      addFullFrameRect(created, [1, 1, 1], false);
      lockLayerToCompCentre(created);
      created.adjustmentLayer = true;
      placeAbove(created, reference);
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, name: created.name });
  }

  // Button 3: a shape layer acting as a solid, also expression-sized to
  // the composition.
  function createShapeSolid(rawColor) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var parsed = parse(rawColor);
    var color = (parsed instanceof Array && parsed.length >= 3) ? parsed : [1, 1, 1];
    var reference = topmostSelectedLayer(comp);

    app.beginUndoGroup("Mótion Film: Solid layer");
    var created;
    try {
      created = comp.layers.addShape();
      created.name = uniqueLayerName(comp, "Solid");
      addFullFrameRect(created, color, false);
      lockLayerToCompCentre(created);
      placeAbove(created, reference);
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, name: created.name });
  }

  function addVectors(a, b) {
    var out = [];
    var length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i += 1) {
      out.push((Number(a[i]) || 0) + (Number(b[i]) || 0));
    }
    return out;
  }

  // Computes how much Position must move, at a given time, to cancel out
  // an anchor-point shift of deltaAnchor so the layer does not jump on
  // screen. Accounts for Scale and (Z) Rotation at that time -- the same
  // math AE itself uses when you drag the anchor with the Pan Behind tool.
  // For 3D layers, X/Y rotation and orientation are not factored in; the
  // compensation stays exact for layers only rotated around Z.
  function anchorCompensationAt(scaleProp, rotationProp, deltaAnchor, time, is3D) {
    var scaleVal = time === null ? scaleProp.value : scaleProp.valueAtTime(time, false);
    var rotationVal = 0;
    if (rotationProp) {
      rotationVal = time === null ? rotationProp.value : rotationProp.valueAtTime(time, false);
    }
    var sx = (Number(scaleVal[0]) || 100) / 100;
    var sy = (Number(scaleVal[1]) || 100) / 100;
    var theta = ((Number(rotationVal) || 0) * Math.PI) / 180;
    var dx = deltaAnchor[0] * sx;
    var dy = deltaAnchor[1] * sy;
    var rotatedX = dx * Math.cos(theta) - dy * Math.sin(theta);
    var rotatedY = dx * Math.sin(theta) + dy * Math.cos(theta);
    if (is3D) {
      var sz = (Number(scaleVal[2]) || 100) / 100;
      var dz = (Number(deltaAnchor[2]) || 0) * sz;
      return [rotatedX, rotatedY, dz];
    }
    return [rotatedX, rotatedY];
  }

  // layer.sourceRectAtTime() never accounts for masks -- confirmed live
  // with a test solid + a mask well inside its bounds: the returned rect
  // stayed the full, unmasked source size regardless of the `extents`
  // argument (true or false) or the mask's mode. So when a mask actually
  // narrows the visible area, the 9-point anchor grid needs its own
  // bounding box computed from the mask's own vertices, intersected with
  // the natural source rect (a mask can only ever shrink the visible
  // area here, never grow it beyond the source).
  //
  // Only masks in a mode that *adds* to the visible region (Add,
  // Intersect, Lighten, Darken) are folded into that box; None obviously
  // contributes nothing, and Subtract/Difference describe a hole cut out
  // of the region rather than the region itself, so including their
  // vertices in the union would incorrectly grow the box instead of
  // shrinking it. With more than one contributing mask this is a
  // simple union of their vertex bounds, not a true boolean union of
  // their shapes -- close enough for the common case (one mask), but a
  // layer with several oddly-shaped overlapping masks may still land
  // slightly off.
  function maskAwareSourceRect(layer, rect) {
    var masks = layer.Masks;
    if (!masks || masks.numProperties === 0) {
      return rect;
    }
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 1; i <= masks.numProperties; i += 1) {
      var mask = masks.property(i);
      var mode = mask.maskMode;
      if (mode === MaskMode.NONE || mode === MaskMode.SUBTRACT || mode === MaskMode.DIFFERENCE) {
        continue;
      }
      var vertices = mask.property("ADBE Mask Shape").value.vertices;
      for (var v = 0; v < vertices.length; v += 1) {
        var x = vertices[v][0];
        var y = vertices[v][1];
        if (minX === null || x < minX) { minX = x; }
        if (maxX === null || x > maxX) { maxX = x; }
        if (minY === null || y < minY) { minY = y; }
        if (maxY === null || y > maxY) { maxY = y; }
      }
    }
    if (minX === null) {
      return rect;
    }
    var left = Math.max(rect.left, minX);
    var top = Math.max(rect.top, minY);
    var right = Math.min(rect.left + rect.width, maxX);
    var bottom = Math.min(rect.top + rect.height, maxY);
    if (right <= left || bottom <= top) {
      return rect;
    }
    return { left: left, top: top, width: right - left, height: bottom - top };
  }

  // Comp-space point -> this layer's own (anchor) space at the current
  // time, through parents, scale, rotation and the anchor itself. Done by
  // AE's own fromComp() on a throw-away Point Control so every transform
  // case is handled exactly; the control is removed right after (inside
  // the caller's undo group, so it never shows up on its own).
  function compPointToLayerSpace(layer, comp, x, y) {
    var parade = layer.property("ADBE Effect Parade");
    if (!parade || !parade.canAddProperty("ADBE Point Control")) {
      throw new Error("This layer type can't take a comp-frame anchor.");
    }
    var control = parade.addProperty("ADBE Point Control");
    try {
      var point = control.property(1);
      point.expression = "var p = fromComp([" + x + ", " + y + "]); [p[0], p[1]];";
      if (point.expressionError) {
        throw new Error(point.expressionError);
      }
      var value = point.valueAtTime(comp.time, false);
      return [Number(value[0]), Number(value[1])];
    } finally {
      try { control.remove(); } catch (removeError) {}
    }
  }

  // fx/fy pick one of the 9 grid points; normally of the layer's own
  // bounds, with toCompFrame (Shift+click) of the composition frame
  // instead -- e.g. text at the edge with its anchor at the frame centre.
  function applyAnchorPresetToLayer(layer, comp, fx, fy, toCompFrame) {
    var transform = layer.property("ADBE Transform Group");
    if (!transform) {
      throw new Error("Layer has no transform properties.");
    }
    var anchorProp = transform.property("ADBE Anchor Point");
    var positionProp = transform.property("ADBE Position");
    var scaleProp = transform.property("ADBE Scale");
    var rotationProp = transform.property("ADBE Rotate Z");
    if (!anchorProp || !positionProp) {
      throw new Error("Anchor Point or Position property not found on this layer.");
    }

    var is3D = !!layer.threeDLayer;
    var currentAnchor = cloneValue(anchorProp.value);
    var targetAnchor;
    if (toCompFrame) {
      targetAnchor = compPointToLayerSpace(layer, comp, comp.width * fx, comp.height * fy);
    } else {
      var rect = maskAwareSourceRect(layer, layer.sourceRectAtTime(comp.time, false));
      targetAnchor = [
        rect.left + rect.width * fx,
        rect.top + rect.height * fy
      ];
    }
    if (is3D) {
      targetAnchor.push(currentAnchor[2] || 0);
    }
    // Keep deltaAnchor the same dimensionality as the anchor property
    // itself (2 values for a 2D layer, 3 for a 3D layer). Adding a 3-value
    // delta onto a 2D anchor keyframe produces an invalid 3-value array
    // that After Effects rejects outright.
    var deltaAnchor = is3D
      ? [targetAnchor[0] - currentAnchor[0], targetAnchor[1] - currentAnchor[1], targetAnchor[2] - (currentAnchor[2] || 0)]
      : [targetAnchor[0] - currentAnchor[0], targetAnchor[1] - currentAnchor[1]];
    var deltaMagnitude = Math.abs(deltaAnchor[0]) + Math.abs(deltaAnchor[1]) + Math.abs(deltaAnchor[2] || 0);
    if (deltaMagnitude < 0.0001) {
      return false;
    }

    // Shift every anchor keyframe by the same constant delta so the
    // reference point lands exactly on the target preset at the current
    // time while any existing anchor animation shape is preserved.
    if (anchorProp.numKeys > 0) {
      for (var k = 1; k <= anchorProp.numKeys; k += 1) {
        anchorProp.setValueAtKey(k, addVectors(cloneValue(anchorProp.keyValue(k)), deltaAnchor));
      }
    } else {
      anchorProp.setValue(targetAnchor);
    }

    if (positionProp.numKeys > 0) {
      for (var pk = 1; pk <= positionProp.numKeys; pk += 1) {
        var keyTime = positionProp.keyTime(pk);
        var compensation = anchorCompensationAt(scaleProp, rotationProp, deltaAnchor, keyTime, is3D);
        positionProp.setValueAtKey(pk, addVectors(cloneValue(positionProp.keyValue(pk)), compensation));
      }
    } else {
      var staticCompensation = anchorCompensationAt(scaleProp, rotationProp, deltaAnchor, null, is3D);
      positionProp.setValue(addVectors(cloneValue(positionProp.value), staticCompensation));
    }

    return true;
  }

  function setAnchorPreset(rawPayload) {
    var payload = parse(rawPayload);
    var comp = activeComp();
    var layers = selectedLayers();
    if (!comp || !layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }
    var fx = Math.max(0, Math.min(1, Number(payload.fx)));
    var fy = Math.max(0, Math.min(1, Number(payload.fy)));
    if (isNaN(fx)) {
      fx = 0.5;
    }
    if (isNaN(fy)) {
      fy = 0.5;
    }

    var toCompFrame = !!payload.compFrame;

    var changed = 0;
    var alreadyThere = 0;
    var firstError = null;
    var failedLayers = 0;
    app.beginUndoGroup("Mótion Film: Anchor point");
    for (var i = 0; i < layers.length; i += 1) {
      try {
        if (applyAnchorPresetToLayer(layers[i], comp, fx, fy, toCompFrame)) {
          changed += 1;
        } else {
          alreadyThere += 1;
        }
      } catch (layerError) {
        failedLayers += 1;
        if (!firstError) {
          firstError = String(layerError);
        }
      }
    }
    app.endUndoGroup();
    if (!changed) {
      if (firstError) {
        return stringify({ ok: false, error: firstError });
      }
      return stringify({ ok: false, error: "Layer(s) already at that anchor position." });
    }
    var result = { ok: true, changed: changed, compFrame: toCompFrame };
    if (failedLayers) {
      result.skipped = failedLayers;
      result.skipReason = firstError;
    }
    return stringify(result);
  }

  function visitProperties(group, callback) {
    if (!group || typeof group.numProperties !== "number") {
      return;
    }
    for (var i = 1; i <= group.numProperties; i += 1) {
      var property = group.property(i);
      if (!property) {
        continue;
      }
      if (property.propertyType === PropertyType.PROPERTY) {
        callback(property);
      } else {
        visitProperties(property, callback);
      }
    }
  }

  function forEachKeyedProperty(callback) {
    var layers = selectedLayers();
    for (var i = 0; i < layers.length; i += 1) {
      visitProperties(layers[i], callback);
    }
  }

  function forEachKeyedPropertyAnyLayer(callback) {
    // Keyframes can be box-selected across several layer tracks in the
    // timeline without those layers' rows being "selected" themselves.
    // Operations driven by keyframe selection (reverse, apply velocity,
    // reposition) must consider every layer in the comp, not just the
    // ones comp.selectedLayers reports, or only the last-selected row
    // gets touched.
    //
    // Used to do that with visitProperties(layer, callback) here -- a
    // full RECURSIVE walk of every property on every layer (every
    // effect, every text animator, every mask, the works), calling back
    // on each leaf to check keySelected(). That doesn't scale: every
    // property access crosses the ExtendScript<->AE engine bridge, and
    // that per-call bridge cost is what actually dominates, not the
    // property count. Real user report: applying a velocity curve got
    // slower the more layers/effects a comp had, even though only ONE
    // layer's keyframes were ever selected -- because this used to walk
    // every OTHER layer's entire property tree too, looking for a
    // selection that was never going to be there on them.
    //
    // layer.selectedProperties is AE's own bookkeeping of which
    // properties are currently highlighted in the Timeline -- selecting
    // keyframes (individually, or by box-select across several layer
    // rows) marks each owning property as selected there, the same as
    // clicking the property row itself would. Reading it is ONE cheap
    // call per layer instead of a full tree walk; for the common case
    // of only one layer actually having anything selected, every OTHER
    // layer now costs just that one call and nothing else -- no more
    // scanning proportional to total comp complexity for a selection
    // that lives on a single property.
    var layers = allLayersInComp();
    for (var i = 0; i < layers.length; i += 1) {
      var selected = null;
      try {
        selected = layers[i].selectedProperties;
      } catch (selectedPropertiesError) {
        selected = null;
      }
      if (!selected || !selected.length) {
        continue;
      }
      for (var j = 0; j < selected.length; j += 1) {
        var property = selected[j];
        if (property && property.propertyType === PropertyType.PROPERTY) {
          callback(property, layers[i]);
        }
      }
    }
  }

  function keyframeUtility(action) {
    if (action === "reverse") {
      return reverseSelectedKeyframes();
    }
    if (action === "reposition") {
      return repositionSelectedKeyframes();
    }

    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }

    if (action === "reset") {
      return resetSelectedLayers();
    }

    var changed = 0;
    app.beginUndoGroup("Mótion Film: " + action);
    try {
      forEachKeyedProperty(function (property) {
        if (action === "selectAll") {
          for (var selectIndex = 1; selectIndex <= property.numKeys; selectIndex += 1) {
            property.setSelectedAtKey(selectIndex, true);
            changed += 1;
          }
        } else if (action === "deselectAll") {
          for (var deselectIndex = 1; deselectIndex <= property.numKeys; deselectIndex += 1) {
            property.setSelectedAtKey(deselectIndex, false);
            changed += 1;
          }
        } else if (action === "deleteSelected") {
          for (var deleteIndex = property.numKeys; deleteIndex >= 1; deleteIndex -= 1) {
            if (property.keySelected(deleteIndex)) {
              property.removeKey(deleteIndex);
              changed += 1;
            }
          }
        } else {
          for (var keyIndex = 1; keyIndex <= property.numKeys; keyIndex += 1) {
            if (!property.keySelected(keyIndex)) {
              continue;
            }
            if (action === "linear") {
              property.setInterpolationTypeAtKey(
                keyIndex,
                KeyframeInterpolationType.LINEAR,
                KeyframeInterpolationType.LINEAR
              );
            } else if (action === "hold") {
              property.setInterpolationTypeAtKey(
                keyIndex,
                KeyframeInterpolationType.HOLD,
                KeyframeInterpolationType.HOLD
              );
            } else if (action === "bezier") {
              property.setInterpolationTypeAtKey(
                keyIndex,
                KeyframeInterpolationType.BEZIER,
                KeyframeInterpolationType.BEZIER
              );
            } else if (action === "autoBezier") {
              property.setInterpolationTypeAtKey(
                keyIndex,
                KeyframeInterpolationType.BEZIER,
                KeyframeInterpolationType.BEZIER
              );
              property.setTemporalAutoBezierAtKey(keyIndex, true);
              property.setTemporalContinuousAtKey(keyIndex, true);
            }
            changed += 1;
          }
        }
      });
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, changed: changed });
  }

  function selectedKeyIndices(property) {
    var result = [];
    if (!property || typeof property.numKeys !== "number") {
      return result;
    }
    for (var i = 1; i <= property.numKeys; i += 1) {
      if (property.keySelected(i)) {
        result.push(i);
      }
    }
    return result;
  }

  function copyEaseList(eases) {
    var result = [];
    if (!eases) {
      return result;
    }
    for (var i = 0; i < eases.length; i += 1) {
      result.push({
        speed: Number(eases[i].speed) || 0,
        influence: Number(eases[i].influence) || 0
      });
    }
    return result;
  }

  function createEaseList(eases, property, fallbackSpeed, fallbackInfluence, keyIndex) {
    var result = [];
    var source = eases || [];
    var expected = property ? propertyDimensionCount(property, keyIndex) : source.length;
    if (expected < 1) {
      expected = 1;
    }
    for (var i = 0; i < expected; i += 1) {
      var sourceEase = source[i] || source[source.length - 1];
      var speed = sourceEase ? sourceEase.speed : (fallbackSpeed || 0.001);
      var influence = sourceEase ? sourceEase.influence : (fallbackInfluence || 64);
      result.push(new KeyframeEase(Math.max(0.001, Number(speed) || 0.001), Math.max(0.1, Number(influence) || 64)));
    }
    return result;
  }

  function safeKeyTemporalAutoBezier(property, index) {
    try {
      return property.keyTemporalAutoBezier(index);
    } catch (error) {
      return false;
    }
  }

  function safeKeyTemporalContinuous(property, index) {
    try {
      return property.keyTemporalContinuous(index);
    } catch (error) {
      return false;
    }
  }

  function safeKeyInSpatialTangent(property, index) {
    try {
      return cloneValue(property.keyInSpatialTangent(index));
    } catch (error) {
      return null;
    }
  }

  function safeKeyOutSpatialTangent(property, index) {
    try {
      return cloneValue(property.keyOutSpatialTangent(index));
    } catch (error) {
      return null;
    }
  }

  function reverseSelectedKeyframes() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }

    // Phase 1: read every selected keyframe across the whole comp before
    // touching anything. After Effects clears keyframe selection comp-wide
    // as soon as one property's keyframes are modified, so reading and
    // mutating property-by-property in a single pass only ever sees
    // selection on the first property it touches.
    var jobs = [];
    forEachKeyedPropertyAnyLayer(function (property) {
      if (!isNumericProperty(property)) {
        return;
      }
      var keys = selectedKeyIndices(property);
      if (keys.length < 2) {
        return;
      }
      var records = [];
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        records.push({
          value: cloneValue(property.keyValue(key)),
          inEase: copyEaseList(property.keyInTemporalEase(key)),
          outEase: copyEaseList(property.keyOutTemporalEase(key)),
          inType: property.keyInInterpolationType(key),
          outType: property.keyOutInterpolationType(key),
          autoBezier: safeKeyTemporalAutoBezier(property, key),
          continuous: safeKeyTemporalContinuous(property, key)
        });
      }
      jobs.push({ property: property, keys: keys, records: records });
    });

    // Phase 2: apply the reversal now that every property's selection has
    // been captured.
    var changed = 0;
    app.beginUndoGroup("Mótion Film: Reverse");
    try {
      for (var jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        var job = jobs[jobIndex];
        for (var targetIndex = 0; targetIndex < job.keys.length; targetIndex += 1) {
          var source = job.records[job.records.length - 1 - targetIndex];
          var targetKey = job.keys[targetIndex];
          job.property.setValueAtKey(targetKey, source.value);
          job.property.setInterpolationTypeAtKey(targetKey, source.outType, source.inType);
          if (source.outEase.length || source.inEase.length) {
            job.property.setTemporalEaseAtKey(
              targetKey,
              createEaseList(source.outEase, job.property, 0.001, 64, targetKey),
              createEaseList(source.inEase, job.property, 0.001, 64, targetKey)
            );
          }
          job.property.setTemporalAutoBezierAtKey(targetKey, source.autoBezier);
          job.property.setTemporalContinuousAtKey(targetKey, source.continuous);
          changed += 1;
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "No selected keyframes found. Select keyframes in the timeline first." });
    }
    return stringify({ ok: true, changed: changed });
  }

  function repositionSelectedKeyframes() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    // Phase 1: capture every selected keyframe, on every property, on
    // every layer, before mutating anything. After Effects clears
    // keyframe selection comp-wide the moment a property's keyframes are
    // removed/re-added, so reading selection layer-by-layer while also
    // mutating in the same pass only ever "sees" the first layer touched.
    // forEachKeyedPropertyAnyLayer (see above) does the scan -- same
    // shared, fast path Reverse/Apply Velocity use, instead of this
    // function's own visitProperties() full-tree walk it used to have.
    var jobs = [];
    forEachKeyedPropertyAnyLayer(function (property, layer) {
      var keys = selectedKeyIndices(property);
      if (!keys.length) {
        return;
      }
      var records = [];
      for (var recordIndex = 0; recordIndex < keys.length; recordIndex += 1) {
        var originalKey = keys[recordIndex];
        records.push({
          time: property.keyTime(originalKey),
          value: cloneValue(property.keyValue(originalKey)),
          inEase: copyEaseList(property.keyInTemporalEase(originalKey)),
          outEase: copyEaseList(property.keyOutTemporalEase(originalKey)),
          inType: property.keyInInterpolationType(originalKey),
          outType: property.keyOutInterpolationType(originalKey),
          autoBezier: safeKeyTemporalAutoBezier(property, originalKey),
          continuous: safeKeyTemporalContinuous(property, originalKey),
          inSpatial: safeKeyInSpatialTangent(property, originalKey),
          outSpatial: safeKeyOutSpatialTangent(property, originalKey)
        });
      }
      jobs.push({ layer: layer, property: property, keys: keys, records: records });
    });

    // Phase 2: reposition every captured job now that nothing is left to
    // read from live keyframe selection.
    var changed = 0;
    var touchedLayers = {};
    var failedLayers = 0;
    app.beginUndoGroup("Mótion Film: Reposition");
    for (var jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
      var job = jobs[jobIndex];
      try {
        var offset = job.layer.inPoint - job.records[0].time;
        if (Math.abs(offset) < 0.00001) {
          continue;
        }

        // After Effects has no setKeyTime method. Recreate the selected
        // keys at their new times, then restore their interpolation data.
        for (var removeIndex = job.keys.length - 1; removeIndex >= 0; removeIndex -= 1) {
          job.property.removeKey(job.keys[removeIndex]);
        }
        var layerChanged = 0;
        for (var addIndex = 0; addIndex < job.records.length; addIndex += 1) {
          var record = job.records[addIndex];
          var targetTime = record.time + offset;
          job.property.setValueAtTime(targetTime, record.value);
          var targetKey = findKeyAtTime(job.property, targetTime);
          if (targetKey < 1) {
            continue;
          }
          job.property.setInterpolationTypeAtKey(targetKey, record.inType, record.outType);
          if (record.inEase.length || record.outEase.length) {
            job.property.setTemporalEaseAtKey(
              targetKey,
              createEaseList(record.inEase, job.property, 0.001, 64, targetKey),
              createEaseList(record.outEase, job.property, 0.001, 64, targetKey)
            );
          }
          if (record.inSpatial && record.outSpatial) {
            try {
              job.property.setSpatialTangentsAtKey(targetKey, record.inSpatial, record.outSpatial);
            } catch (spatialError) {
              // Non-spatial properties do not accept spatial tangents.
            }
          }
          job.property.setTemporalAutoBezierAtKey(targetKey, record.autoBezier);
          job.property.setTemporalContinuousAtKey(targetKey, record.continuous);
          job.property.setSelectedAtKey(targetKey, true);
          changed += 1;
          layerChanged += 1;
        }
        if (layerChanged) {
          touchedLayers[job.layer.index] = true;
        }
      } catch (jobError) {
        // A single incompatible property/layer no longer aborts the batch
        // -- every other captured job still gets repositioned.
        failedLayers += 1;
      }
    }
    app.endUndoGroup();
    if (!changed && !failedLayers) {
      return stringify({ ok: false, error: "No selected keyframes found. Select keyframes in the timeline first." });
    }
    var touchedCount = 0;
    for (var touchedKey in touchedLayers) {
      if (touchedLayers.hasOwnProperty(touchedKey)) {
        touchedCount += 1;
      }
    }
    var result = { ok: true, changed: changed, layers: touchedCount };
    if (failedLayers) {
      result.skipped = failedLayers;
    }
    return stringify(result);
  }

  function findKeyAtTime(property, time) {
    for (var i = 1; i <= property.numKeys; i += 1) {
      if (Math.abs(property.keyTime(i) - time) < 0.00001) {
        return i;
      }
    }
    return 0;
  }

  // Copy/Paste the easing *curve* only (interpolation type + temporal
  // ease) of selected keyframes -- independent of the graph editor's
  // single uniform curve (the Apply Curve button): this captures each
  // selected keyframe's own curve, in order, even if they differ from
  // each other, and reapplies that same sequence onto a completely
  // different keyframe selection later. Values and times are never
  // touched, only the shape of the ease.

  function copySelectedKeyframeCurves() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var curves = [];
    forEachKeyedPropertyAnyLayer(function (property) {
      var keys = selectedKeyIndices(property);
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        curves.push({
          inType: property.keyInInterpolationType(key),
          outType: property.keyOutInterpolationType(key),
          inEase: copyEaseList(property.keyInTemporalEase(key)),
          outEase: copyEaseList(property.keyOutTemporalEase(key))
        });
      }
    });
    if (!curves.length) {
      return stringify({ ok: false, error: "No selected keyframes found. Select keyframes in the timeline first." });
    }
    return stringify({ ok: true, curves: curves, count: curves.length });
  }

  function pasteSelectedKeyframeCurves(rawCurves) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var curves = parse(rawCurves);
    if (!curves || !curves.length) {
      return stringify({ ok: false, error: "Nothing copied yet." });
    }

    // Phase 1: capture the *target* selection before touching anything,
    // same reasoning as every other multi-layer keyframe utility here --
    // AE clears comp-wide keyframe selection the moment one property's
    // keyframes are modified.
    var jobs = [];
    forEachKeyedPropertyAnyLayer(function (property) {
      var keys = selectedKeyIndices(property);
      if (keys.length) {
        jobs.push({ property: property, keys: keys });
      }
    });
    if (!jobs.length) {
      return stringify({ ok: false, error: "No selected keyframes found. Select keyframes in the timeline first." });
    }

    // Phase 2: apply, cycling back through the copied curves if there
    // are more target keyframes than were copied.
    var changed = 0;
    var skipped = 0;
    var cursor = 0;
    app.beginUndoGroup("Mótion Film: Paste keyframe curves");
    for (var jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
      var job = jobs[jobIndex];
      for (var k = 0; k < job.keys.length; k += 1) {
        var key = job.keys[k];
        var curve = curves[cursor % curves.length];
        cursor += 1;
        try {
          job.property.setInterpolationTypeAtKey(key, curve.inType, curve.outType);
          try {
            if ((curve.inEase && curve.inEase.length) || (curve.outEase && curve.outEase.length)) {
              job.property.setTemporalEaseAtKey(
                key,
                createEaseList(curve.inEase, job.property, 0.001, 64, key),
                createEaseList(curve.outEase, job.property, 0.001, 64, key)
              );
            }
          } catch (easeError) {
            // Non-fatal -- e.g. a HOLD keyframe doesn't accept temporal ease.
          }
          changed += 1;
        } catch (keyError) {
          // A single incompatible property/keyframe doesn't abort the
          // rest of the batch.
          skipped += 1;
        }
      }
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "Could not paste onto any of the selected keyframes." });
    }
    var result = { ok: true, changed: changed };
    if (skipped) {
      result.skipped = skipped;
    }
    return stringify(result);
  }

  function resetSelectedLayers() {
    var changed = 0;
    app.beginUndoGroup("Mótion Film: Reset");
    try {
      forEachKeyedProperty(function (property) {
        for (var keyIndex = property.numKeys; keyIndex >= 1; keyIndex -= 1) {
          property.removeKey(keyIndex);
          changed += 1;
        }
      });
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, changed: changed });
  }

  function applyVelocityProfile(rawProfile) {
    var profile = parse(rawProfile);
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }

    var samples = profile.samples instanceof Array ? profile.samples : [];
    if (samples.length < 2) {
      return stringify({ ok: false, error: "The velocity profile is empty." });
    }

    var maximum = 0;
    for (var sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      maximum = Math.max(maximum, Number(samples[sampleIndex]) || 0);
    }
    if (maximum <= 0) {
      maximum = 1;
    }

    // The curve is applied to EVERY segment between consecutive selected
    // keyframes, not stretched once across the whole selection. A key
    // shared by two segments (the middle of A-B-C) is the end of one
    // segment and the start of the next, so its incoming side gets the
    // curve's end speed and its outgoing side the curve's start speed.
    //
    // The previous code sampled the profile at i / (keys - 1): with three
    // keys the middle one landed on the curve's PEAK and got the full
    // average speed on both sides, so each segment started/ended moving
    // instead of resting on zero (Motion 4 eases every segment on its own).
    var startRatio = Math.max(0, (Number(samples[0]) || 0) / maximum);
    var endRatio = Math.max(0, (Number(samples[samples.length - 1]) || 0) / maximum);
    var inInfluence = Math.max(1, Math.min(100, Number(profile.inInfluence) || 64));
    var outInfluence = Math.max(1, Math.min(100, Number(profile.outInfluence) || 64));
    var mode = profile.mode || "bezier";
    var changed = 0;
    var skipped = 0;

    // Phase 1: capture which keyframes are selected on every property in
    // the comp before changing any interpolation/ease data (which can
    // clear keyframe selection comp-wide once the first property is
    // touched).
    //
    // Filter on "does AE accept this interpolation here", not on the value
    // being numeric: Mask Path / shape Path keys hold a Shape object but
    // take temporal ease like anything else -- the old isNumericProperty
    // check silently skipped them. Text Source / markers etc. only accept
    // HOLD and are still skipped for bezier modes.
    var wantedType = mode === "hold" ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER;
    var jobs = [];
    forEachKeyedPropertyAnyLayer(function (property) {
      try {
        if (!property.isInterpolationTypeValid(wantedType)) {
          return;
        }
      } catch (validError) {
        return;
      }
      var keys = selectedKeyIndices(property);
      if (keys.length < 2) {
        return;
      }
      jobs.push({ property: property, keys: keys });
    });

    app.beginUndoGroup("Mótion Film: Apply velocity");
    try {
      for (var jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        var property = jobs[jobIndex].property;
        var keys = jobs[jobIndex].keys;

        try {
          for (var i = 0; i < keys.length; i += 1) {
            var current = keys[i];
            // Only the sides that face another selected key belong to a
            // selected segment. The first key's incoming side and the
            // last key's outgoing side belong to segments OUTSIDE the
            // selection (e.g. A-B-C with only B and C selected: B's
            // incoming side shapes A->B) -- those keep their own ease and
            // interpolation, or applying a curve to one segment reshapes
            // its unselected neighbour too (Motion 4 leaves it alone).
            var ownsIn = i > 0;
            var ownsOut = i < keys.length - 1;
            var keepInType = property.keyInInterpolationType(current);
            var keepOutType = property.keyOutInterpolationType(current);
            var keepInEase = copyEaseList(property.keyInTemporalEase(current));
            var keepOutEase = copyEaseList(property.keyOutTemporalEase(current));

            if (mode === "hold") {
              property.setInterpolationTypeAtKey(
                current,
                ownsIn ? KeyframeInterpolationType.HOLD : keepInType,
                ownsOut ? KeyframeInterpolationType.HOLD : keepOutType
              );
              changed += 1;
              continue;
            }

            // A continuous key (smooth "hourglass" key, incl. auto-bezier)
            // stays continuous -- applying a curve must not turn it into
            // a plain ease key. Between two selected segments both sides
            // go to the curve's zero speed, which is still continuous.
            // On a boundary key the selected side instead takes the
            // OUTER side's speed (continuous = equal speeds both sides),
            // so the key stays smooth without reshaping the unselected
            // neighbour; only the influence comes from the curve.
            var keepContinuous = safeKeyTemporalContinuous(property, current) &&
              (ownsIn || keepInType === KeyframeInterpolationType.BEZIER) &&
              (ownsOut || keepOutType === KeyframeInterpolationType.BEZIER);
            var inEase;
            var outEase;
            if (!ownsIn) {
              inEase = exactEaseList(keepInEase);
            } else if (keepContinuous && !ownsOut) {
              inEase = exactEaseList(keepOutEase, inInfluence);
            } else {
              inEase = easeArray(property, scaleSpeed(speedFor(property, keys[i - 1], current), endRatio), inInfluence, current);
            }
            if (!ownsOut) {
              outEase = exactEaseList(keepOutEase);
            } else if (keepContinuous && !ownsIn) {
              outEase = exactEaseList(keepInEase, outInfluence);
            } else {
              outEase = easeArray(property, scaleSpeed(speedFor(property, current, keys[i + 1]), startRatio), outInfluence, current);
            }
            property.setInterpolationTypeAtKey(
              current,
              ownsIn ? KeyframeInterpolationType.BEZIER : keepInType,
              ownsOut ? KeyframeInterpolationType.BEZIER : keepOutType
            );
            // Break auto-bezier/continuous BEFORE writing the ease: on a
            // key that is still continuous AE keeps both sides' speeds
            // in sync, which bleeds one segment's ease into the next.
            // (The outer side's values were read above, while auto-bezier
            // was still on, so it keeps the exact shape it had.)
            property.setTemporalAutoBezierAtKey(current, false);
            property.setTemporalContinuousAtKey(current, false);
            property.setTemporalEaseAtKey(current, inEase, outEase);
            // Writing the ease turns a LINEAR side into BEZIER (confirmed
            // live) -- put the outer side's own type back.
            if ((!ownsIn && keepInType !== KeyframeInterpolationType.BEZIER) ||
                (!ownsOut && keepOutType !== KeyframeInterpolationType.BEZIER)) {
              property.setInterpolationTypeAtKey(
                current,
                ownsIn ? KeyframeInterpolationType.BEZIER : keepInType,
                ownsOut ? KeyframeInterpolationType.BEZIER : keepOutType
              );
            }
            // Diamond mode makes interior keys continuous; it is not
            // forced on a boundary key that wasn't continuous already,
            // since that would drag the unselected side's speed along.
            if (keepContinuous || (mode === "diamond" && ownsIn && ownsOut)) {
              property.setTemporalContinuousAtKey(current, true);
            }
            changed += 1;
          }
        } catch (propertyError) {
          skipped += 1;
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed && skipped) {
      return stringify({ ok: false, error: "After Effects rejected the selected property's temporal easing." });
    }
    return stringify({ ok: true, changed: changed, skipped: skipped });
  }

  // Rebuilds KeyframeEase objects from copyEaseList() data exactly as read
  // -- unlike createEaseList(), no 0.001 speed floor, so a 1D property's
  // negative (falling) speed survives untouched. `influence` (optional)
  // replaces the stored influence while keeping the speeds.
  function exactEaseList(eases, influence) {
    var result = [];
    for (var i = 0; i < eases.length; i += 1) {
      var value = influence !== undefined ? influence : eases[i].influence;
      result.push(new KeyframeEase(eases[i].speed, Math.max(0.1, Math.min(100, value))));
    }
    return result;
  }

  // speedFor() returns an array for multi-dimensional properties, and
  // `array * number` is NaN in ExtendScript -- scale per component.
  function scaleSpeed(speed, ratio) {
    if (speed instanceof Array) {
      var result = [];
      for (var i = 0; i < speed.length; i += 1) {
        result.push(speed[i] * ratio);
      }
      return result;
    }
    return speed * ratio;
  }

  function numericDelta(a, b) {
    if (a instanceof Array && b instanceof Array) {
      var vector = [];
      for (var i = 0; i < a.length; i += 1) {
        vector.push(Math.abs((Number(b[i]) || 0) - (Number(a[i]) || 0)));
      }
      return vector;
    }
    return Math.abs((Number(b) || 0) - (Number(a) || 0));
  }

  function speedFor(property, fromIndex, toIndex) {
    var duration = property.keyTime(toIndex) - property.keyTime(fromIndex);
    if (duration <= 0) {
      return 0;
    }
    var fromValue = property.keyValue(fromIndex);
    var toValue = property.keyValue(toIndex);
    // Mask/shape paths: no meaningful numeric distance. The curve's end
    // speeds are zero anyway, so 0 is exactly what gets applied.
    if (!isNumericValue(fromValue) || !isNumericValue(toValue)) {
      return 0;
    }
    var delta = numericDelta(fromValue, toValue);
    if (delta instanceof Array) {
      var result = [];
      for (var i = 0; i < delta.length; i += 1) {
        result.push(delta[i] / duration);
      }
      return result;
    }
    return delta / duration;
  }

  function easeArray(property, speed, influence, keyIndex) {
    var values = speed instanceof Array ? speed : [speed];
    var expected = propertyDimensionCount(property, keyIndex);
    var result = [];
    for (var i = 0; i < expected; i += 1) {
      var value = values[i] !== undefined ? values[i] : values[values.length - 1];
      result.push(new KeyframeEase(Math.max(0.001, Number(value) || 0.001), Math.max(0.1, Number(influence) || 64)));
    }
    return result;
  }

  // ---------------------------------------------------------------
  // Kit tab: ready-made presets. Each entry in KIT_PRESET_HANDLERS owns
  // one preset id from client/panel.js's KIT_PRESETS list -- add a new
  // preset by adding both an entry there (for the tile + CSS preview)
  // and a matching handler here (for what it actually does to the
  // layer). Kept as one dispatch function rather than N separate
  // exported functions since every preset shares the same "apply to
  // every selected layer, wrapped in one undo group" shape.
  // ---------------------------------------------------------------

  // Empty for now: "text-fade-in" was a test preset, removed at the
  // user's request now that real curated presets get saved directly
  // through the panel's own "Preset layers"/"Preset comp" footer
  // buttons instead of being hand-authored here.
  var KIT_PRESET_HANDLERS = {};

  function applyKitPreset(id) {
    var handler = KIT_PRESET_HANDLERS[id];
    if (!handler) {
      return stringify({ ok: false, error: "Unknown preset." });
    }
    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select at least one layer first." });
    }
    var applied = 0;
    var firstError = null;
    app.beginUndoGroup("Mótion Film: Kit preset " + id);
    for (var i = 0; i < layers.length; i += 1) {
      try {
        handler(layers[i]);
        applied += 1;
      } catch (error) {
        if (!firstError) {
          firstError = String(error);
        }
      }
    }
    app.endUndoGroup();
    if (!applied) {
      return stringify({ ok: false, error: firstError || "Could not apply this preset." });
    }
    return stringify({ ok: true, applied: applied });
  }

  // ---------------------------------------------------------------
  // Icons tab: writes an SVG the panel fetched (from Iconify) to a
  // permanent file and imports it into the project, same as dragging a
  // file in from the OS -- the whole point is skipping the manual
  // browser-download round trip. The file has to be kept (in
  // Documents/Mótion Film Icons, not a temp folder that could get swept
  // by disk cleanup) rather than deleted right after importing: AE
  // footage items reference their source file on disk for as long as
  // they're in the project (re-rendering, scrubbing, relinking), not a
  // one-time read at import time -- deleting it immediately would turn
  // into a "missing footage" error the next time AE needed to reread it.
  // ---------------------------------------------------------------

  var ICONS_PROJECT_FOLDER_NAME = "Motion_Film_Icons";

  // Reuses the same Project-panel folder across every icon import instead
  // of dropping each one loose at the project root -- created once, on the
  // first import, then found and reused on every import after that.
  function findOrCreateIconsProjectFolder() {
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof FolderItem && item.name === ICONS_PROJECT_FOLDER_NAME) {
        return item;
      }
    }
    return app.project.items.addFolder(ICONS_PROJECT_FOLDER_NAME);
  }

  function importSvgIcon(svgText, name) {
    if (!svgText) {
      return stringify({ ok: false, error: "No icon data received." });
    }
    var folder = new Folder(Folder.myDocuments.fsName + "/Mótion Film Icons");
    if (!folder.exists && !folder.create()) {
      return stringify({ ok: false, error: "Could not create a folder to store imported icons." });
    }
    // ":" is illegal in Windows filenames (it's reserved for drive letters /
    // NTFS alternate data streams) -- icon full names are always
    // "prefix:name" (e.g. "material-symbols:star"), so swap it for a plain
    // dash before the stricter allow-list runs. A raw colon here silently
    // wrote into an NTFS alt-data-stream instead of a real file (confirmed
    // live -- AE reported success, but the folder listing came back empty).
    var safeName = String(name || "icon").replace(/:/g, "-").replace(/[^a-zA-Z0-9._-]/g, "_") || "icon";
    var file = new File(folder.fsName + "/" + safeName + ".svg");
    var suffix = 1;
    while (file.exists) {
      file = new File(folder.fsName + "/" + safeName + "-" + suffix + ".svg");
      suffix += 1;
    }

    var addedToComp = false;
    app.beginUndoGroup("Mótion Film: Import icon");
    try {
      if (!file.open("w")) {
        throw new Error("Could not create a file for this icon.");
      }
      file.encoding = "UTF-8";
      file.write(svgText);
      file.close();

      var footageItem = app.project.importFile(new ImportOptions(file));
      if (footageItem) {
        footageItem.parentFolder = findOrCreateIconsProjectFolder();
      }
      var comp = activeComp();
      if (comp && footageItem) {
        var newLayer = comp.layers.add(footageItem);
        // SVG footage is vector art, but a plain still-footage layer in
        // AE only rasterizes it once, at import size, and stretches that
        // fixed raster afterwards -- exactly like a PNG. The
        // "Continuously Rasterize" switch (the same underlying property
        // as precomp's "Collapse Transformation") is what tells AE to
        // re-rasterize the vector at full quality on every frame instead,
        // so scaling the layer up never loses sharpness. Confirmed live:
        // without this, a 512px-tall icon scaled up in the comp visibly
        // pixelated.
        try {
          newLayer.collapseTransformation = true;
        } catch (collapseError) {
          // Non-fatal -- the icon is still imported and usable, just
          // without the crisp-at-any-scale behaviour.
        }
        addedToComp = true;
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, addedToComp: addedToComp });
  }

  // ---------------------------------------------------------------
  // Captions tab: transcribe a footage layer's own audio (via a local
  // whisper.cpp + ffmpeg pipeline the panel drives with Node's
  // child_process -- see initCaptionsTools/transcribeSelectedLayer in
  // client/panel.js) and turn the result into one text layer per
  // sentence, positioned at the right point on the timeline. This host
  // side only needs to (1) hand back which file to feed the pipeline and
  // (2) build the layers once the panel has a transcript back.
  // ---------------------------------------------------------------

  function getSelectedLayerAudioInfo() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open a composition first." });
    }
    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select a layer with video/audio footage first." });
    }
    if (layers.length > 1) {
      return stringify({ ok: false, error: "Select only one layer to transcribe." });
    }
    var layer = layers[0];
    var source = layer.source;
    var file = (source && source.mainSource && source.mainSource.file) ? source.mainSource.file : null;
    if (!file) {
      return stringify({ ok: false, error: "“" + layer.name + "” isn't linked to a media file on disk (solids, shapes, text and precomps don't have one) -- select a video/audio footage layer instead." });
    }
    // Only transcribe the stretch of the source file the layer actually
    // shows on the timeline -- respects trimming (In/Out points) and the
    // comp's own bounds, instead of always reading the whole underlying
    // file regardless of how much of it is actually used. `startTime` is
    // where the footage's own time 0 lands in comp time (constant
    // regardless of trimming), so subtracting it from the visible
    // in/out range converts back to a time range inside the source file
    // itself -- that's what ffmpeg needs to cut out.
    var compIn = Math.max(layer.inPoint, 0);
    var compOut = Math.min(layer.outPoint, comp.duration);
    if (compOut <= compIn) {
      return stringify({ ok: false, error: "“" + layer.name + "” isn't visible within the composition's timeline -- trim it back into view first." });
    }
    var sourceInPoint = compIn - layer.startTime;
    var sourceOutPoint = compOut - layer.startTime;
    return stringify({
      ok: true,
      layerName: layer.name,
      sourceFile: file.fsName,
      sourceInPoint: sourceInPoint,
      sourceOutPoint: sourceOutPoint,
      layerInPoint: compIn
    });
  }

  // ---------------------------------------------------------------
  // Style presets: capture every effect, every Text Animator, and every
  // keyframed/expression-driven Transform property off a layer the user
  // has already styled by hand, so the SAME setup can be stamped onto
  // every caption layer a transcription creates -- entrance animations
  // included, each one re-anchored to its own layer's inPoint rather
  // than staying at wherever the original layer's keyframes happened to
  // sit in comp time.
  //
  // The capture/apply pair below is written generically against AE's
  // property-group model rather than special-cased per effect/animator,
  // because that model is genuinely uniform: PropertyGroup.addProperty()
  // is the same call whether the parent is Effect Parade, a Text
  // Animators list, an Animator's own Selectors list, or its Properties
  // list. The one thing that differs is WHEN addProperty is needed at
  // all -- only for a child of an INDEXED_GROUP (a variable, addable
  // list); a child of a NAMED_GROUP (a fixed structure, like an
  // Animator's Properties/Selectors sub-groups once the Animator itself
  // exists) is already there and just needs `.property(matchName)`.
  // ---------------------------------------------------------------

  // Properties whose value should never be captured/reapplied -- Source
  // Text carries the caption's own transcribed text, which must never be
  // clobbered by a style preset built from a differently-worded layer.
  var STYLE_PRESET_SKIP_MATCHNAMES = { "ADBE Text Document": true };

  function captureStyleNode(prop) {
    var isIndexedChild = false;
    try {
      isIndexedChild = !!(prop.parentProperty && prop.parentProperty.propertyType === PropertyType.INDEXED_GROUP);
    } catch (parentError) {
      isIndexedChild = false;
    }
    var node = { matchName: prop.matchName, isIndexedChild: isIndexedChild };
    // The "eye" toggle: a shape Fill/Stroke/path-operation, an effect, a
    // mask, a text animator, a layer style -- all expose PropertyBase
    // `.enabled`. Only recorded when OFF (default is on), so old
    // templates without the field are unaffected. Without this, a
    // DISABLED stroke/fill/effect gets recreated ENABLED, because
    // addProperty(matchName) always makes an enabled one.
    try {
      if (prop.enabled === false) {
        node.enabled = false;
      }
    } catch (enabledReadError) {
      // Not every property exposes .enabled -- fine.
    }
    // Display name only matters (and is only settable) for a child of an
    // indexed group -- but for THOSE, it can matter a lot. Confirmed live
    // with a third-party "Pseudo/" effect (TextEvo2's own): its parameter
    // tree recreates perfectly via addProperty(matchName) alone, but AE
    // shows it as "Unknown Effect" until something explicitly sets
    // `.name` -- pseudo effects don't carry a self-describing display
    // name the way native effects do; the tool that originally created
    // one (TextEvo2's own script, in this case) sets it by hand right
    // after creating it. That's why display name is captured/reapplied
    // generically here rather than assumed to follow from matchName alone.
    if (isIndexedChild) {
      try {
        node.name = prop.name;
      } catch (nameError) {
        // Non-fatal -- falls back to whatever default name addProperty gives.
      }
    }
    var isGroup = false;
    try {
      isGroup = prop.propertyType !== PropertyType.PROPERTY;
    } catch (typeError) {
      isGroup = false;
    }
    if (isGroup) {
      node.isGroup = true;
      node.children = [];
      var count = 0;
      try {
        count = prop.numProperties;
      } catch (countError) {
        count = 0;
      }
      for (var i = 1; i <= count; i += 1) {
        var child;
        try {
          child = prop.property(i);
        } catch (childError) {
          continue;
        }
        if (!child || STYLE_PRESET_SKIP_MATCHNAMES[child.matchName]) {
          continue;
        }
        node.children.push(captureStyleNode(child));
      }
      return node;
    }
    // Leaf property -- captures an expression AND its keyframes/value
    // together, not one or the other. AE genuinely allows both on the
    // same property at once (confirmed live: a Position with keyframes
    // for the base move PLUS a bounce/overshoot expression driven off a
    // plugin's Amplitude/Frequency/Decay sliders, referencing `value`
    // to read that keyframed baseline and add the overshoot on top) --
    // an early return here used to stop at the expression and silently
    // drop the keyframes, defeating the entire point of a preset saved
    // from a layer like that (the reusable ANIMATION is what a preset
    // is for). See applyStyleLeaf for the matching apply-side fix.
    try {
      if (prop.expressionEnabled && prop.expression) {
        node.expression = prop.expression;
      }
    } catch (expressionError) {
      // Not every property supports expressions -- fine, fall through.
    }
    try {
      var numKeys = prop.numKeys || 0;
      if (numKeys > 0) {
        node.keyframes = [];
        for (var k = 1; k <= numKeys; k += 1) {
          var kf = { time: prop.keyTime(k), value: kitShapeSafe(prop.keyValue(k)) };
          try {
            kf.inType = prop.keyInInterpolationType(k);
            kf.outType = prop.keyOutInterpolationType(k);
          } catch (interpError) {
            // Non-fatal -- reapplied keyframe just falls back to defaults.
          }
          try {
            var inEase = prop.keyInTemporalEase(k);
            var outEase = prop.keyOutTemporalEase(k);
            kf.inEase = [];
            kf.outEase = [];
            for (var d = 0; d < inEase.length; d += 1) {
              kf.inEase.push({ speed: inEase[d].speed, influence: inEase[d].influence });
              kf.outEase.push({ speed: outEase[d].speed, influence: outEase[d].influence });
            }
          } catch (easeError) {
            // Only meaningful for bezier-interpolated keys -- fine to skip.
          }
          node.keyframes.push(kf);
        }
      } else {
        node.value = kitShapeSafe(prop.value);
      }
    } catch (valueError) {
      // A handful of AE property types (markers, some custom effect
      // controls) can't be read this generically -- skip rather than
      // fail the whole capture over one odd property.
    }
    return node;
  }

  // Position and Anchor Point are captured unconditionally (not just
  // when animated) -- at the user's explicit request, so a style preset
  // reproduces WHERE on screen a caption sits, not just its effects,
  // useful for keeping a consistent look applying the same preset across
  // several different videos. Scale/Rotation/Opacity stay conditional
  // (keyframed or expression-driven only) -- those read more as
  // "animation" than "layout", and forcing a static value there could
  // overwrite something a specific caption legitimately needed.
  var STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM = { "ADBE Position": true, "ADBE Anchor Point": true };

  // Kit "Preset layers" (see captureSingleLayerTemplate) recreates a
  // brand-new layer from scratch rather than overlaying a style onto
  // some OTHER already-positioned/sized layer -- there's no existing
  // layout to protect, so the full static appearance should transfer
  // whether it's animated or not. Confirmed live: a layer scaled to,
  // say, 150% by hand (no keyframes, no expression) was coming back at
  // the default 100% on every recreated/inserted copy, since Scale
  // wasn't in STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM and had no
  // animation to otherwise trigger capturing it.
  var KIT_ALWAYS_CAPTURE_TRANSFORM = {
    "ADBE Position": true,
    "ADBE Anchor Point": true,
    "ADBE Scale": true,
    "ADBE Rotate Z": true,
    "ADBE Opacity": true
  };

  // Character-level formatting fields off TextDocument worth carrying
  // between captions -- deliberately NOT ".text" (every caption keeps its
  // own transcribed words) and not read-only/geometry fields like
  // composedLineCount or boxTextSize. Applied in this order so
  // autoLeading (if present) is set before leading, which otherwise can
  // get ignored.
  var TEXT_DOCUMENT_STYLE_FIELDS = [
    "font", "fontSize", "fillColor", "strokeColor", "applyFill", "applyStroke",
    "strokeWidth", "strokeOverFill", "justification", "tracking", "baselineShift",
    "tsume", "verticalScale", "horizontalScale", "allCaps", "smallCaps",
    "superscript", "subscript", "fauxBold", "fauxItalic", "autoLeading", "leading",
    "kerning", "ligature", "direction", "lineJoinType"
  ];

  function captureTextDocumentStyle(layer) {
    var style = {};
    try {
      var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
      for (var i = 0; i < TEXT_DOCUMENT_STYLE_FIELDS.length; i += 1) {
        var field = TEXT_DOCUMENT_STYLE_FIELDS[i];
        try {
          style[field] = doc[field];
        } catch (fieldError) {
          // Not every field is always readable in every AE version/state
          // (e.g. "leading" when autoLeading is on) -- skip individually
          // rather than lose the whole capture over one field.
        }
      }
    } catch (docError) {
      // Not a text layer, or Source Text unavailable.
    }
    return style;
  }

  function applyTextDocumentStyle(layer, style) {
    if (!style) {
      return;
    }
    try {
      var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
      var doc = textProp.value; // starts from the caption's OWN current doc -- its .text is untouched
      for (var i = 0; i < TEXT_DOCUMENT_STYLE_FIELDS.length; i += 1) {
        var field = TEXT_DOCUMENT_STYLE_FIELDS[i];
        if (!(field in style)) {
          continue;
        }
        try {
          doc[field] = style[field];
        } catch (fieldError) {
          // Non-fatal -- move on to the next field.
        }
      }
      textProp.setValue(doc);
    } catch (applyError) {
      // Non-fatal -- the caption still has its text/timing/position.
    }
  }

  // Shared by captureLayerStylePreset (Style Presets, Captions tab) and
  // captureSingleLayerTemplate (Kit layer-group presets, below) -- both
  // want the exact same "effects + text animators + transform + text
  // style" capture, just wrapped in a different envelope (this one adds
  // layerInPoint for time-re-anchoring a preset onto an EXISTING layer;
  // the Kit one adds name/text/duration for CREATING a brand new layer).
  //
  // alwaysCaptureMatchNames overrides which Transform Group properties
  // get captured even when static (no keyframes/expression) -- defaults
  // to STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM (Position/Anchor Point
  // only) for Style Presets, where forcing e.g. Scale onto every
  // caption a preset gets applied to could fight a caption's own
  // legitimate sizing. Kit layer-group presets pass a wider set (see
  // captureSingleLayerTemplate) since there's no existing layer's
  // layout to protect there -- the whole point is recreating a NEW
  // layer that looks exactly like the one captured, animated or not.
  function captureLayerStyleParts(layer, alwaysCaptureMatchNames) {
    var alwaysCaptureSet = alwaysCaptureMatchNames || STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM;
    var parts = { effects: [], textAnimators: [], transform: [], textStyle: captureTextDocumentStyle(layer) };
    try {
      var parade = layer.property("ADBE Effect Parade");
      for (var i = 1; i <= parade.numProperties; i += 1) {
        parts.effects.push(captureStyleNode(parade.property(i)));
      }
    } catch (effectsError) {
      // No effects, or Effect Parade unavailable -- fine, leave empty.
    }
    try {
      var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
      for (var j = 1; j <= animators.numProperties; j += 1) {
        parts.textAnimators.push(captureStyleNode(animators.property(j)));
      }
    } catch (animatorsError) {
      // Not a text layer with animators, or none added -- fine.
    }
    try {
      var transformGroup = layer.property("ADBE Transform Group");
      for (var t = 1; t <= transformGroup.numProperties; t += 1) {
        var transformProp = transformGroup.property(t);
        var alwaysCapture = !!alwaysCaptureSet[transformProp.matchName];
        var hasExpression = false;
        try {
          hasExpression = transformProp.expressionEnabled && !!transformProp.expression;
        } catch (te) {
          hasExpression = false;
        }
        var hasKeys = false;
        try {
          hasKeys = (transformProp.numKeys || 0) > 0;
        } catch (tk) {
          hasKeys = false;
        }
        if (alwaysCapture || hasExpression || hasKeys) {
          parts.transform.push(captureStyleNode(transformProp));
        }
      }
    } catch (transformError) {
      // Fine -- transform capture is best-effort.
    }
    return parts;
  }

  function captureLayerStylePreset() {
    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select a text layer first." });
    }
    if (layers.length > 1) {
      return stringify({ ok: false, error: "Select only one layer to save as a style preset." });
    }
    var layer = layers[0];
    if (!(layer instanceof TextLayer)) {
      return stringify({ ok: false, error: "“" + layer.name + "” isn't a text layer -- select the styled caption/text layer you want to save." });
    }
    var parts = captureLayerStyleParts(layer);
    var preset = { layerInPoint: layer.inPoint, effects: parts.effects, textAnimators: parts.textAnimators, transform: parts.transform, textStyle: parts.textStyle };
    return stringify({ ok: true, preset: preset });
  }

  // "ADBE Text Animator Properties" and "ADBE Text Selectors" are the one
  // AE structure where propertyType lies about what addProperty() means:
  // both report as PropertyType.NAMED_GROUP (confirmed live), so capture
  // correctly records their leaf children as isIndexedChild:false -- yet
  // AE still requires an explicit addProperty(matchName) to ENABLE a new
  // channel from scratch on a freshly created animator, exactly like a
  // real indexed group. Confirmed live: parentGroup.property(matchName)
  // on one of these two groups silently hands back a property object
  // that looks valid (no thrown error, shows up in the UI) but whose
  // canSetExpression is false -- so `prop.expression = ...` in
  // applyStyleLeaf below just silently no-ops. Net effect: keyframes and
  // static values (set via setValue/setValueAtTime, which don't need
  // canSetExpression) transfer fine, but anything actually driven by an
  // expression -- which is what makes most animator-based effects (like
  // TextEvo) move at all -- ends up blank. Forcing addProperty() for
  // children of these two groups specifically (regardless of the
  // isIndexedChild flag) fixes it.
  var STYLE_PRESET_FORCE_ADD_MATCHNAMES = {
    "ADBE Text Animator Properties": true,
    "ADBE Text Selectors": true
  };

  // BUT: "ADBE Text Animator Properties" always reports numProperties as
  // a fixed 103 (confirmed live on a freshly-created, completely empty
  // animator -- not "however many channels were actually added") -- so
  // captureStyleNode's generic walk (`for i=1 to numProperties`)
  // captures a value for every one of those 103 slots regardless of
  // whether the source plugin/user ever genuinely enabled it. Most
  // never-enabled slots just report an inert default value that's
  // harmless as long as apply uses parentGroup.property(matchName) --
  // that's the ORIGINAL (pre-forceAdd) behaviour, and it's silently a
  // no-op for a slot nothing really uses. Force-adding EVERY captured
  // child unconditionally (the fix above) changes that: addProperty()
  // genuinely activates/renders a channel, so forcing it for a slot
  // that was never meant to be active starts rendering it -- confirmed
  // live as the cause of a real regression (TextEvo's inert default
  // "Fill Color" slot, never shown in the source layer's own Timeline,
  // rendering as a solid red fill once copied through a Style Preset).
  // The fix: only force-add a leaf that's actually DYNAMIC (has a
  // captured expression or keyframes) -- that's the exact set that
  // needed this fix in the first place (every genuinely-driven TextEvo
  // channel -- Position, Scale, Opacity, etc. -- is expression-based).
  // A leaf with nothing but a plain captured value falls back to the
  // original parentGroup.property(matchName) lookup, matching pre-fix
  // (safe/inert) behaviour for slots that were never really enabled.
  // Known trade-off: a genuinely useful case this doesn't cover is a
  // static (non-animated, non-expression) value someone deliberately
  // added by hand on one of these two groups -- rarer in practice than
  // an inert default slot, but a real gap if it comes up.
  // The trade-off above turned out to be the COMMON case, not a rare one:
  // the classic text reveal is a static animator value (Position y +100,
  // Opacity 0, Blur 15) with only the Range Selector keyframed -- packs
  // and style presets dropped those values, so text appeared fully
  // formed (confirmed live by rendering source vs applied). An inert
  // slot still holds that slot's default, so a static value that
  // DIFFERS from what the fresh slot reports was really set by someone:
  // add the channel. Equal (= an inert default, e.g. TextEvo's red Fill
  // Color) keeps the safe lookup. Only definite numeric differences
  // count; anything unreadable stays on the old path.
  function nodeNeedsForcedAdd(node, parentGroup) {
    if (node.expression) {
      return true;
    }
    if (node.keyframes && node.keyframes.length) {
      return true;
    }
    if (node.value === undefined || !parentGroup) {
      return false;
    }
    var slot;
    try {
      slot = parentGroup.property(node.matchName);
    } catch (slotError) {
      return false;
    }
    return !!slot && styleValueDiffers(slot, reviveShapeValue(node.value));
  }

  function styleValueDiffers(prop, wanted) {
    var current;
    try {
      current = prop.value;
    } catch (readError) {
      return false;
    }
    if (typeof wanted === "number") {
      return typeof current === "number" && Math.abs(current - wanted) >= 1e-9;
    }
    if (wanted instanceof Array && current instanceof Array && current.length === wanted.length) {
      for (var i = 0; i < wanted.length; i += 1) {
        if (typeof wanted[i] !== "number" || typeof current[i] !== "number") {
          return false;
        }
        if (Math.abs(current[i] - wanted[i]) >= 1e-9) {
          return true;
        }
      }
    }
    return false;
  }

  function applyStyleChildren(parentGroup, children, timeOffset) {
    var parentMatchName = "";
    try {
      parentMatchName = parentGroup.matchName;
    } catch (parentMatchError) {
      parentMatchName = "";
    }
    var forceAddGroup = !!STYLE_PRESET_FORCE_ADD_MATCHNAMES[parentMatchName];
    // Static values AE refused on the first pass. Plugin effects gate
    // some params on others set LATER in the list (confirmed live: a
    // Deep Glow 2 param came back 2 instead of 18), so each one gets a
    // second try once its siblings are in place.
    var retry = [];
    for (var i = 0; i < children.length; i += 1) {
      var node = children[i];
      var targetProp = null;
      var forceAdd = node.isGroup ? forceAddGroup : (forceAddGroup && nodeNeedsForcedAdd(node, parentGroup));
      if (node.isIndexedChild || forceAdd) {
        try {
          targetProp = parentGroup.addProperty(node.matchName);
        } catch (addError) {
          // Already enabled (e.g. re-applying onto the same group), or
          // truly unavailable -- fall back to a plain lookup before
          // giving up on this child entirely.
          try {
            targetProp = parentGroup.property(node.matchName);
          } catch (lookupError) {
            continue;
          }
        }
        if (node.name) {
          try {
            targetProp.name = node.name;
          } catch (renameError) {
            // Non-fatal -- some indexed children (rare) reject renaming.
          }
        }
      } else {
        try {
          targetProp = parentGroup.property(node.matchName);
        } catch (lookupError) {
          continue;
        }
      }
      if (!targetProp) {
        continue;
      }
      if (node.isGroup) {
        applyStyleChildren(targetProp, node.children, timeOffset);
      } else if (!applyStyleLeaf(targetProp, node, timeOffset) && !(node.keyframes && node.keyframes.length)) {
        retry.push({ prop: targetProp, node: node });
      }
      // Restore the "eye" toggle AFTER the subtree is built (disabling a
      // group first could interfere with adding children to it).
      if (node.enabled === false) {
        try {
          targetProp.enabled = false;
        } catch (enabledWriteError) {
          // Non-fatal -- property just stays enabled.
        }
      }
    }
    for (var r = 0; r < retry.length; r += 1) {
      applyStyleLeaf(retry[r].prop, retry[r].node, timeOffset);
    }
  }

  // Captures record EVERY leaf, defaults included (a text animator alone
  // has 103 slots, layer styles dozens), and setValue is the expensive
  // call (undo record + re-evaluation). A freshly created property
  // already holding the captured number/array needs no write -- reading
  // .value is cheap. Anything else (shapes, text documents, colours that
  // differ) is still set as before.
  function styleValueAlreadySet(prop, wanted) {
    var current;
    try {
      current = prop.value;
    } catch (readError) {
      return false;
    }
    if (typeof wanted === "number") {
      return typeof current === "number" && Math.abs(current - wanted) < 1e-9;
    }
    if (typeof wanted === "boolean") {
      return current === wanted;
    }
    if (wanted instanceof Array) {
      if (!(current instanceof Array) || current.length !== wanted.length) {
        return false;
      }
      for (var i = 0; i < wanted.length; i += 1) {
        if (typeof wanted[i] !== "number" || typeof current[i] !== "number" || Math.abs(current[i] - wanted[i]) >= 1e-9) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  // Returns false when the value/keyframes couldn't be written.
  function applyStyleLeaf(prop, node, timeOffset) {
    var failed = false;
    // Keyframes/value go on FIRST, expression LAST -- not either/or.
    // Mirrors captureStyleNode capturing both off the same property: an
    // expression can reference `value` to read the keyframed/static
    // baseline underneath it and layer more on top (a bounce/overshoot
    // expression driven off a plugin's own sliders, keyframed Position
    // as the base move), so both need to actually land on the new
    // property, not just whichever this used to check first.
    try {
      if (node.keyframes && node.keyframes.length) {
        for (var i = 0; i < node.keyframes.length; i += 1) {
          prop.setValueAtTime(node.keyframes[i].time + timeOffset, reviveShapeValue(node.keyframes[i].value));
        }
        for (var k = 1; k <= prop.numKeys; k += 1) {
          var kf = node.keyframes[k - 1];
          if (!kf) {
            continue;
          }
          // Ease FIRST, interpolation type LAST: setTemporalEaseAtKey turns
          // the key into Bezier, so the old order (type, then ease) made
          // every Linear/Hold key come out Bezier (confirmed live).
          try {
            if (kf.inEase && kf.outEase) {
              var inEase = [];
              var outEase = [];
              for (var d = 0; d < kf.inEase.length; d += 1) {
                inEase.push(new KeyframeEase(kf.inEase[d].speed, kf.inEase[d].influence));
                outEase.push(new KeyframeEase(kf.outEase[d].speed, kf.outEase[d].influence));
              }
              prop.setTemporalEaseAtKey(k, inEase, outEase);
            }
          } catch (easeError) {
            // Non-fatal.
          }
          try {
            if (kf.inType && kf.outType) {
              prop.setInterpolationTypeAtKey(k, kf.inType, kf.outType);
            }
          } catch (interpError) {
            // Non-fatal.
          }
        }
      } else if (node.value !== undefined) {
        var wanted = reviveShapeValue(node.value);
        if (!styleValueAlreadySet(prop, wanted)) {
          prop.setValue(wanted);
        }
      }
    } catch (applyError) {
      // One property failing to apply (an odd effect param, a locked
      // value) shouldn't abort the whole preset -- move on. Reported so
      // applyStyleChildren can retry it once the rest of the group is set.
      failed = true;
    }
    try {
      if (node.expression) {
        // Expressions are self-relative (thisLayer/inPoint resolve against
        // WHATEVER layer they're attached to) -- copying the text verbatim
        // onto a new layer already re-anchors it correctly, no time math.
        prop.expression = node.expression;
      }
    } catch (expressionError) {
      // Non-fatal -- property just keeps whatever keyframes/value it got above.
    }
    return !failed;
  }

  // Applies a captured style preset (see captureLayerStylePreset) onto a
  // single already-created layer, re-anchoring every keyframe to THIS
  // layer's own inPoint instead of wherever the original layer's
  // keyframes sat in comp time -- this is what keeps an entrance
  // animation landing at the start of every caption, not just the first.
  function applyStylePresetToLayer(layer, preset) {
    if (!preset) {
      return;
    }
    var timeOffset = layer.inPoint - numberOr(preset.layerInPoint, 0);
    if (preset.effects && preset.effects.length) {
      try {
        applyStyleChildren(layer.property("ADBE Effect Parade"), preset.effects, timeOffset);
      } catch (effectsError) {
        // Non-fatal -- the layer still has its text/timing/position.
      }
    }
    if (preset.textAnimators && preset.textAnimators.length) {
      try {
        applyStyleChildren(layer.property("ADBE Text Properties").property("ADBE Text Animators"), preset.textAnimators, timeOffset);
      } catch (animatorsError) {
        // Non-fatal.
      }
    }
    if (preset.transform && preset.transform.length) {
      try {
        applyStyleChildren(layer.property("ADBE Transform Group"), preset.transform, timeOffset);
      } catch (transformError) {
        // Non-fatal.
      }
    }
    if (preset.textStyle) {
      applyTextDocumentStyle(layer, preset.textStyle);
    }
  }

  // Captions tab, "Change Style" button: strips whatever look/animation
  // a layer already has -- every Effect Parade entry, every Text
  // Animator, and every Transform property's expression/keyframes
  // (collapsed down to a plain static value, not reset to some
  // default -- there's nothing to reset TO here, and the preset about
  // to be applied on top overwrites whichever of these it actually
  // captured anyway). Source Text itself is never touched -- the whole
  // point of this button is swapping the LOOK without retyping the
  // caption or re-transcribing the source video.
  function clearLayerStyleAnimation(layer) {
    try {
      var parade = layer.property("ADBE Effect Parade");
      for (var i = parade.numProperties; i >= 1; i -= 1) {
        try {
          parade.property(i).remove();
        } catch (oneEffectError) {
          // Non-fatal -- move on to the next one.
        }
      }
    } catch (effectsError) {
      // No Effect Parade on this layer type, or nothing in it -- fine.
    }
    try {
      var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
      for (var j = animators.numProperties; j >= 1; j -= 1) {
        try {
          animators.property(j).remove();
        } catch (oneAnimatorError) {
          // Non-fatal.
        }
      }
    } catch (animatorsError) {
      // Not a text layer, or no animators -- fine.
    }
    try {
      var transformGroup = layer.property("ADBE Transform Group");
      for (var t = 1; t <= transformGroup.numProperties; t += 1) {
        var prop = transformGroup.property(t);
        try {
          if (prop.expressionEnabled) {
            prop.expression = "";
          }
        } catch (exprClearError) {
          // Property doesn't support expressions -- fine.
        }
        try {
          prop.expressionEnabled = false;
        } catch (exprDisableError) {
          // Same.
        }
        try {
          if (typeof prop.numKeys === "number") {
            for (var k = prop.numKeys; k >= 1; k -= 1) {
              prop.removeKey(k);
            }
          }
        } catch (keyRemoveError) {
          // Not a keyframeable property, or already static -- fine.
        }
      }
    } catch (transformGroupError) {
      // No Transform Group -- shouldn't happen for a real layer, but
      // non-fatal either way.
    }
  }

  // Captions tab, "Change Style" button -- applies a DIFFERENT saved
  // Style Preset onto whatever text layer(s) are already selected,
  // clearing each one's existing look first (see clearLayerStyleAnimation
  // above). Lets an already-generated or already-imported caption switch
  // its entrance animation/appearance without retyping the text or
  // re-transcribing the source video -- and without hand-building the
  // new animation from scratch either. Reuses applyStylePresetToLayer
  // verbatim (same re-anchoring against THIS layer's own inPoint that
  // caption creation and Kit presets already rely on), just preceded by
  // the clear step neither of those needed (they always start from a
  // brand new, empty layer).
  function applyStylePresetToSelectedLayers(presetJson) {
    var preset = parse(presetJson);
    if (!preset) {
      return stringify({ ok: false, error: "No style preset given." });
    }
    var layers = selectedLayers();
    if (!layers.length) {
      return stringify({ ok: false, error: "Select at least one caption layer first." });
    }
    var changed = 0;
    var skipped = 0;
    app.beginUndoGroup("Mótion Film: Change caption style");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var layer = layers[i];
        if (!textPropertyOf(layer)) {
          skipped += 1;
          continue;
        }
        try {
          clearLayerStyleAnimation(layer);
          applyStylePresetToLayer(layer, preset);
          changed += 1;
        } catch (layerError) {
          // One incompatible layer doesn't abort the rest of the selection.
          skipped += 1;
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!changed) {
      return stringify({ ok: false, error: "No text/caption layer found in the selection." });
    }
    return stringify({ ok: true, changed: changed, skipped: skipped });
  }

  // ---------------------------------------------------------------
  // Kit tab: "layer group" presets. Unlike KIT_PRESET_HANDLERS above
  // (which only modifies whatever layer(s) the user already has
  // selected), a layer-group preset CREATES brand new layer(s) from a
  // captured template and drops them into whatever composition is
  // currently active, landing at the current playhead -- for
  // ready-made multi-layer pieces (e.g. a title made of two TextEvo
  // layers) meant to be inserted as a unit, not painted onto something
  // that's already there.
  //
  // There's no in-panel "save as Kit preset" button for this (that's
  // what the separate Style Preset system under Captions is for, and it
  // only captures ONE layer's worth of styling to reapply onto existing
  // text anyway). These are curated, ship-with-the-extension presets:
  // the workflow is the user builds/animates the real layers by hand in
  // a scratch composition, then asks for them to be turned into a Kit
  // preset -- captureKitLayerGroupFromNames does that capture (run once,
  // live, against the real project), and the result gets pasted into
  // KIT_LAYER_GROUP_PRESETS below as a literal template. Kept as an
  // exported function rather than deleted after first use since this is
  // an expected recurring request, not a one-off.
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Kit "Preset layers": capture ANY layer literally (not just text) and
  // recreate it as the SAME layer type, the way AE's native Animation
  // Presets work -- the difference being the panel's video previews.
  //
  // Reuses the generic recursive capture/apply (captureStyleNode /
  // applyStyleChildren) for every property tree: effects, text animators,
  // transform, shape Contents, masks, layer styles, material options,
  // time remap. captureLayerStyleParts / applyStylePresetToLayer are
  // NOT touched -- those stay text-only for the Captions Style Presets.
  // ---------------------------------------------------------------

  function kitLayerType(layer) {
    try { if (layer instanceof TextLayer) { return "text"; } } catch (e1) {}
    try { if (layer instanceof CameraLayer) { return "camera"; } } catch (e2) {}
    try { if (layer instanceof LightLayer) { return "light"; } } catch (e3) {}
    try { if (layer.nullLayer) { return "null"; } } catch (e4) {}
    if (isShapeLayer(layer)) { return "shape"; }
    try { if (layer.adjustmentLayer) { return "adjustment"; } } catch (e5) {}
    try {
      var src = layer.source;
      if (src && src.mainSource && src.mainSource.color && src.mainSource.color.length === 3) {
        return "solid";
      }
    } catch (e6) {}
    return "av"; // footage / precomp
  }

  // Packs (Kit tab) must rebuild in ANY project, on any machine, without
  // linking back to the original media -- so every footage source a
  // captured layer uses is described here and later COPIED into the
  // pack's own folder by the panel (copyKitPackAssets in panel.js).
  //
  // kind "file"        plain file (image, video, audio, SVG, AI, merged
  //                    PSD...). `sequence:true` = image sequence: the
  //                    panel copies every frame, the host imports with
  //                    ImportOptions.sequence.
  //                    `bake:true` = one LAYER of a layered PSD/AI
  //                    (imported "as composition"): re-importing the file
  //                    would only give the merged image, so the panel asks
  //                    kitBakeFootageItem to save exactly that item as a
  //                    PNG instead.
  // kind "placeholder" AE placeholder, or footage whose file is missing on
  //                    disk: rebuilt as a placeholder of the same size/
  //                    length so the layer (and its animation) survive.
  // Interpretation (alpha, conformed fps, loop...) rides along in `interp`.
  var KIT_IMAGE_SEQ_EXT = /\.(png|jpe?g|tiff?|tga|exr|dpx|bmp|sgi|rgb|hdr|cin|psd|iff|pic|webp)$/i;
  var KIT_LAYERED_EXT = /\.(psd|psb|ai|pdf|eps)$/i;

  function kitFootageInterp(ms) {
    var interp = {};
    try { interp.alphaMode = ms.alphaMode; } catch (e1) {}
    try { interp.invertAlpha = ms.invertAlpha; } catch (e2) {}
    try { interp.premulColor = ms.premulColor; } catch (e3) {}
    try { interp.conformFrameRate = ms.conformFrameRate; } catch (e4) {}
    try { interp.loop = ms.loop; } catch (e5) {}
    try { interp.fieldSeparationType = ms.fieldSeparationType; } catch (e6) {}
    try { interp.removePulldown = ms.removePulldown; } catch (e7) {}
    return interp;
  }

  function kitAvSourceInfo(layer) {
    try {
      var src = layer.source;
      if (!src || !(src instanceof FootageItem)) {
        return null;
      }
      var ms = src.mainSource;
      var info = {
        kind: "file",
        name: src.name,
        itemId: src.id,
        width: src.width,
        height: src.height,
        pixelAspect: src.pixelAspect,
        duration: src.duration,
        frameRate: src.frameRate,
        isStill: !!(ms && ms.isStill),
        hasVideo: !!src.hasVideo,
        hasAudio: !!src.hasAudio,
        interp: ms ? kitFootageInterp(ms) : {}
      };
      var file = null;
      try { file = ms ? ms.file : null; } catch (fileError) { file = null; }
      if (!file) {
        info.kind = "placeholder";
        return info;
      }
      info.originalPath = file.fsName;
      var missing = false;
      try { missing = src.footageMissing || !file.exists; } catch (missingError) { missing = !file.exists; }
      if (missing) {
        info.kind = "placeholder";
        info.missing = true;
        return info;
      }
      var fileName = File.decode(file.name);
      if (KIT_LAYERED_EXT.test(fileName) && src.name !== fileName) {
        // "Layer name/File.psd" -- one layer of a layered import.
        info.bake = true;
      } else if (!info.isStill && KIT_IMAGE_SEQ_EXT.test(fileName)) {
        info.sequence = true;
      }
      return info;
    } catch (avInfoError) {}
    return null;
  }

  // Set by applyKitPackFile while a pack is being applied: everything the
  // apply imports or builds (footage, rebuilt precomps) lands in this
  // Project panel folder instead of cluttering the project root.
  var kitApplyFolder = null;

  function kitPutInFolder(item) {
    if (kitApplyFolder && item) {
      try { item.parentFolder = kitApplyFolder; } catch (folderError) {}
    }
  }

  function kitApplyInterp(item, interp) {
    if (!item || !interp) { return; }
    var ms = item.mainSource;
    if (!ms) { return; }
    if (interp.alphaMode !== undefined) { try { ms.alphaMode = interp.alphaMode; } catch (e1) {} }
    if (interp.invertAlpha !== undefined) { try { ms.invertAlpha = interp.invertAlpha; } catch (e2) {} }
    if (interp.premulColor) { try { ms.premulColor = interp.premulColor; } catch (e3) {} }
    if (interp.conformFrameRate) { try { ms.conformFrameRate = interp.conformFrameRate; } catch (e4) {} }
    if (interp.loop !== undefined) { try { ms.loop = interp.loop; } catch (e5) {} }
    if (interp.fieldSeparationType !== undefined) { try { ms.fieldSeparationType = interp.fieldSeparationType; } catch (e6) {} }
    if (interp.removePulldown !== undefined) { try { ms.removePulldown = interp.removePulldown; } catch (e7) {} }
  }

  function kitImportPlaceholder(av) {
    try {
      var item = app.project.importPlaceholder(
        String(av.name || "Missing footage"),
        Math.max(4, Math.round(numberOr(av.width, 1920))),
        Math.max(4, Math.round(numberOr(av.height, 1080))),
        numberOr(av.frameRate, 0) > 0 ? av.frameRate : 24,
        Math.max(numberOr(av.duration, 0), 1 / 24)
      );
      kitPutInFolder(item);
      return item;
    } catch (placeholderError) {
      return null;
    }
  }

  // On apply: reuse a footage item already imported from the same file
  // (same sequence-ness), otherwise import it (with the captured
  // interpretation). Accepts the avSource itself or, for older callers, a
  // bare path. A file that can't be found becomes a placeholder of the
  // same size/length rather than silently dropping the layer.
  // file path|isStill -> FootageItem already in the project. Built once per
  // pack apply (applyKitPackFile resets it) instead of scanning every
  // project item for every media layer -- real projects have thousands.
  var kitFootageIndex = null;

  function kitFootageIndexGet() {
    if (kitFootageIndex) {
      return kitFootageIndex;
    }
    kitFootageIndex = {};
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var it = app.project.item(i);
      try {
        if (it instanceof FootageItem && it.mainSource && it.mainSource.file) {
          var key = it.mainSource.file.fsName + "|" + (it.mainSource.isStill ? "1" : "0");
          if (!kitFootageIndex.hasOwnProperty(key)) {
            kitFootageIndex[key] = it;
          }
        }
      } catch (indexError) {}
    }
    return kitFootageIndex;
  }

  function kitImportOrReuseFootage(avOrPath) {
    var av = typeof avOrPath === "string" ? { kind: "file", absPath: avOrPath } : (avOrPath || {});
    if (av.kind === "placeholder") {
      return kitImportPlaceholder(av);
    }
    var path = av.absPath || av.originalPath;
    var file = path ? new File(path) : null;
    if (!file || !file.exists) {
      return av.width ? kitImportPlaceholder(av) : null;
    }
    var key = file.fsName + "|" + (av.isStill ? "1" : "0");
    var index = kitFootageIndexGet();
    if (index.hasOwnProperty(key)) {
      try {
        if (index[key].mainSource) { return index[key]; } // still alive
      } catch (staleError) {}
    }
    try {
      var io = new ImportOptions(file);
      if (av.sequence) {
        try { io.sequence = true; } catch (seqError) {}
      }
      var imported = app.project.importFile(io);
      kitApplyInterp(imported, av.interp);
      kitPutInFolder(imported);
      index[key] = imported;
      return imported;
    } catch (importError) {
      return av.width ? kitImportPlaceholder(av) : null;
    }
  }

  // Saves ONE footage item (a layer of a layered PSD/AI) as a PNG at its
  // own size, alpha kept -- see `bake` in kitAvSourceInfo. Done through a
  // throwaway comp + CompItem.saveFrameToPng.
  function kitBakeFootageItem(itemId, destPath) {
    var item = null;
    try { item = app.project.itemByID(Number(itemId)); } catch (byIdError) { item = null; }
    if (!item) {
      for (var i = 1; i <= app.project.numItems; i += 1) {
        if (app.project.item(i).id === Number(itemId)) { item = app.project.item(i); break; }
      }
    }
    if (!item) {
      return stringify({ ok: false, error: "Footage item not found." });
    }
    var tmp = null;
    app.beginUndoGroup("Mótion Film: Pack bake");
    try {
      tmp = app.project.items.addComp("Mótion Film Pack Bake", Math.max(4, item.width), Math.max(4, item.height), item.pixelAspect || 1, 1, 24);
      tmp.layers.add(item);
      tmp.saveFrameToPng(0, new File(destPath));
    } catch (bakeError) {
      try { if (tmp) { tmp.remove(); } } catch (e) {}
      app.endUndoGroup();
      return stringify({ ok: false, error: String(bakeError) });
    }
    try { tmp.remove(); } catch (removeError) {}
    app.endUndoGroup();
    return stringify({ ok: new File(destPath).exists });
  }

  // Layer-level flags worth carrying. Enums (blendingMode, quality,
  // autoOrient, ...) are round-tripped by raw value -- AE's enum members
  // are integers under the hood and the setters accept them back.
  var KIT_LAYER_BOOL_FLAGS = [
    "guideLayer", "motionBlur", "preserveTransparency",
    "collapseTransformation", "shy", "enabled", "audioEnabled", "effectsActive"
  ];

  function captureKitLayerFlags(layer) {
    var flags = {};
    try { flags.threeDLayer = layer.threeDLayer; } catch (e0) {}
    for (var i = 0; i < KIT_LAYER_BOOL_FLAGS.length; i += 1) {
      try { flags[KIT_LAYER_BOOL_FLAGS[i]] = layer[KIT_LAYER_BOOL_FLAGS[i]]; } catch (eb) {}
    }
    try { flags.blendingMode = layer.blendingMode; } catch (e1) {}
    try { flags.quality = layer.quality; } catch (e2) {}
    try { flags.frameBlendingType = layer.frameBlendingType; } catch (e3) {}
    try { flags.autoOrient = layer.autoOrient; } catch (e4) {}
    try { flags.samplingQuality = layer.samplingQuality; } catch (e5) {}
    try { flags.trackMatteType = layer.trackMatteType; } catch (e6) {}
    return flags;
  }

  function applyKitLayerFlags(layer, flags) {
    if (!flags) { return; }
    if (flags.threeDLayer !== undefined) { try { layer.threeDLayer = flags.threeDLayer; } catch (e0) {} }
    for (var i = 0; i < KIT_LAYER_BOOL_FLAGS.length; i += 1) {
      var k = KIT_LAYER_BOOL_FLAGS[i];
      if (flags[k] !== undefined) { try { layer[k] = flags[k]; } catch (eb) {} }
    }
    if (flags.blendingMode !== undefined) { try { layer.blendingMode = flags.blendingMode; } catch (e1) {} }
    if (flags.quality !== undefined) { try { layer.quality = flags.quality; } catch (e2) {} }
    if (flags.frameBlendingType !== undefined) { try { layer.frameBlendingType = flags.frameBlendingType; } catch (e3) {} }
    if (flags.autoOrient !== undefined) { try { layer.autoOrient = flags.autoOrient; } catch (e4) {} }
    if (flags.samplingQuality !== undefined) { try { layer.samplingQuality = flags.samplingQuality; } catch (e5) {} }
    // trackMatteType + parent are applied in a 2nd pass by
    // applyKitLayerGroupList, once every layer in the group exists.
  }

  // captureStyleNode on a group returns { children: [...] }; this pulls
  // just that array, tolerating a missing/unreadable group.
  function captureKitGroupChildren(group) {
    try {
      if (!group) { return []; }
      var node = captureStyleNode(group);
      return node.children || [];
    } catch (groupError) {
      return [];
    }
  }

  function captureKitMasks(layer) {
    var out = [];
    try {
      var parade = layer.property("ADBE Mask Parade");
      if (!parade || !parade.numProperties) { return out; }
      for (var i = 1; i <= parade.numProperties; i += 1) {
        var entry = { tree: captureStyleNode(parade.property(i)) };
        try { entry.name = parade.property(i).name; } catch (en) {}
        try { entry.maskMode = layer.mask(i).maskMode; } catch (em) {}
        try { entry.inverted = layer.mask(i).inverted; } catch (ei) {}
        try { entry.rotoBezier = layer.mask(i).rotoBezier; } catch (er) {}
        try { entry.locked = layer.mask(i).locked; } catch (el) {}
        try { entry.color = layer.mask(i).color; } catch (ec) {}
        out.push(entry);
      }
    } catch (masksError) {}
    return out;
  }

  function applyKitMasks(newLayer, masks, timeOffset) {
    if (!masks || !masks.length) { return; }
    var parade;
    try { parade = newLayer.property("ADBE Mask Parade"); } catch (paradeError) { return; }
    for (var i = 0; i < masks.length; i += 1) {
      try {
        var newMask = parade.addProperty("ADBE Mask Atom");
        if (masks[i].name) { try { newMask.name = masks[i].name; } catch (nameError) {} }
        if (masks[i].tree && masks[i].tree.children) {
          applyStyleChildren(newMask, masks[i].tree.children, timeOffset);
        }
        var maskObj = layer_maskAt(newLayer, parade.numProperties);
        if (maskObj) {
          if (masks[i].maskMode !== undefined) { try { maskObj.maskMode = masks[i].maskMode; } catch (em) {} }
          if (masks[i].inverted !== undefined) { try { maskObj.inverted = masks[i].inverted; } catch (ei) {} }
          if (masks[i].rotoBezier !== undefined) { try { maskObj.rotoBezier = masks[i].rotoBezier; } catch (er) {} }
          if (masks[i].locked !== undefined) { try { maskObj.locked = masks[i].locked; } catch (el) {} }
          if (masks[i].color !== undefined) { try { maskObj.color = masks[i].color; } catch (ec) {} }
        }
      } catch (oneMaskError) {}
    }
  }

  function layer_maskAt(layer, index) {
    try { return layer.mask(index); } catch (e) { return null; }
  }

  // Everything needed to recreate a layer of ANY type from scratch.
  // Backward compatible with older text-only templates: those have no
  // `layerType` and are treated as "text".
  function captureSingleLayerTemplate(layer, depth) {
    var type = kitLayerType(layer);
    var template = {
      layerType: type,
      name: layer.name,
      text: "",
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
      is3D: !!layer.threeDLayer,
      flags: captureKitLayerFlags(layer),
      transform: captureKitGroupChildren(safeProp(layer, "ADBE Transform Group")),
      effects: captureKitGroupChildren(safeProp(layer, "ADBE Effect Parade")),
      masks: captureKitMasks(layer),
      layerStyles: captureKitGroupChildren(safeProp(layer, "ADBE Layer Styles"))
    };
    try { template.stretch = layer.stretch; } catch (eStretch) {}

    if (type === "text") {
      try {
        template.text = layer.property("ADBE Text Properties").property("ADBE Text Document").value.text;
      } catch (textError) {
        template.text = "";
      }
      template.textStyle = captureTextDocumentStyle(layer);
      template.textAnimators = captureKitGroupChildren(
        safeProp(safeProp(layer, "ADBE Text Properties"), "ADBE Text Animators"));
    } else if (type === "solid" || type === "adjustment") {
      try {
        template.solidColor = layer.source.mainSource.color;
        template.sourceWidth = layer.source.width;
        template.sourceHeight = layer.source.height;
        template.pixelAspect = layer.source.pixelAspect;
      } catch (solidError) {}
    } else if (type === "camera") {
      template.cameraOptions = captureKitGroupChildren(safeProp(layer, "ADBE Camera Options Group"));
    } else if (type === "light") {
      try { template.lightType = layer.lightType; } catch (ltError) {}
      template.lightOptions = captureKitGroupChildren(safeProp(layer, "ADBE Light Options Group"));
    } else if (type === "av") {
      // Footage backed by a real file (SVG, image, video, audio): the
      // source itself can't live in a JSON, but the file is copyable --
      // the panel copies it next to the preset's preview and fills in
      // `assetFile`. A precomp source gets deep-captured recursively
      // (its own layers, each through this same function) so the whole
      // sub-composition rebuilds on apply, not just a same-project
      // reference. Anything else (missing/unreadable source) stays
      // unsupported and gets skipped by buildKitLayerTemplates.
      try {
        if (layer.source instanceof CompItem) {
          template.avSource = captureKitCompFull(layer.source, numberOr(depth, 0) + 1);
        } else {
          template.avSource = kitAvSourceInfo(layer);
        }
      } catch (avSrcError) {
        template.avSource = kitAvSourceInfo(layer);
      }
    }

    if (type === "shape") {
      template.contents = captureKitGroupChildren(safeProp(layer, "ADBE Root Vectors Group"));
    }
    if (template.is3D) {
      template.materialOptions = captureKitGroupChildren(safeProp(layer, "ADBE Material Options Group"));
      template.geometryOptions = captureKitGroupChildren(safeProp(layer, "ADBE Geometry Options Group"));
    }
    try {
      if (layer.timeRemapEnabled) {
        template.timeRemap = captureStyleNode(layer.property("ADBE Time Remapping"));
      }
    } catch (trError) {}

    // Backward-compat envelope so any old reader of `template.preset`
    // still finds effects/transform/textStyle where it expects them.
    template.preset = {
      layerInPoint: layer.inPoint,
      effects: template.effects,
      textAnimators: template.textAnimators || [],
      transform: template.transform,
      textStyle: template.textStyle || null
    };
    return template;
  }

  function safeProp(holder, matchName) {
    try {
      return holder ? holder.property(matchName) : null;
    } catch (e) {
      return null;
    }
  }

  // Dev/capture-only entry point -- not called from the panel UI. Given
  // a JSON array of layer names, finds each in the ACTIVE composition
  // and returns their full templates plus each one's `offset` (time
  // relative to the earliest layer's inPoint, so re-inserting later
  // preserves however the layers were staggered against each other) and
  // `duration` (outPoint - inPoint, so a freshly created layer gets the
  // same length instead of whatever the project's default new-layer
  // duration happens to be).
  // Shared by every "capture a layer group" entry point below --
  // computes each layer's `offset` (time relative to the EARLIEST
  // layer's inPoint, so re-inserting later preserves however they were
  // staggered against each other) and `duration` (outPoint - inPoint,
  // so a freshly created layer gets the same length instead of
  // whatever the project's default new-layer duration happens to be).
  // keepAbsoluteTime: false (default) normalizes offsets to the
  // earliest selected layer's inPoint -- right for a top-level "Preset
  // layers" capture, meant to be pasted back in as a staggered group at
  // the playhead. true keeps each layer's offset relative to comp time
  // 0 instead -- right when capturing every layer of a PRECOMP being
  // rebuilt (captureKitCompFull below), where positions must stay
  // exactly where they were in that comp's own timeline.
  function buildKitLayerTemplates(layers, keepAbsoluteTime, depth) {
    var templates = [];
    var keptLayers = [];
    var minInPoint = null;
    for (var i = 0; i < layers.length; i += 1) {
      var template = captureSingleLayerTemplate(layers[i], depth);
      if (template.layerType === "av" && !template.avSource) {
        // Unreadable/unsupported source (or a precomp nested past
        // KIT_MAX_COMP_DEPTH) -- can't be rebuilt from JSON. Skipped.
        continue;
      }
      if (!keepAbsoluteTime && (minInPoint === null || template.inPoint < minInPoint)) {
        minInPoint = template.inPoint;
      }
      templates.push(template);
      keptLayers.push(layers[i]);
    }
    if (keepAbsoluteTime) {
      minInPoint = 0;
    }
    for (var j = 0; j < templates.length; j += 1) {
      templates[j].offset = templates[j].inPoint - minInPoint;
      templates[j].duration = templates[j].outPoint - templates[j].inPoint;
      // Reparent target as an index into THIS captured group (or -1 if
      // the layer's parent wasn't part of the selection).
      templates[j].parentTemplateIndex = -1;
      try {
        var par = keptLayers[j].parent;
        if (par) {
          for (var q = 0; q < keptLayers.length; q += 1) {
            if (keptLayers[q].index === par.index) {
              templates[j].parentTemplateIndex = q;
              break;
            }
          }
        }
      } catch (parentError) {}
      // Which captured layer is this one's track matte (AE 2023+ lets
      // any layer be the matte, not just the one directly above).
      templates[j].trackMatteTemplateIndex = -1;
      try {
        var matteLayer = keptLayers[j].trackMatteLayer;
        if (matteLayer) {
          for (var m = 0; m < keptLayers.length; m += 1) {
            if (keptLayers[m].index === matteLayer.index) {
              templates[j].trackMatteTemplateIndex = m;
              break;
            }
          }
        }
      } catch (matteError) {}
    }
    return templates;
  }

  // A precomp is disallowed by AE from containing itself (directly or
  // via an ancestor), so real projects can't recurse forever -- this
  // cap just guards against a pathologically deep nesting chain
  // producing a runaway JSON blob. Past it, the layer is captured same
  // as any other unreadable source: skipped by buildKitLayerTemplates.
  var KIT_MAX_COMP_DEPTH = 8;

  // Deep-captures a precomp so a "Preset layers" template can rebuild it
  // from scratch: every one of its own layers, recursively (a precomp
  // inside a precomp works the same way, up to KIT_MAX_COMP_DEPTH).
  function captureKitCompFull(compItem, depth) {
    if (!compItem || numberOr(depth, 0) > KIT_MAX_COMP_DEPTH) {
      return null;
    }
    var layers = [];
    try {
      for (var i = 1; i <= compItem.numLayers; i += 1) {
        layers.push(compItem.layer(i));
      }
    } catch (layersError) {
      return null;
    }
    var childTemplates = buildKitLayerTemplates(layers, true, depth);
    var avSource = {
      kind: "comp",
      compName: compItem.name,
      width: compItem.width,
      height: compItem.height,
      pixelAspect: compItem.pixelAspect,
      frameRate: compItem.frameRate,
      duration: compItem.duration,
      layers: childTemplates
    };
    try { avSource.bgColor = compItem.bgColor; } catch (bgError) {}
    var compFlags = {};
    try { compFlags.motionBlur = compItem.motionBlur; } catch (f1) {}
    try { compFlags.frameBlending = compItem.frameBlending; } catch (f2) {}
    try { compFlags.shutterAngle = compItem.shutterAngle; } catch (f3) {}
    try { compFlags.shutterPhase = compItem.shutterPhase; } catch (f4) {}
    try { compFlags.renderer = compItem.renderer; } catch (f5) {}
    try { compFlags.displayStartTime = compItem.displayStartTime; } catch (f6) {}
    try { compFlags.workAreaStart = compItem.workAreaStart; compFlags.workAreaDuration = compItem.workAreaDuration; } catch (f7) {}
    avSource.compFlags = compFlags;
    return avSource;
  }

  function captureKitLayerGroupFromNames(namesJson) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "No active composition." });
    }
    var names = parse(namesJson);
    if (!names || !names.length) {
      return stringify({ ok: false, error: "No layer names given." });
    }
    var found = [];
    for (var i = 0; i < names.length; i += 1) {
      var match = null;
      for (var L = 1; L <= comp.numLayers; L += 1) {
        if (comp.layer(L).name === names[i]) {
          match = comp.layer(L);
          break;
        }
      }
      if (!match) {
        return stringify({ ok: false, error: "Layer not found in active comp: " + names[i] });
      }
      found.push(match);
    }
    return stringify({ ok: true, layers: buildKitLayerTemplates(found), compWidth: comp.width, compHeight: comp.height, compFrameRate: comp.frameRate });
  }

  // Kit tab footer, "Preset layers" button: same capture as above, but
  // from whatever's currently SELECTED rather than looked up by name --
  // this is the one actually wired to the panel UI; captureKitLayerGroupFromNames
  // stays around for capturing a curated preset by hand (see
  // KIT_LAYER_GROUP_PRESETS below). compWidth/compHeight/compFrameRate
  // ride along so renderKitPreviewClip (below) can rebuild an
  // accurately-sized temp comp later -- captured layer Position/Scale
  // etc. are absolute pixel values in THIS comp's coordinate space, so
  // recreating them in a differently-sized comp would land wrong.
  function captureKitLayerGroupFromSelection() {
    return stringify(captureKitSelectionData());
  }

  function captureKitSelectionData() {
    var layers = selectedLayers();
    // comp.selectedLayers comes back in SELECTION order -- whichever
    // layer was clicked/shift-clicked first -- NOT stacking order.
    // Confirmed live: selecting the bottom layer before the top one
    // returns [bottom, top]. Capturing in click order silently inverted
    // the whole group whenever a selection happened to start from the
    // bottom, which also breaks track matte pairing below (its 2nd pass
    // assumes layersList[j-1] is the layer directly ABOVE layersList[j]
    // in real stacking order). Always normalize to actual stacking
    // order (top to bottom, ascending layer.index) before building
    // templates, regardless of how the layers were selected.
    if (!layers.length) {
      return { ok: false, error: "Select at least one layer first." };
    }
    // Only the selection is saved -- plus what a selected layer can't
    // work without: its parent chain (a child's Position/Scale/Rotation
    // live in its parent's space, and it follows the parent's animation)
    // and its track matte. Leaving those out would land the layer in the
    // wrong place / lose its cut-out. They ride along and are reported.
    var picked = {};
    var all = [];
    var selectedCount = layers.length;
    function addLayer(layer) {
      if (layer && !picked[layer.index]) {
        picked[layer.index] = true;
        all.push(layer);
        return true;
      }
      return false;
    }
    for (var s = 0; s < layers.length; s += 1) {
      addLayer(layers[s]);
    }
    var dependencies = 0;
    for (var d = 0; d < all.length; d += 1) {
      var dep = null;
      try { dep = all[d].parent; } catch (parentError) { dep = null; }
      if (dep && addLayer(dep)) { dependencies += 1; }
      var matteDep = null;
      try { matteDep = all[d].trackMatteLayer; } catch (matteError) { matteDep = null; }
      if (matteDep && addLayer(matteDep)) { dependencies += 1; }
    }
    layers = all.sort(function (a, b) { return a.index - b.index; });
    var comp = activeComp();
    var templates = buildKitLayerTemplates(layers);
    if (!templates.length) {
      return { ok: false, error: "Nothing to save -- couldn't read any of the selected layers." };
    }
    return {
      ok: true,
      layers: templates,
      avSkipped: layers.length - templates.length,
      dependencies: dependencies,
      selectedCount: selectedCount,
      firstName: layers[0].name,
      compName: comp.name,
      compWidth: comp.width,
      compHeight: comp.height,
      compPixelAspect: comp.pixelAspect,
      compFrameRate: comp.frameRate,
      compBgColor: comp.bgColor,
      compMotionBlur: comp.motionBlur,
      compShutterAngle: comp.shutterAngle,
      compShutterPhase: comp.shutterPhase,
      compRenderer: comp.renderer
    };
  }

  // Baked-in templates, one per preset id -- captured live via
  // captureKitLayerGroupFromNames and pasted in by hand (see the
  // changelog for which real layers/composition each one came from).
  // Empty for now: "text-duo-intro" was a test preset, removed at the
  // user's request now that real curated presets get saved directly
  // through the panel's own "Preset layers"/"Preset comp" footer
  // buttons instead of being hand-authored here.
  var KIT_LAYER_GROUP_PRESETS = {};

  // Undo groups for the Kit/Pack code. NEVER nest app.beginUndoGroup:
  // confirmed live on AE 26.5 that a group opened inside another makes
  // the next Undo -- or the user's next drag in the timeline -- pop
  // "Undo group mismatch, will attempt to fix", and AE crashed right
  // after (applying a comp pack = group inside group; so did previews of
  // packs with precomps). Only the outermost begin/end reach AE.
  var kitUndoDepth = 0;

  function kitUndoBegin(label) {
    if (kitUndoDepth === 0) {
      app.beginUndoGroup(label);
    }
    kitUndoDepth += 1;
  }

  function kitUndoEnd() {
    if (kitUndoDepth <= 0) {
      kitUndoDepth = 0;
      return;
    }
    kitUndoDepth -= 1;
    if (kitUndoDepth === 0) {
      app.endUndoGroup();
    }
  }

  // Entry points call this first and last: closes a group a previous
  // call left open (an uncaught error between begin and end).
  function kitUndoCloseAll() {
    while (kitUndoDepth > 0) {
      kitUndoEnd();
    }
  }

  // Rebuilds a precomp captured by captureKitCompFull into a brand new
  // CompItem (always a fresh one -- unlike kitImportOrReuseFootage there's
  // no reliable identity to reuse a comp by, so applying the same preset
  // twice just makes two comps, same as duplicating a precomp by hand
  // would). Populates it via applyKitLayerGroupList, the same two-pass
  // create+reparent routine a top-level "Preset layers" apply uses --
  // its undo group goes through kitUndoBegin, so it never nests.
  // Returns the new CompItem, or null on failure.
  function createKitCompFromTemplate(av) {
    try {
      var w = Math.max(1, Math.round(numberOr(av.width, 1920)));
      var h = Math.max(1, Math.round(numberOr(av.height, 1080)));
      var pa = numberOr(av.pixelAspect, 1);
      var dur = Math.max(numberOr(av.duration, 1), 1 / 30);
      var fr = numberOr(av.frameRate, 24);
      var newComp = app.project.items.addComp(av.compName || "Mótion Film Preset Comp", w, h, pa, dur, fr);
      kitPutInFolder(newComp);
      try {
        if (av.bgColor && av.bgColor.length === 3) {
          newComp.bgColor = av.bgColor;
        }
      } catch (bgError) {}
      // Comp-level switches that change how the comp renders.
      if (av.compFlags) {
        var cf = av.compFlags;
        if (cf.motionBlur !== undefined) { try { newComp.motionBlur = cf.motionBlur; } catch (e1) {} }
        if (cf.frameBlending !== undefined) { try { newComp.frameBlending = cf.frameBlending; } catch (e2) {} }
        if (cf.shutterAngle !== undefined) { try { newComp.shutterAngle = cf.shutterAngle; } catch (e3) {} }
        if (cf.shutterPhase !== undefined) { try { newComp.shutterPhase = cf.shutterPhase; } catch (e4) {} }
        if (cf.renderer) { try { newComp.renderer = cf.renderer; } catch (e5) {} }
        if (cf.displayStartTime !== undefined) { try { newComp.displayStartTime = cf.displayStartTime; } catch (e6) {} }
        if (cf.workAreaStart !== undefined) { try { newComp.workAreaStart = cf.workAreaStart; newComp.workAreaDuration = cf.workAreaDuration; } catch (e7) {} }
      }
      if (av.layers && av.layers.length) {
        applyKitLayerGroupList(newComp, av.layers, "Mótion Film: Kit preset (nested comp)");
      }
      return newComp;
    } catch (compError) {
      return null;
    }
  }

  // Creates one new layer in `comp` from a template captured above,
  // recreating the SAME layer type (text/shape/solid/null/adjustment/
  // camera/light/av), landing at anchorTime + the template's own offset
  // (so several layers from the same preset keep their relative
  // stagger). Every property tree is rebuilt with the generic
  // applyStyleChildren, with keyframes re-anchored to THIS layer's
  // inPoint (timeOffset). A precomp source recurses through
  // createKitCompFromTemplate above. Returns the new layer, or null
  // (an unreadable/unsupported source is skipped).
  function createLayerFromKitTemplate(comp, template, anchorTime) {
    var type = template.layerType || "text";

    var w = comp.width;
    var h = comp.height;
    var newLayer = null;
    var textStyle = template.textStyle || (template.preset ? template.preset.textStyle : null);

    try {
      if (type === "av") {
        var av = template.avSource;
        if (!av) {
          return null;
        }
        if (av.kind === "comp") {
          var subComp = createKitCompFromTemplate(av);
          if (!subComp) {
            return null;
          }
          newLayer = comp.layers.add(subComp);
        } else {
          if (av.kind !== "file" && av.kind !== "placeholder") {
            return null;
          }
          var footageItem = kitImportOrReuseFootage(av);
          if (!footageItem) {
            return null;
          }
          newLayer = comp.layers.add(footageItem);
        }
      } else if (type === "shape") {
        newLayer = comp.layers.addShape();
      } else if (type === "null") {
        newLayer = comp.layers.addNull();
      } else if (type === "solid" || type === "adjustment") {
        var col = (template.solidColor && template.solidColor.length === 3) ? template.solidColor : [0.5, 0.5, 0.5];
        var sw = Math.max(1, Math.round(numberOr(template.sourceWidth, w)));
        var sh = Math.max(1, Math.round(numberOr(template.sourceHeight, h)));
        newLayer = comp.layers.addSolid(col, template.name || "Solid", sw, sh, numberOr(template.pixelAspect, 1));
        if (type === "adjustment") {
          try { newLayer.adjustmentLayer = true; } catch (adjError) {}
        }
      } else if (type === "camera") {
        newLayer = comp.layers.addCamera(template.name || "Camera", [w / 2, h / 2]);
      } else if (type === "light") {
        newLayer = comp.layers.addLight(template.name || "Light", [w / 2, h / 2]);
        if (template.lightType !== undefined) {
          try { newLayer.lightType = template.lightType; } catch (ltError) {}
        }
      } else {
        newLayer = comp.layers.addText(template.text || "");
        if (textStyle) {
          try { applyTextDocumentStyle(newLayer, textStyle); } catch (tsError) {}
        }
      }
    } catch (createError) {
      return null;
    }
    if (!newLayer) {
      return null;
    }

    try { newLayer.name = template.name || newLayer.name; } catch (nameError) {}

    if (template.is3D) {
      try { newLayer.threeDLayer = true; } catch (threeDError) {}
    }

    // inPoint before outPoint (HANDOFF item 3: setting inPoint drags
    // outPoint along to preserve current duration).
    var startT = anchorTime + numberOr(template.offset, 0);
    var duration = numberOr(template.duration, 1);
    try { newLayer.startTime = startT; } catch (stError) {}
    try { newLayer.inPoint = startT; } catch (ipError) {}
    try { newLayer.outPoint = startT + duration; } catch (opError) {}
    if (template.stretch !== undefined && template.stretch !== 100) {
      try { newLayer.stretch = template.stretch; } catch (strError) {}
    }

    applyKitLayerFlags(newLayer, template.flags);

    var timeOffset = newLayer.inPoint - numberOr(template.preset ? template.preset.layerInPoint : template.inPoint, 0);

    function applyGroup(matchName, nodes) {
      if (!nodes || !nodes.length) {
        return;
      }
      try {
        var target = newLayer.property(matchName);
        if (target) {
          applyStyleChildren(target, nodes, timeOffset);
        }
      } catch (groupError) {}
    }

    applyGroup("ADBE Transform Group", template.transform || (template.preset ? template.preset.transform : null));
    applyGroup("ADBE Effect Parade", template.effects || (template.preset ? template.preset.effects : null));
    if (template.textAnimators || (template.preset && template.preset.textAnimators)) {
      try {
        var anims = newLayer.property("ADBE Text Properties").property("ADBE Text Animators");
        var animNodes = template.textAnimators || template.preset.textAnimators;
        if (anims && animNodes && animNodes.length) {
          applyStyleChildren(anims, animNodes, timeOffset);
        }
      } catch (animError) {}
    }
    if (type === "shape") {
      applyGroup("ADBE Root Vectors Group", template.contents);
    }
    if (type === "camera") {
      applyGroup("ADBE Camera Options Group", template.cameraOptions);
    }
    if (type === "light") {
      applyGroup("ADBE Light Options Group", template.lightOptions);
    }
    applyKitMasks(newLayer, template.masks, timeOffset);
    applyGroup("ADBE Layer Styles", template.layerStyles);
    applyGroup("ADBE Material Options Group", template.materialOptions);
    applyGroup("ADBE Geometry Options Group", template.geometryOptions);
    if (template.timeRemap) {
      try {
        newLayer.timeRemapEnabled = true;
        applyStyleLeaf(newLayer.property("ADBE Time Remapping"), template.timeRemap, timeOffset);
      } catch (trError) {}
    }
    return newLayer;
  }

  // Shared by applyKitLayerGroupPreset (curated, looked up by id) and
  // applyKitLayerGroupData (user-saved via the Kit footer's "Preset
  // layers" button, sent straight from the panel since those live in
  // the panel's own localStorage, not in this file).
  function applyKitLayerGroupList(comp, layersList, undoLabel) {
    var anchorTime = comp.time;
    var applied = 0;
    var skipped = 0;
    var created = [];
    for (var c = 0; c < layersList.length; c += 1) {
      created.push(null);
    }
    kitUndoBegin(undoLabel);
    try {
      // Create in REVERSE so the first template ends up topmost (each
      // addX() inserts at the top), preserving the captured stacking
      // order -- which matters for track mattes and just reads right.
      for (var i = layersList.length - 1; i >= 0; i -= 1) {
        var made = createLayerFromKitTemplate(comp, layersList[i], anchorTime);
        if (made) {
          created[i] = made;
          applied += 1;
        } else {
          skipped += 1;
        }
      }
      // 2nd pass: reparent within the group + track mattes, now that
      // every layer exists.
      for (var j = 0; j < layersList.length; j += 1) {
        if (!created[j]) {
          continue;
        }
        var pIdx = layersList[j].parentTemplateIndex;
        if (typeof pIdx === "number" && pIdx >= 0 && pIdx !== j && created[pIdx]) {
          // WITH jump: the captured transform is already relative to the
          // parent, so it must be kept as-is. Plain `.parent =` keeps the
          // WORLD position instead and rewrote the child's values --
          // every child of a moved/scaled/rotated Null landed elsewhere
          // (confirmed live: text at -2093,-390 instead of 100,50).
          try {
            created[j].setParentWithJump(created[pIdx]);
          } catch (jumpError) {
            try { created[j].parent = created[pIdx]; } catch (parentError) {}
          }
        }
        var tmt = layersList[j].flags ? layersList[j].flags.trackMatteType : undefined;
        var tmIdx = layersList[j].trackMatteTemplateIndex;
        if (tmt !== undefined && tmt !== TrackMatteType.NO_TRACK_MATTE &&
            typeof tmIdx === "number" && tmIdx >= 0 && tmIdx !== j && created[tmIdx] &&
            typeof created[j].setTrackMatte === "function") {
          try { created[j].setTrackMatte(created[tmIdx], tmt); } catch (setMatteError) {}
        } else if (tmt !== undefined && j > 0 && created[j - 1]) {
          // Older templates (no matte index): matte = the layer above.
          try { created[j].trackMatteType = tmt; } catch (matteError) {}
        }
      }
    } catch (error) {
      kitUndoEnd();
      return { ok: false, error: String(error) };
    }
    kitUndoEnd();
    if (!applied) {
      return { ok: false, error: "Could not insert this preset." };
    }
    return { ok: true, applied: applied, skipped: skipped };
  }

  function applyKitLayerGroupPreset(id) {
    var presetDef = KIT_LAYER_GROUP_PRESETS[id];
    if (!presetDef) {
      return stringify({ ok: false, error: "Unknown preset." });
    }
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open/select a composition first." });
    }
    return stringify(applyKitLayerGroupList(comp, presetDef.layers, "Mótion Film: Kit preset " + id));
  }

  // Kit tab footer, applying a user-saved "Preset layers" preset -- the
  // panel sends the captured template array straight from localStorage
  // (see captureKitLayerGroupFromSelection above for how it was made).
  function applyKitLayerGroupData(dataJson) {
    var parsed = parse(dataJson);
    // Two shapes land here: a plain array (presets saved before
    // compWidth/compHeight/compFrameRate were added alongside the
    // layers, kept working rather than silently breaking) or
    // { layers, compWidth, ... } (current shape -- the extra fields
    // are only used by renderKitPreviewClip, not by applying onto a
    // real, already-existing target comp here).
    var layersList = parsed && parsed.layers ? parsed.layers : parsed;
    if (!layersList || !layersList.length) {
      return stringify({ ok: false, error: "Empty preset." });
    }
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open/select a composition first." });
    }
    return stringify(applyKitLayerGroupList(comp, layersList, "Mótion Film: Kit preset (layers)"));
  }

  // Kit tab footer, "Preset comp" button: unlike layer-group presets,
  // this doesn't deep-capture a property tree -- it just remembers the
  // ACTIVE composition's name. A composition is a project-level asset
  // (references footage on disk, other comps, etc.) that can't be
  // rebuilt from a plain JSON template the way a text layer's effects
  // can, so this only ever works back in the SAME project it was saved
  // from -- applyKitCompData looks the name up in app.project and adds
  // it as a layer, the same as dragging it from the Project panel would.
  function captureKitCompReference() {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Open/select a composition first." });
    }
    return stringify({ ok: true, compName: comp.name });
  }

  function applyKitCompData(compName) {
    var targetComp = activeComp();
    if (!targetComp) {
      return stringify({ ok: false, error: "Open/select a composition first." });
    }
    var sourceItem = null;
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === compName) {
        sourceItem = it;
        break;
      }
    }
    if (!sourceItem) {
      return stringify({ ok: false, error: "“" + compName + "” isn't in this project -- comp presets only work back in the project they were saved from." });
    }
    var anchorTime = targetComp.time;
    var newLayer = null;
    app.beginUndoGroup("Mótion Film: Kit preset (comp)");
    try {
      newLayer = targetComp.layers.add(sourceItem);
      newLayer.startTime = anchorTime;
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    if (!newLayer) {
      return stringify({ ok: false, error: "Could not insert this composition." });
    }
    return stringify({ ok: true, applied: 1 });
  }

  // ---------------------------------------------------------------
  // Kit tab: rendering a REAL preview clip for a preset, instead of the
  // CSS-animation placeholder every tile falls back to when no preview
  // media exists (see client/assets/kit-previews/README.md).
  //
  // Confirmed live before writing this: this AE install's "H.264 -
  // Match Render Settings" Output Module template produces an .mp4 the
  // panel's own Chromium plays back natively (loadeddata/canplay/play()
  // all fire clean, real pixel data confirmed via canvas) -- no need
  // for the ffmpeg/.webm detour the rest of this file uses for
  // Captions (that ffmpeg build's own H.264 encoder is the one that
  // doesn't play back reliably, per the documented lesson; AE's own
  // encoder is a different, standards-conformant one and isn't
  // affected). The poster frame doesn't need AE or ffmpeg either -- the
  // panel grabs it client-side from the rendered clip via
  // <canvas>.drawImage(video,...).toDataURL(), already proven to read
  // real (non-black) pixel data from a real <video>. Net result: this
  // whole preview pipeline has zero external dependencies.
  //
  // The exact output template name ("H.264 - Match Render Settings -
  // 5 Mbps") is specific to this AE install/version/locale and isn't
  // guaranteed to exist verbatim on someone else's -- pickH264OutputTemplate
  // searches om.templates for one that looks like H.264 instead of
  // hardcoding the string, so this still works if the exact wording
  // differs elsewhere.
  // ---------------------------------------------------------------

  // Preview clips are a small UI thumbnail, not a deliverable -- capped
  // well under what even a slow/complex preset would naturally run, so
  // rendering stays fast and the file stays small no matter how long
  // the real animation/composition actually is.
  var KIT_PREVIEW_MAX_DURATION = 2.5;

  // Walks a captured layer template (transform / effects / animators /
  // masks / camera / light node trees) collecting every keyframe time.
  // Times are ABSOLUTE comp time, as captured (captureStyleNode reads
  // prop.keyTime()). Used to aim the preview render window at where the
  // motion actually is, instead of always the first frames -- selected
  // layers often exist from time 0 but their keyframed animation starts
  // seconds later. Nested precomp layers are deliberately skipped: their
  // keyframe times are in the SUBCOMP's time base, not this one.
  function collectKitTemplateKeyTimes(template, out) {
    function walkNodes(nodes) {
      if (!nodes || !nodes.length) {
        return;
      }
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (!node) {
          continue;
        }
        if (node.keyframes && node.keyframes.length) {
          for (var k = 0; k < node.keyframes.length; k += 1) {
            var t = node.keyframes[k] ? node.keyframes[k].time : null;
            if (typeof t === "number" && !isNaN(t)) {
              out.push(t);
            }
          }
        }
        if (node.children && node.children.length) {
          walkNodes(node.children);
        }
      }
    }
    walkNodes(template.transform);
    walkNodes(template.effects);
    walkNodes(template.textAnimators);
    walkNodes(template.layerStyles);
    walkNodes(template.cameraOptions);
    walkNodes(template.lightOptions);
    if (template.masks) {
      for (var m = 0; m < template.masks.length; m += 1) {
        if (template.masks[m] && template.masks[m].tree) {
          walkNodes(template.masks[m].tree.children);
        }
      }
    }
  }

  function pickH264OutputTemplate(om) {
    var templates = [];
    try {
      templates = om.templates || [];
    } catch (templatesError) {
      templates = [];
    }
    var fallback = null;
    for (var i = 0; i < templates.length; i += 1) {
      if (/h\.?264/i.test(templates[i])) {
        if (/5\s*mbps/i.test(templates[i])) {
          return templates[i];
        }
        if (!fallback) {
          fallback = templates[i];
        }
      }
    }
    return fallback;
  }

  // kind "layers": dataJson is { layers, compWidth, compHeight,
  // compFrameRate } (see captureKitLayerGroupFromSelection) -- builds a
  // throwaway comp at the ORIGINAL captured size (positions/scale are
  // absolute pixel values, wrong in a differently-sized comp) sized to
  // just the natural duration of the preset, populated the exact same
  // way applyKitLayerGroupPreset does for a real insert.
  // kind "comp": dataJson is { compName } -- renders the real named
  // CompItem directly (read-only; rendering doesn't alter it), trimmed
  // to KIT_PREVIEW_MAX_DURATION via the render queue item's own
  // timeSpanStart/timeSpanDuration rather than touching the comp itself.
  function renderKitPreviewClip(kind, dataJson, outPath) {
    return renderKitPreviewData(kind, parse(dataJson), outPath);
  }

  // Previews are a small tile thumbnail: render at a reduced RESOLUTION
  // (AE renders 1/f of the pixels in each direction -- e.g. 1920x1080 at
  // [4,4] is 480x270, 16x less work) instead of full size. The long side
  // lands at or under this.
  var KIT_PREVIEW_MAX_SIDE = 480;

  function renderKitPreviewData(kind, data, outPath) {
    kitUndoCloseAll();
    kitFootageIndex = null; // fresh lookup of the project's footage (see kitFootageIndexGet)
    if (!data) {
      return stringify({ ok: false, error: "Nothing to render." });
    }

    // renderQueue.render() manages the undo stack itself; wrapping it in
    // a script beginUndoGroup/endUndoGroup leaves AE with an "Undo group
    // mismatch" it complains about on the user's NEXT edit. So: build
    // the throwaway comp + queue item inside one undo group, CLOSE it,
    // render outside any group, then remove the throwaway items in a
    // second small group.
    var tempComp = null;
    var rqItem = null;
    var sourceComp = null;
    var timeSpanStart = 0;
    var timeSpanDuration = KIT_PREVIEW_MAX_DURATION;

    // Snapshot the project's current item ids. The "layers" preview path
    // imports footage files AND (now that precomp layers deep-capture,
    // see captureKitCompFull) creates fresh CompItems to build the
    // throwaway comp (createLayerFromKitTemplate -> kitImportOrReuseFootage
    // / createKitCompFromTemplate). Once we delete that comp, anything we
    // freshly added for it is orphaned -- and AE then pops "One footage
    // file was saved as missing because it couldn't be located" on the
    // next project save if a footage source later moves. So after
    // cleanup, reap footage/comp items we added that nothing uses any
    // more. Items that already existed (kitImportOrReuseFootage *reused*
    // a footage item) are protected by this id set. The reap loop runs
    // to a fixed point (bounded by KIT_MAX_COMP_DEPTH + margin) since a
    // nested precomp's own nested precomp only becomes unused once its
    // parent comp is removed in an earlier pass.
    var preExistingItemIds = {};
    for (var pi = 1; pi <= app.project.numItems; pi += 1) {
      try { preExistingItemIds[app.project.item(pi).id] = true; } catch (piErr) {}
    }

    function cleanupPreview() {
      kitUndoBegin("Mótion Film: Render Kit preview cleanup");
      try { if (rqItem) { rqItem.remove(); } } catch (rqErr) {}
      try { if (tempComp) { tempComp.remove(); } } catch (tcErr) {}
      try {
        var changed = true;
        var guard = 0;
        while (changed && guard < KIT_MAX_COMP_DEPTH + 2) {
          changed = false;
          guard += 1;
          for (var ci = app.project.numItems; ci >= 1; ci -= 1) {
            var cit = app.project.item(ci);
            var isReapable = (cit instanceof FootageItem) || (cit instanceof CompItem);
            if (isReapable && !preExistingItemIds[cit.id]) {
              var stillUsed = false;
              try { stillUsed = cit.usedIn && cit.usedIn.length > 0; } catch (uErr) {}
              if (!stillUsed) {
                try { cit.remove(); changed = true; } catch (remErr) {}
              }
            }
          }
        }
      } catch (reapErr) {}
      kitUndoEnd();
      rqItem = null;
      tempComp = null;
    }

    // Per-stage timings, returned with the result (diagnostics: a slow
    // preview has to show WHERE the time went, not be guessed at).
    var timing = { start: new Date().getTime() };

    // --- build (undoable) ---
    kitUndoBegin("Mótion Film: Render Kit preview");
    try {
      if (kind === "layers") {
        var layers = data.layers || [];
        if (!layers.length) {
          kitUndoEnd();
          return stringify({ ok: false, error: "Nothing to render." });
        }
        var w = numberOr(data.compWidth, 1920);
        var h = numberOr(data.compHeight, 1080);
        var fr = numberOr(data.compFrameRate, 24);
        var natural = 0;
        for (var i = 0; i < layers.length; i += 1) {
          natural = Math.max(natural, numberOr(layers[i].offset, 0) + numberOr(layers[i].duration, 1));
        }
        timeSpanDuration = Math.min(KIT_PREVIEW_MAX_DURATION, natural || KIT_PREVIEW_MAX_DURATION);

        // Aim the (short) render window at where the animation actually
        // is. The selected layers are normalised so the earliest starts
        // at 0 in the throwaway comp, but they often EXIST from time 0
        // while their keyframed motion doesn't kick in until seconds
        // later -- rendering the first KIT_PREVIEW_MAX_DURATION then just
        // shows a static frame. keyframe times in the templates are
        // absolute comp time; in the throwaway comp every layer is
        // shifted by -minInPoint (createLayerFromKitTemplate's
        // timeOffset), so subtract that to get throwaway-comp time.
        var frameStep = 1 / Math.max(fr, 1);
        var minInPoint = numberOr(layers[0].inPoint, 0) - numberOr(layers[0].offset, 0);
        var keyTimes = [];
        for (var kt = 0; kt < layers.length; kt += 1) {
          collectKitTemplateKeyTimes(layers[kt], keyTimes);
        }
        if (keyTimes.length) {
          var firstKey = null;
          var lastKey = null;
          for (var kk = 0; kk < keyTimes.length; kk += 1) {
            var pt = keyTimes[kk] - minInPoint;
            if (firstKey === null || pt < firstKey) { firstKey = pt; }
            if (lastKey === null || pt > lastKey) { lastKey = pt; }
          }
          var winStart = Math.max(0, firstKey - 0.25);        // small pre-roll before the first move
          var winEnd = Math.max(winStart + frameStep, lastKey + 0.35); // small tail after the last
          if (winEnd - winStart > KIT_PREVIEW_MAX_DURATION) {
            winEnd = winStart + KIT_PREVIEW_MAX_DURATION;
          }
          // Only shift off frame 0 when the motion genuinely starts later.
          if (winStart > frameStep) {
            timeSpanStart = Math.round(winStart / frameStep) * frameStep;
            timeSpanDuration = Math.max(frameStep, Math.round((winEnd - timeSpanStart) / frameStep) * frameStep);
            natural = Math.max(natural, timeSpanStart + timeSpanDuration);
          }
        }

        tempComp = app.project.items.addComp("Mótion Film Kit Preview Render", w, h, 1, Math.max(timeSpanStart + timeSpanDuration, natural, frameStep), fr);
        for (var j = 0; j < layers.length; j += 1) {
          createLayerFromKitTemplate(tempComp, layers[j], 0);
        }
        if (tempComp.numLayers === 0) {
          // Nothing renderable (e.g. a precomp-only preset). Not an error.
          kitUndoEnd();
          cleanupPreview();
          return stringify({ ok: true, empty: true });
        }
        sourceComp = tempComp;
      } else if (kind === "comp") {
        var compName = data.compName;
        for (var k = 1; k <= app.project.numItems; k += 1) {
          var it = app.project.item(k);
          if (it instanceof CompItem && it.name === compName) {
            sourceComp = it;
            break;
          }
        }
        if (!sourceComp) {
          kitUndoEnd();
          return stringify({ ok: false, error: "“" + compName + "” isn't in this project." });
        }
        timeSpanDuration = Math.min(KIT_PREVIEW_MAX_DURATION, sourceComp.duration);
      } else {
        kitUndoEnd();
        return stringify({ ok: false, error: "Unknown preview kind." });
      }

      rqItem = app.project.renderQueue.items.add(sourceComp);
      rqItem.timeSpanStart = timeSpanStart;
      rqItem.timeSpanDuration = timeSpanDuration;
      // Reduced resolution (see KIT_PREVIEW_MAX_SIDE). setSettings exists
      // from AE 22; on older versions the preview just renders full size.
      var downFactor = Math.max(1, Math.ceil(Math.max(sourceComp.width, sourceComp.height) / KIT_PREVIEW_MAX_SIDE));
      if (downFactor > 1) {
        try { rqItem.setSettings({ "Resolution": [downFactor, downFactor] }); } catch (resolutionError) {}
      }
      // A tile thumbnail: Draft quality and no motion blur -- both cost a
      // lot on heavy layers and are invisible at ~480px. (Only the
      // preview; applying a pack is untouched.) Each key separately, so
      // an unknown value on some AE version can't cancel the others.
      try { rqItem.setSettings({ "Quality": "Draft" }); } catch (qualityError) {}
      try { rqItem.setSettings({ "Motion Blur": "Off for All Layers" }); } catch (motionBlurError) {}
      var om = rqItem.outputModule(1);
      var templateName = pickH264OutputTemplate(om);
      if (!templateName) {
        kitUndoEnd();
        cleanupPreview();
        return stringify({ ok: false, error: "No H.264 output template found on this After Effects install -- can't render a preview." });
      }
      om.applyTemplate(templateName);
      // Force "Post-Render Action: None" -- the "H.264 - Match Render
      // Settings" template saved "Import" on this install, which pops a
      // native confirmation dialog that BLOCKS the ExtendScript engine
      // until a human clicks OK (froze the panel mid-session, confirmed
      // live). We already know outPath and never need a re-import.
      try {
        om.postRenderAction = PostRenderAction.NONE;
      } catch (postRenderActionError) {
        // Older/odd installs may not expose this enum -- non-fatal.
      }
      om.file = new File(outPath);
    } catch (buildError) {
      kitUndoEnd();
      cleanupPreview();
      return stringify({ ok: false, error: String(buildError) });
    }
    kitUndoEnd();

    // --- render (NOT wrapped in an undo group) ---
    // renderQueue.render() renders EVERY queued item, not just ours.
    // Found live: the user had their real 4K comp queued in the Render
    // Queue, so every preview also re-rendered that whole comp (minutes,
    // AE frozen). Un-tick every other queued item for the duration of the
    // preview and tick them back right after, exactly as they were.
    var parkedItems = [];
    try {
      var queue = app.project.renderQueue;
      for (var qi = 1; qi <= queue.numItems; qi += 1) {
        // Ours was just added, so it's the last one (two AE references to
        // the same item aren't guaranteed to be ===, so go by position).
        if (qi === queue.numItems) { continue; }
        var other = queue.item(qi);
        try {
          if (other.render) {
            other.render = false;
            parkedItems.push(other);
          }
        } catch (parkError) {}
      }
    } catch (queueError) {}
    timing.build = new Date().getTime() - timing.start;
    var renderError = null;
    var renderStart = new Date().getTime();
    try {
      app.project.renderQueue.render();
    } catch (renderQueueError) {
      renderError = String(renderQueueError);
    }
    timing.render = new Date().getTime() - renderStart;
    for (var pk = 0; pk < parkedItems.length; pk += 1) {
      try { parkedItems[pk].render = true; } catch (unparkError) {}
    }
    var outFile = new File(outPath);
    var exists = outFile.exists;
    var size = exists ? outFile.length : 0;

    var cleanupStart = new Date().getTime();
    cleanupPreview();
    timing.cleanup = new Date().getTime() - cleanupStart;
    timing.parked = parkedItems.length;
    delete timing.start;

    if (renderError) {
      return stringify({ ok: false, error: renderError, timing: timing });
    }
    if (!exists || !size) {
      return stringify({ ok: false, error: "Render finished but the output file is missing.", timing: timing });
    }
    return stringify({ ok: true, window: { start: timeSpanStart, duration: timeSpanDuration }, timing: timing });
  }

  // ---------------------------------------------------------------
  // Packs (Kit tab): file-based entry points. A whole comp captured with
  // all its keyframes can be many MB of JSON -- it never travels through
  // an evalScript string. The panel passes a path; the host reads/writes
  // the JSON on disk.
  // ---------------------------------------------------------------
  function kitWriteText(path, text) {
    var f = new File(path);
    f.encoding = "UTF-8";
    f.lineFeed = "Unix";
    if (!f.open("w")) {
      throw new Error("Could not write " + path);
    }
    f.write(text);
    f.close();
  }

  // AE's JSON object is a SCRIPT polyfill, not native: JSON.parse took
  // 6-9 s on a 480 KB pack (measured live -- most of the ~10 s a pack
  // took to apply). This data-only reader lets ONE global regex find each
  // token (the regex engine is native) and builds the values with an
  // explicit stack: ~0.7 s on the same file, identical result, and no
  // eval -- a pack can come from someone else's zip, so its text must
  // never be executed.
  var KIT_JSON_TOKEN = /\s*(?:([{}\[\],:])|"([^"\\]*(?:\\[\s\S][^"\\]*)*)"|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)|(true|false|null))/g;
  var KIT_JSON_ESCAPE = /\\(?:u([0-9a-fA-F]{4})|([\s\S]))/g;
  var KIT_JSON_ESCAPE_MAP = { "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t" };

  function kitJsonUnescape(s) {
    return s.replace(KIT_JSON_ESCAPE, function (all, hex, ch) {
      if (hex) { return String.fromCharCode(parseInt(hex, 16)); }
      return KIT_JSON_ESCAPE_MAP.hasOwnProperty(ch) ? KIT_JSON_ESCAPE_MAP[ch] : ch;
    });
  }

  function kitParseJson(text) {
    var re = KIT_JSON_TOKEN;
    re.lastIndex = 0;
    var stack = [];
    var top = null;     // container being filled
    var isArr = false;
    var key = null;     // pending key of an object member
    var expectKey = false;
    var root;
    var hasRoot = false;
    var pos = 0;
    var m, tok, value;
    while (true) {
      m = re.exec(text);
      if (!m || m.index !== pos) {
        if (/^\s*$/.test(text.slice(pos))) { break; }
        throw new SyntaxError("Bad JSON at character " + pos);
      }
      pos = re.lastIndex;
      tok = m[1];
      if (tok) {
        if (tok === "{" || tok === "[") {
          value = tok === "{" ? {} : [];
          if (top) {
            if (isArr) { top.push(value); } else { top[key] = value; }
          } else { root = value; hasRoot = true; }
          stack.push(top, isArr);
          top = value;
          isArr = tok === "[";
          expectKey = !isArr;
        } else if (tok === "}" || tok === "]") {
          isArr = stack.pop();
          top = stack.pop();
          expectKey = false;
        } else if (tok === "," && !isArr) {
          expectKey = true;
        }
        continue; // ":" and array "," need nothing
      }
      if (m[2] !== undefined) {
        value = m[2].indexOf("\\") === -1 ? m[2] : kitJsonUnescape(m[2]);
        if (expectKey) { key = value; expectKey = false; continue; }
      } else if (m[3] !== undefined) {
        value = +m[3];
      } else {
        value = m[4] === "true" ? true : (m[4] === "false" ? false : null);
      }
      if (top) {
        if (isArr) { top.push(value); } else { top[key] = value; }
      } else { root = value; hasRoot = true; }
    }
    if (!hasRoot) { throw new SyntaxError("Empty JSON"); }
    return root;
  }

  function kitReadJson(path) {
    var f = new File(path);
    f.encoding = "UTF-8";
    if (!f.open("r")) {
      throw new Error("Could not read " + path);
    }
    var text = f.read();
    f.close();
    try {
      return kitParseJson(text);
    } catch (fastError) {
      return JSON.parse(text);
    }
  }

  function kitCountSources(layers, acc) {
    if (!layers) { return acc; }
    for (var i = 0; i < layers.length; i += 1) {
      var av = layers[i] && layers[i].avSource;
      if (!av) { continue; }
      if (av.kind === "comp") {
        acc.comps += 1;
        kitCountSources(av.layers, acc);
      } else if (av.kind === "placeholder") {
        if (av.missing) { acc.missing += 1; } else { acc.placeholders += 1; }
      } else if (av.kind === "file") {
        acc.files += 1;
      }
    }
    return acc;
  }

  // BOTH kinds save only the SELECTED layers (user rule -- never the
  // whole comp): kind "layers" pastes them back loose at the playhead;
  // kind "comp" pastes them as ONE new composition (like Pre-compose:
  // same size/fps as where they came from, starting at the earliest
  // selected layer) dropped at the playhead.
  function kitCaptureToFile(kind, outPath) {
    var data;
    var summary = { ok: true, kind: kind };
    try {
      var res = captureKitSelectionData();
      if (!res.ok) {
        return stringify(res);
      }
      data = { layers: res.layers, compWidth: res.compWidth, compHeight: res.compHeight, compFrameRate: res.compFrameRate };
      if (kind === "comp") {
        var span = 0;
        for (var i = 0; i < res.layers.length; i += 1) {
          span = Math.max(span, numberOr(res.layers[i].offset, 0) + numberOr(res.layers[i].duration, 0));
        }
        data = {
          comp: {
            kind: "comp",
            compName: res.compName,
            width: res.compWidth,
            height: res.compHeight,
            pixelAspect: res.compPixelAspect,
            frameRate: res.compFrameRate,
            duration: Math.max(span, 1 / Math.max(1, numberOr(res.compFrameRate, 24))),
            bgColor: res.compBgColor,
            compFlags: {
              motionBlur: res.compMotionBlur,
              shutterAngle: res.compShutterAngle,
              shutterPhase: res.compShutterPhase,
              renderer: res.compRenderer
            },
            layers: res.layers
          },
          compWidth: res.compWidth,
          compHeight: res.compHeight,
          compFrameRate: res.compFrameRate
        };
      }
      summary.name = res.firstName;
      summary.compName = res.compName;
      summary.layers = res.layers.length;
      summary.selected = res.selectedCount;
      summary.dependencies = res.dependencies;
      summary.avSkipped = res.avSkipped;
      summary.sources = kitCountSources(res.layers, { files: 0, comps: 0, placeholders: 0, missing: 0 });
      kitWriteText(outPath, JSON.stringify(data));
    } catch (captureError) {
      return stringify({ ok: false, error: String(captureError) + (captureError.line ? " (line " + captureError.line + ")" : "") });
    }
    return stringify(summary);
  }

  function kitFolder(name, parent) {
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

  // Applies a pack. jsonPath holds { kind, label, data } with every
  // footage avSource already resolved to an absolute `absPath` inside the
  // pack's own folder (the panel does that). kind "comp": the comp is
  // rebuilt and dropped into the ACTIVE comp at the playhead (or, with no
  // comp open, just created and opened). kind "layers": layers inserted
  // into the active comp at the playhead. Imported footage and rebuilt
  // comps go to Project > "Mótion Film Packs" > <pack name>.
  function applyKitPackFile(jsonPath) {
    var pack;
    try {
      pack = kitReadJson(jsonPath);
    } catch (readError) {
      return stringify({ ok: false, error: String(readError) });
    }
    var data = pack.data || {};
    kitUndoCloseAll();
    kitFootageIndex = null; // rebuilt lazily: the project changed since last time
    var target = activeComp();
    if (pack.kind !== "comp" && !target) {
      return stringify({ ok: false, error: "Open/select a composition first." });
    }
    var root = null;
    var sub = null;
    try {
      root = kitFolder("Mótion Film Packs");
      sub = kitFolder(String(pack.label || "Pack"), root);
    } catch (folderError) {}
    kitApplyFolder = sub;
    var result;
    try {
      if (pack.kind === "comp") {
        kitUndoBegin("Mótion Film: Pack (comp)");
        if (data.comp && pack.label) {
          data.comp.compName = String(pack.label); // the new comp is named after the pack
        }
        var newComp = createKitCompFromTemplate(data.comp);
        if (!newComp) {
          kitUndoEnd();
          result = { ok: false, error: "Could not rebuild this composition." };
        } else {
          var inserted = false;
          if (target) {
            var layer = target.layers.add(newComp);
            try { layer.startTime = target.time; } catch (startError) {}
            try {
              for (var s = 1; s <= target.numLayers; s += 1) { target.layer(s).selected = false; }
              layer.selected = true;
            } catch (selectError) {}
            inserted = true;
          }
          kitUndoEnd();
          if (!target) {
            try { newComp.openInViewer(); } catch (openError) {}
          }
          result = { ok: true, applied: 1, comp: newComp.name, inserted: inserted, into: target ? target.name : null };
        }
      } else {
        result = applyKitLayerGroupList(target, data.layers || [], "Mótion Film: Pack (layers)");
      }
    } catch (applyError) {
      result = { ok: false, error: String(applyError) };
    }
    kitUndoCloseAll(); // an error mid-way must never leave a group open
    kitApplyFolder = null;
    kitFootageIndex = null; // don't hold item references between applies
    // A layers pack with no footage leaves its folder empty -- tidy up.
    try {
      if (sub && sub.numItems === 0) { sub.remove(); }
      if (root && root.numItems === 0) { root.remove(); }
    } catch (tidyError) {}
    return stringify(result);
  }

  // Preview for a pack whose data sits in a file (see kitCaptureToFile).
  // Both kinds render ONLY the saved (selected) layers, rebuilt in a
  // throwaway comp the size of the one they came from -- a comp pack
  // looks exactly like its layers, so it goes through the same path,
  // including aiming the short window at where the keyframes are.
  function renderKitPackPreview(dataPath, kind, outPath) {
    var data;
    try {
      data = kitReadJson(dataPath);
    } catch (readError) {
      return stringify({ ok: false, error: String(readError) });
    }
    if (kind === "comp" && data.comp) {
      data = {
        layers: data.comp.layers || [],
        compWidth: data.comp.width,
        compHeight: data.comp.height,
        compFrameRate: data.comp.frameRate
      };
    }
    return renderKitPreviewData("layers", data, outPath);
  }

  $.global.kitCaptureToFile = kitCaptureToFile;
  $.global.applyKitPackFile = applyKitPackFile;
  $.global.renderKitPackPreview = renderKitPackPreview;
  $.global.kitBakeFootageItem = kitBakeFootageItem;

  // phrasesJson: JSON string, an array of { text, start, end } (start/end
  // in seconds, relative to the SOURCE FILE's own time 0 -- the panel
  // adds layerStartTime itself before calling, since it already has that
  // number from getSelectedLayerAudioInfo and it's simpler to keep all
  // the timestamp arithmetic in one place).
  // stylePresetJson: optional JSON string of a preset captured by
  // captureLayerStylePreset -- if present, applied to every caption
  // layer created, right after its text/timing/position are set.
  function createCaptionLayers(phrasesJson, stylePresetJson) {
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "No active composition." });
    }
    var phrases = parse(phrasesJson);
    if (!phrases || !phrases.length) {
      return stringify({ ok: false, error: "The transcription came back empty -- nothing to add." });
    }
    var stylePreset = stylePresetJson ? parse(stylePresetJson) : null;
    var created = 0;
    app.beginUndoGroup("Mótion Film: Add captions");
    try {
      for (var i = 0; i < phrases.length; i += 1) {
        var phrase = phrases[i];
        var text = String(phrase.text || "").replace(/^\s+|\s+$/g, "");
        if (!text) {
          continue;
        }
        var startT = numberOr(phrase.start, 0);
        var endT = numberOr(phrase.end, startT + 1);
        if (endT <= startT) {
          endT = startT + 0.5;
        }
        var textLayer = comp.layers.addText(text);
        textLayer.name = text.length > 40 ? text.slice(0, 40) + "…" : text;
        textLayer.startTime = startT;
        textLayer.inPoint = startT;
        textLayer.outPoint = endT;
        // Bottom-center is the standard caption position for video work --
        // set explicitly rather than relying on wherever AE happens to
        // drop a freshly-added text layer, since dozens of these might
        // get created for one video and re-positioning each by hand would
        // defeat the point of automating this. A style preset's own
        // Transform capture (only present if the user actually animated
        // Position/Anchor Point/etc.) is applied afterward and takes
        // over from here if it touches the same properties.
        var textDoc = textLayer.property("ADBE Text Properties").property("ADBE Text Document").value;
        textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
        textLayer.property("ADBE Text Properties").property("ADBE Text Document").setValue(textDoc);
        textLayer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height * 0.88]);
        textLayer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        if (stylePreset) {
          applyStylePresetToLayer(textLayer, stylePreset);
        }
        created += 1;
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, created: created });
  }

  // ---------------------------------------------------------------
  // Colour Palette satellite window (client/palette.js)
  //
  // Clicking a palette cube applies its colour to every selected layer,
  // branching by layer type:
  //   - text layer  -> TextDocument.fillColor (+ applyFill), no effect
  //   - shape layer -> every "ADBE Vector Graphic - Fill" colour (adds
  //                    one to the root Contents if the shape has none)
  //   - anything else that accepts effects -> a "Fill" effect (reusing
  //     one we already added on a previous click instead of stacking)
  //   - cameras/lights/etc. -> skipped
  // ---------------------------------------------------------------

  function clamp01(n) {
    n = Number(n);
    if (isNaN(n)) { return 0; }
    return n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  function paletteRgbFromArgs(argsJson) {
    var data = parse(argsJson);
    var rgb = data ? data.rgb : null;
    if (!(rgb instanceof Array) || rgb.length < 3) {
      return null;
    }
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  }

  // Walks a shape PropertyGroup (Root Vectors Group or a group's
  // "ADBE Vectors Group"), setting every Fill colour it finds. Returns
  // how many fills were touched. Manual recursion -- no array helpers.
  function setShapeFillColours(group, rgb) {
    var touched = 0;
    if (!group) { return touched; }
    for (var i = 1; i <= group.numProperties; i += 1) {
      var child = group.property(i);
      var match = "";
      try { match = child.matchName; } catch (matchError) { match = ""; }
      if (match === "ADBE Vector Graphic - Fill") {
        try {
          child.property("ADBE Vector Fill Color").setValue(rgb);
          touched += 1;
        } catch (fillError) {}
      } else if (match === "ADBE Vector Group") {
        try {
          touched += setShapeFillColours(child.property("ADBE Vectors Group"), rgb);
        } catch (groupError) {}
      }
    }
    return touched;
  }

  // Keyframed colours reject setValue() -- write a key at the playhead
  // instead, same as the text branch does for Source Text.
  function setColorValue(prop, rgb, time) {
    if (prop.numKeys > 0) {
      prop.setValueAtTime(time, rgb);
    } else {
      prop.setValue(rgb);
    }
  }

  var SHAPE_PATH_MATCHNAMES = {
    "ADBE Vector Shape - Group": true,
    "ADBE Vector Shape - Rect": true,
    "ADBE Vector Shape - Ellipse": true,
    "ADBE Vector Shape - Star": true
  };

  // Stroke counterpart of setShapeFillColours (gradient strokes have no
  // plain colour and are left alone).
  //
  // Drawing a shape with the toolbar's Stroke set to "None" still creates
  // a "Stroke 1" -- just with its visibility eye switched OFF. Recolouring
  // only that left it invisible while the panel reported success, so a
  // hidden stroke is switched back on; `stats.enabled` counts those.
  function setShapeStrokeColours(group, rgb, time, stats) {
    var touched = 0;
    if (!group) { return touched; }
    for (var i = 1; i <= group.numProperties; i += 1) {
      var child = group.property(i);
      var match = "";
      try { match = child.matchName; } catch (matchError) { match = ""; }
      if (match === "ADBE Vector Graphic - Stroke") {
        try {
          setColorValue(child.property("ADBE Vector Stroke Color"), rgb, time);
          touched += 1;
          if (!child.enabled) {
            child.enabled = true;
            if (stats) { stats.enabled += 1; }
          }
        } catch (strokeError) {}
      } else if (match === "ADBE Vector Group") {
        try {
          touched += setShapeStrokeColours(child.property("ADBE Vectors Group"), rgb, time, stats);
        } catch (groupError) {}
      }
    }
    return touched;
  }

  // Index paths (from the root Contents) of every contents group that
  // directly holds a path -- where Contents > Add > Stroke would go for
  // that shape. Indices, not object references: addProperty() can
  // invalidate references to siblings, so each target is re-resolved
  // from the layer right before adding to it.
  function collectStrokeTargets(group, trail, out) {
    var hasPath = false;
    for (var i = 1; i <= group.numProperties; i += 1) {
      var child = group.property(i);
      var match = "";
      try { match = child.matchName; } catch (matchError) { match = ""; }
      if (SHAPE_PATH_MATCHNAMES[match]) {
        hasPath = true;
      } else if (match === "ADBE Vector Group") {
        try {
          collectStrokeTargets(child.property("ADBE Vectors Group"), trail.concat([i]), out);
        } catch (groupError) {}
      }
    }
    if (hasPath) {
      out.push(trail);
    }
  }

  function resolveContentsByTrail(layer, trail) {
    var group = rootContentsOf(layer);
    for (var i = 0; group && i < trail.length; i += 1) {
      group = group.property(trail[i]).property("ADBE Vectors Group");
    }
    return group;
  }

  // Adds a Stroke to every group that draws a path, placed just above
  // that group's first fill so the outline renders on top of it (same
  // stacking AE's own shape tools create). Falls back to the root
  // Contents when no group holds a path directly.
  function addShapeStrokes(layer, rgb) {
    var root = rootContentsOf(layer);
    if (!root) { return 0; }
    var targets = [];
    collectStrokeTargets(root, [], targets);
    if (!targets.length) {
      targets.push([]);
    }
    var added = 0;
    for (var t = 0; t < targets.length; t += 1) {
      try {
        var group = resolveContentsByTrail(layer, targets[t]);
        var firstFill = 0;
        for (var i = 1; i <= group.numProperties; i += 1) {
          var match = group.property(i).matchName;
          if (match === "ADBE Vector Graphic - Fill" || match === "ADBE Vector Graphic - G-Fill") {
            firstFill = i;
            break;
          }
        }
        var stroke = group.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(rgb);
        if (firstFill) {
          stroke.moveTo(firstFill);
        }
        added += 1;
      } catch (addError) {}
    }
    return added;
  }

  // First COLOR-typed property on an effect, found by value type rather
  // than a guessed "ADBE Fill-000x" matchName (which differs between AE
  // versions).
  function firstColorProperty(effect) {
    for (var i = 1; i <= effect.numProperties; i += 1) {
      var prop = effect.property(i);
      try {
        if (prop.propertyValueType === PropertyValueType.COLOR) {
          return prop;
        }
      } catch (typeError) {}
    }
    return null;
  }

  function effectParadeOf(layer) {
    try {
      return layer.property("ADBE Effect Parade") || null;
    } catch (error) {
      return null;
    }
  }

  function applyPaletteColor(argsJson) {
    var rgb = paletteRgbFromArgs(argsJson);
    if (!rgb) {
      return stringify({ ok: false, error: "Cor inválida." });
    }
    var comp = activeComp();
    if (!comp) {
      return stringify({ ok: false, error: "Abra uma composição primeiro." });
    }
    var layers = selectedLayers();
    if (!layers || !layers.length) {
      return stringify({ ok: false, error: "Selecione ao menos uma camada." });
    }

    var applied = 0;
    var skipped = 0;

    // Shift+click in the palette: colour only the outline.
    var args = parse(argsJson) || {};
    if (args.target === "stroke") {
      return applyPaletteStroke(comp, layers, rgb);
    }

    app.beginUndoGroup("Mótion Film: aplicar cor da paleta");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var layer = layers[i];

        if (layer instanceof TextLayer) {
          var textProp = textPropertyOf(layer);
          if (!textProp) { skipped += 1; continue; }
          try {
            var doc = textProp.value;
            doc.applyFill = true;
            doc.fillColor = rgb;
            if (textProp.numKeys > 0) {
              textProp.setValueAtTime(comp.time, doc);
            } else {
              textProp.setValue(doc);
            }
            applied += 1;
          } catch (textError) {
            skipped += 1;
          }
          continue;
        }

        if (isShapeLayer(layer)) {
          var root = rootContentsOf(layer);
          var count = setShapeFillColours(root, rgb);
          if (count === 0 && root) {
            try {
              root.addProperty("ADBE Vector Graphic - Fill")
                .property("ADBE Vector Fill Color").setValue(rgb);
              count = 1;
            } catch (addFillError) {}
          }
          if (count > 0) { applied += 1; } else { skipped += 1; }
          continue;
        }

        var parade = effectParadeOf(layer);
        if (!parade) {
          skipped += 1;
          continue;
        }
        try {
          var fillEffect = null;
          for (var e = 1; e <= parade.numProperties; e += 1) {
            var candidate = parade.property(e);
            var candidateMatch = "";
            try { candidateMatch = candidate.matchName; } catch (cmError) { candidateMatch = ""; }
            if (candidateMatch === "ADBE Fill") {
              fillEffect = candidate;
              break;
            }
          }
          if (!fillEffect) {
            fillEffect = parade.addProperty("ADBE Fill");
          }
          var colorProp = firstColorProperty(fillEffect);
          if (!colorProp) {
            skipped += 1;
            continue;
          }
          colorProp.setValue(rgb);
          applied += 1;
        } catch (effectError) {
          skipped += 1;
        }
      }
    } catch (loopError) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(loopError) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, applied: applied, skipped: skipped });
  }

  // Stroke-only variant of applyPaletteColor:
  //   - shape layer -> every "ADBE Vector Graphic - Stroke" colour; if the
  //                    shape has none, adds one (as Contents > Add >
  //                    Stroke would) to each group that draws a path
  //   - text layer  -> TextDocument.strokeColor, turning the stroke on
  //                    (with a visible width) if it was off
  //   - anything else -> skipped (no native outline to colour)
  function applyPaletteStroke(comp, layers, rgb) {
    var applied = 0;
    var skipped = 0;
    var added = 0;
    var stats = { enabled: 0 };
    app.beginUndoGroup("Mótion Film: aplicar cor no stroke");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var layer = layers[i];

        if (layer instanceof TextLayer) {
          var textProp = textPropertyOf(layer);
          if (!textProp) { skipped += 1; continue; }
          try {
            var doc = textProp.value;
            if (!doc.applyStroke || !(doc.strokeWidth > 0)) {
              added += 1;
            }
            doc.applyStroke = true;
            doc.strokeColor = rgb;
            if (!(doc.strokeWidth > 0)) {
              doc.strokeWidth = 2;
            }
            if (textProp.numKeys > 0) {
              textProp.setValueAtTime(comp.time, doc);
            } else {
              textProp.setValue(doc);
            }
            applied += 1;
          } catch (textError) {
            skipped += 1;
          }
          continue;
        }

        if (isShapeLayer(layer)) {
          var count = setShapeStrokeColours(rootContentsOf(layer), rgb, comp.time, stats);
          if (count === 0) {
            count = addShapeStrokes(layer, rgb);
            if (count > 0) { added += 1; }
          }
          if (count > 0) { applied += 1; } else { skipped += 1; }
          continue;
        }

        skipped += 1;
      }
    } catch (loopError) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(loopError) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, applied: applied, skipped: skipped, added: added, enabled: stats.enabled, target: "stroke" });
  }

  // Shared appearance theme, so satellite windows (palette.html) can
  // follow the accent/panel colours the user set in the main panel. CEP
  // loads this ScriptPath once into a single ExtendScript engine shared
  // by every extension in the bundle, so $.global here is genuinely
  // common ground between the two panels -- no file IO needed. Lives
  // only while AE is running; each panel also caches to its own
  // localStorage for the first paint after an AE restart.
  function setSharedTheme(json) {
    var t = parse(json) || {};
    $.global.__mfThemeAccent = t.accent ? String(t.accent) : null;
    $.global.__mfThemePanel = t.panel ? String(t.panel) : null;
    return stringify({ ok: true });
  }
  function getSharedTheme() {
    return stringify({
      ok: true,
      accent: $.global.__mfThemeAccent || null,
      panel: $.global.__mfThemePanel || null
    });
  }

  // Same shared-global channel as the theme: whether the layer-creation
  // buttons (Null / Adjustment / Solid) live in the "Camadas
  // complementares" satellite window instead of the main panel's footer.
  // The main panel owns the setting (a toggle in its settings popover)
  // and caches it to its own localStorage; the satellite just reads it
  // here to know whether to show its buttons, and can flip it back off.
  //
  // Also persisted in AE's preferences (app.settings): the shared global
  // starts empty on every AE launch and used to be seeded only by the
  // main panel's load. When "MF - Camadas" loaded first it read "off"
  // and, being unfocused, never asked again -- the user had to toggle
  // the setting off/on after every restart. The saved value lets the
  // satellite get the right answer no matter which window loads first.
  var AUX_LAYERS_SECTION = "MotionFilm";
  var AUX_LAYERS_KEY = "auxLayersEnabled";

  function setAuxLayersEnabled(json) {
    var value = parse(json);
    if (value && typeof value === "object") {
      value = value.enabled;
    }
    value = !!value;
    $.global.__mfAuxLayers = value;
    try {
      var saved = app.settings.haveSetting(AUX_LAYERS_SECTION, AUX_LAYERS_KEY) ?
        app.settings.getSetting(AUX_LAYERS_SECTION, AUX_LAYERS_KEY) : null;
      // Only write (and flush) on a real change -- the main panel re-sends
      // the value on every load.
      if (saved !== (value ? "1" : "0")) {
        app.settings.saveSetting(AUX_LAYERS_SECTION, AUX_LAYERS_KEY, value ? "1" : "0");
        try { app.preferences.saveToDisk(); } catch (flushError) {}
      }
    } catch (saveError) {}
    return stringify({ ok: true, enabled: value });
  }
  function getAuxLayersEnabled() {
    if (typeof $.global.__mfAuxLayers !== "boolean") {
      try {
        if (app.settings.haveSetting(AUX_LAYERS_SECTION, AUX_LAYERS_KEY)) {
          $.global.__mfAuxLayers = app.settings.getSetting(AUX_LAYERS_SECTION, AUX_LAYERS_KEY) === "1";
        }
      } catch (readError) {}
    }
    return stringify({ ok: true, enabled: !!$.global.__mfAuxLayers });
  }

  // The functions below are intentionally global: CEP's ScriptPath loads this
  // file once, and the panel calls them through __adobe_cep__.evalScript().
  $.global.createShapeNull = createShapeNull;
  $.global.getNullMarkerSize = getNullMarkerSize;
  $.global.setNullMarkerSize = setNullMarkerSize;
  $.global.createShapeAdjustment = createShapeAdjustment;
  $.global.createShapeSolid = createShapeSolid;
  $.global.pickColorNative = pickColorNative;
  $.global.readLayerTransform = readLayerTransform;
  $.global.setTransformValue = setTransformValue;
  $.global.toggleTransformStopwatch = toggleTransformStopwatch;
  $.global.resetLayerTransform = resetLayerTransform;
  $.global.setAnchorPreset = setAnchorPreset;
  $.global.keyframeUtility = keyframeUtility;
  $.global.copySelectedKeyframeCurves = copySelectedKeyframeCurves;
  $.global.pasteSelectedKeyframeCurves = pasteSelectedKeyframeCurves;
  $.global.applyVelocityProfile = applyVelocityProfile;
  $.global.applyKitPreset = applyKitPreset;
  $.global.applyKitLayerGroupPreset = applyKitLayerGroupPreset;
  $.global.captureKitLayerGroupFromNames = captureKitLayerGroupFromNames;
  $.global.captureKitLayerGroupFromSelection = captureKitLayerGroupFromSelection;
  $.global.applyKitLayerGroupData = applyKitLayerGroupData;
  $.global.captureKitCompReference = captureKitCompReference;
  $.global.applyKitCompData = applyKitCompData;
  $.global.renderKitPreviewClip = renderKitPreviewClip;
  $.global.importSvgIcon = importSvgIcon;
  $.global.getSelectedLayerAudioInfo = getSelectedLayerAudioInfo;
  $.global.createCaptionLayers = createCaptionLayers;
  $.global.captureLayerStylePreset = captureLayerStylePreset;
  $.global.applyStylePresetToSelectedLayers = applyStylePresetToSelectedLayers;
  $.global.applyPaletteColor = applyPaletteColor;
  $.global.setSharedTheme = setSharedTheme;
  $.global.getSharedTheme = getSharedTheme;
  $.global.setAuxLayersEnabled = setAuxLayersEnabled;
  $.global.getAuxLayersEnabled = getAuxLayersEnabled;

  // ---------------------------------------------------------------
  // Effects Manager tab: lists every effect applied across ALL
  // currently selected layers (not just one), grouped by matchName --
  // the effect's real technical identity, not its (possibly
  // hand-renamed) display name -- since matchName is what actually
  // determines whether two effect instances "are the same" for
  // toggling/removing together. A checkbox/delete here acts on every
  // instance of that effect across the WHOLE current selection at
  // once, which is the entire point: no more opening each layer's own
  // Effect Controls one at a time to turn off the same effect on all
  // of them. Deliberately shows the UNION of effects across the
  // selection (any effect present on at least one selected layer),
  // not just ones shared by every layer -- per spec, an effect that
  // only exists on 1 of several selected layers should still show up.
  // ---------------------------------------------------------------

  function effectParadeOf(layer) {
    try {
      return layer.property("ADBE Effect Parade");
    } catch (paradeError) {
      return null;
    }
  }

  function getSelectedLayersEffects() {
    try {
      var layers = selectedLayers();
      if (!layers.length) {
        return stringify({ ok: true, layerCount: 0, totalInstances: 0, effects: [] });
      }
      var byMatchName = {}; // matchName -> { matchName, name, count, enabledCount }
      var order = [];
      var totalInstances = 0;
      for (var i = 0; i < layers.length; i += 1) {
        var parade = effectParadeOf(layers[i]);
        if (!parade) {
          continue;
        }
        var count = 0;
        try {
          count = parade.numProperties;
        } catch (countError) {
          count = 0;
        }
        for (var p = 1; p <= count; p += 1) {
          var effect;
          try {
            effect = parade.property(p);
          } catch (effectError) {
            continue;
          }
          if (!effect) {
            continue;
          }
          var matchName = effect.matchName;
          if (!byMatchName[matchName]) {
            byMatchName[matchName] = { matchName: matchName, name: effect.name, count: 0, enabledCount: 0 };
            order.push(matchName);
          }
          byMatchName[matchName].count += 1;
          var isEnabled = true;
          try {
            isEnabled = !!effect.enabled;
          } catch (enabledError) {
            isEnabled = true;
          }
          if (isEnabled) {
            byMatchName[matchName].enabledCount += 1;
          }
          totalInstances += 1;
        }
      }

      var effectsList = [];
      for (var e = 0; e < order.length; e += 1) {
        var entry = byMatchName[order[e]];
        var state = "none";
        if (entry.enabledCount === entry.count) {
          state = "all";
        } else if (entry.enabledCount > 0) {
          state = "mixed";
        }
        effectsList.push({ matchName: entry.matchName, name: entry.name, count: entry.count, state: state });
      }

      return stringify({ ok: true, layerCount: layers.length, totalInstances: totalInstances, effects: effectsList });
    } catch (error) {
      return stringify({ ok: false, error: String(error) });
    }
  }

  // Re-derives "every effect instance with this matchName" fresh from
  // whatever is selected RIGHT NOW rather than trusting any cached
  // reference from a previous getSelectedLayersEffects() call -- same
  // principle as the rest of this file (e.g. applyStyleChildren):
  // AE property references can go stale the moment something else on
  // the layer changes, so re-walking the live tree is the reliable way.
  function setEffectEnabledForSelection(matchName, enabled) {
    var layers = selectedLayers();
    var changed = 0;
    app.beginUndoGroup("Mótion Film: Toggle effect");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var parade = effectParadeOf(layers[i]);
        if (!parade) {
          continue;
        }
        var count = 0;
        try {
          count = parade.numProperties;
        } catch (countError) {
          count = 0;
        }
        for (var p = 1; p <= count; p += 1) {
          var effect;
          try {
            effect = parade.property(p);
          } catch (effectError) {
            continue;
          }
          if (effect && effect.matchName === matchName) {
            try {
              effect.enabled = !!enabled;
              changed += 1;
            } catch (setError) {
              // Non-fatal -- an effect refusing this (rare) shouldn't block the rest.
            }
          }
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, changed: changed });
  }

  function setAllEffectsEnabledForSelection(enabled) {
    var layers = selectedLayers();
    var changed = 0;
    app.beginUndoGroup("Mótion Film: Toggle all effects");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var parade = effectParadeOf(layers[i]);
        if (!parade) {
          continue;
        }
        var count = 0;
        try {
          count = parade.numProperties;
        } catch (countError) {
          count = 0;
        }
        for (var p = 1; p <= count; p += 1) {
          var effect;
          try {
            effect = parade.property(p);
          } catch (effectError) {
            continue;
          }
          if (effect) {
            try {
              effect.enabled = !!enabled;
              changed += 1;
            } catch (setError) {
              // Non-fatal.
            }
          }
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, changed: changed });
  }

  function removeEffectForSelection(matchName) {
    var layers = selectedLayers();
    var removed = 0;
    app.beginUndoGroup("Mótion Film: Remove effect");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var parade = effectParadeOf(layers[i]);
        if (!parade) {
          continue;
        }
        // Collect matches first, THEN remove -- removing while walking
        // forward shifts every later index down by one, which skips
        // the item right after whatever was just removed.
        var toRemove = [];
        var count = 0;
        try {
          count = parade.numProperties;
        } catch (countError) {
          count = 0;
        }
        for (var p = 1; p <= count; p += 1) {
          var effect;
          try {
            effect = parade.property(p);
          } catch (effectError) {
            continue;
          }
          if (effect && effect.matchName === matchName) {
            toRemove.push(effect);
          }
        }
        for (var r = 0; r < toRemove.length; r += 1) {
          try {
            toRemove[r].remove();
            removed += 1;
          } catch (removeError) {
            // Non-fatal -- move on to the next one.
          }
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, removed: removed });
  }

  $.global.getSelectedLayersEffects = getSelectedLayersEffects;
  $.global.setEffectEnabledForSelection = setEffectEnabledForSelection;
  $.global.setAllEffectsEnabledForSelection = setAllEffectsEnabledForSelection;
  $.global.removeEffectForSelection = removeEffectForSelection;
}());