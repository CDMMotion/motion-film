(function () {
  "use strict";

  var velocity = {
    peak: 0.5,
    width: 0.52,
    pointer: { x: 0.5, y: 0.48 },
    dragging: false,
    ghost: null,
    mode: "bezier"
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  // The status bar used to be a permanently-visible strip; it's now a
  // transient toast, shown only while there's something to say and
  // auto-dismissed after a few seconds (errors linger a bit longer, on
  // the assumption there's more to actually read).
  var statusHideTimer = null;

  function hideStatus() {
    if (statusHideTimer) {
      clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    els.status.classList.remove("is-visible");
    // Only actually hide (removing it from layout/AT) once the fade-out
    // transition has had time to finish, matching styles.css's duration
    // -- otherwise it would visibly snap away mid-fade.
    window.setTimeout(function () {
      if (!els.status.classList.contains("is-visible")) {
        els.status.hidden = true;
      }
    }, 200);
  }

  function setStatus(message, type) {
    if (!message) {
      hideStatus();
      return;
    }
    var tabs = document.querySelector(".page-tabs");
    if (tabs) {
      els.status.style.top = (tabs.getBoundingClientRect().bottom + 8) + "px";
    }
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.className = "status" + (type ? " is-" + type : "");
    // Force a reflow before adding is-visible so the opacity/transform
    // transition actually animates in from the reset state, instead of
    // the class landing in the same paint as `hidden = false` and
    // jumping straight to visible with no transition to observe.
    void els.status.offsetHeight;
    els.status.classList.add("is-visible");
    if (statusHideTimer) {
      clearTimeout(statusHideTimer);
    }
    // Errors used to stay up 7s -- user feedback (a screenshot of the
    // toast still lingering) said that reads as too long; brought down
    // to 4s, then down again to 2s (still too slow per later feedback).
    // Stayed one shared duration for both success/error the whole way,
    // not a separate shorter value for either -- one predictable number
    // to remember instead of two.
    statusHideTimer = window.setTimeout(hideStatus, 2000);
  }

  function evalHost(expression, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(expression, callback || function () {});
      return;
    }
    if (callback) {
      callback(JSON.stringify({ ok: false, error: "This panel must run inside After Effects." }));
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
        parsed = { ok: false, error: raw || "No response from After Effects." };
      }
      if (callback) {
        callback(parsed);
      }
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function influenceValue(element, fallback) {
    if (!element) {
      return fallback;
    }
    return clamp(parseFloat(element.value) || fallback, 1, 99);
  }

  function controlPointsFor(inInfluence, outInfluence) {
    return {
      inInfluence: inInfluence,
      outInfluence: outInfluence,
      x1: outInfluence / 100,
      x2: 1 - inInfluence / 100
    };
  }

  function temporalControlPoints() {
    return controlPointsFor(
      influenceValue(els.inValue, 64),
      influenceValue(els.outValue, 64)
    );
  }

  // `controls` is optional: pass one to sample a curve other than the one
  // currently in the input fields, which is how the ghost of the previous
  // curve is drawn while dragging.
  function velocityCurveSamples(count, controls) {
    if (!controls) {
      controls = temporalControlPoints();
    }
    var points = [];
    var maximum = 0;
    var i;

    // This is the velocity derivative of the same temporal cubic used by
    // After Effects. Endpoint speeds are zero, so the value controls are
    // 0, 0, 1, 1 and the curve rises immediately from each base point.
    for (i = 0; i <= count; i += 1) {
      var parameter = i / count;
      var inverse = 1 - parameter;
      var time = 3 * inverse * inverse * parameter * controls.x1 +
        3 * inverse * parameter * parameter * controls.x2 +
        parameter * parameter * parameter;
      var dx = 3 * inverse * inverse * controls.x1 +
        6 * inverse * parameter * (controls.x2 - controls.x1) +
        3 * parameter * parameter * (1 - controls.x2);
      var speed = dx > 0 ? (6 * parameter * inverse) / dx : 0;
      maximum = Math.max(maximum, speed);
      points.push({ time: time, speed: speed });
    }

    if (maximum <= 0) {
      maximum = 1;
    }
    for (i = 0; i < points.length; i += 1) {
      points[i].speed = clamp(points[i].speed / maximum, 0, 1);
    }
    return points;
  }

  function velocityAt(time) {
    var samples = velocityCurveSamples(96);
    var target = clamp(time, 0, 1);
    if (target <= 0) {
      return 0;
    }
    for (var i = 1; i < samples.length; i += 1) {
      if (target <= samples[i].time) {
        var previous = samples[i - 1];
        var current = samples[i];
        var span = current.time - previous.time;
        var amount = span > 0 ? (target - previous.time) / span : 0;
        return previous.speed + (current.speed - previous.speed) * amount;
      }
    }
    return 0;
  }

  function profileSamples() {
    var samples = [];
    for (var i = 0; i < 33; i += 1) {
      samples.push(velocityAt(i / 32));
    }
    return samples;
  }

  function drawCurve() {
    var canvas = els.canvas;
    var context = canvas.getContext("2d");
    var width = canvas.clientWidth || 640;
    var height = canvas.clientHeight || 390;
    var ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    var pad = { left: 24, right: 13, top: 14, bottom: 20 };
    var graphW = width - pad.left - pad.right;
    var graphH = height - pad.top - pad.bottom;
    var x = function (value) { return pad.left + value * graphW; };
    var y = function (value) { return pad.top + (1 - value) * graphH; };

    context.strokeStyle = "rgba(255,255,255,.08)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left + graphW / 2, pad.top);
    context.lineTo(pad.left + graphW / 2, pad.top + graphH);
    context.stroke();

    // While dragging, the curve as it was when the drag started is drawn
    // dashed underneath, so the size of the change is visible. It is
    // cleared once the new curve is applied.
    if (velocity.ghost) {
      var ghostCurve = velocityCurveSamples(160, controlPointsFor(velocity.ghost.inInfluence, velocity.ghost.outInfluence));
      context.save();
      context.setLineDash([5, 4]);
      context.strokeStyle = "rgba(212, 170, 90, .85)";
      context.lineWidth = 1.8;
      context.beginPath();
      for (var ghostIndex = 0; ghostIndex < ghostCurve.length; ghostIndex += 1) {
        var ghostX = x(ghostCurve[ghostIndex].time);
        var ghostY = y(ghostCurve[ghostIndex].speed);
        if (ghostIndex === 0) {
          context.moveTo(ghostX, ghostY);
        } else {
          context.lineTo(ghostX, ghostY);
        }
      }
      context.stroke();
      context.restore();
    }

    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent-bright").trim();
    context.lineWidth = 2.3;
    var curve = velocityCurveSamples(160);
    context.beginPath();
    for (var sampleIndex = 0; sampleIndex < curve.length; sampleIndex += 1) {
      var sampleX = x(curve[sampleIndex].time);
      var sampleY = y(curve[sampleIndex].speed);
      if (sampleIndex === 0) {
        context.moveTo(sampleX, sampleY);
      } else {
        context.lineTo(sampleX, sampleY);
      }
    }
    context.stroke();

    // The speed graph always rests on the same two fixed zero-velocity points.
    context.strokeStyle = "rgba(255,255,255,.35)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(x(0), y(0));
    context.lineTo(x(1), y(0));
    context.stroke();

    context.fillStyle = "#ffffff";
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    context.lineWidth = 1.5;
    [0, 1].forEach(function (endpoint) {
      context.beginPath();
      context.arc(x(endpoint), y(0), 3.2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  }

  function canvasPoint(event) {
    var rect = els.canvas.getBoundingClientRect();
    var pad = { left: 24, right: 13, top: 14, bottom: 20 };
    return {
      x: clamp((event.clientX - rect.left - pad.left) / (rect.width - pad.left - pad.right), 0, 1),
      y: clamp(1 - (event.clientY - rect.top - pad.top) / (rect.height - pad.top - pad.bottom), 0, 1)
    };
  }

  function updateVelocityFromPointer(point) {
    velocity.pointer = point;
    velocity.peak = point.x;

    // Vertical position sets how strong the ease is (1-99).
    var depth = clamp(1 - point.y, 0, 1);
    var strength = 1 + depth * 98;

    // Horizontal position sets the balance. The side being dragged
    // towards always keeps the full strength; only the opposite side
    // eases off, reaching its minimum at the edge.
    //
    // The previous mapping added the bias to one side and subtracted it
    // from the other. Near the bottom of the graph the added side was
    // already at the 99 ceiling, so dragging sideways could only ever
    // subtract -- the curve visibly weakened while the cursor kept
    // moving outward. Scaling the trailing side instead keeps both axes
    // monotonic: down always sharpens, sideways always shifts.
    var balance = clamp(point.x, 0, 1);
    var lead = strength;
    var trailFactor = 1 - Math.abs(balance - 0.5) * 2;
    var trail = 1 + (strength - 1) * trailFactor;

    var outInfluence;
    var inInfluence;
    if (balance >= 0.5) {
      outInfluence = lead;
      inInfluence = trail;
    } else {
      inInfluence = lead;
      outInfluence = trail;
    }

    velocity.width = clamp(depth, 0.01, 1);
    els.inValue.value = String(clamp(Math.round(inInfluence), 1, 99));
    els.outValue.value = String(clamp(Math.round(outInfluence), 1, 99));
    els.inSlider.value = els.inValue.value;
    els.outSlider.value = els.outValue.value;
    drawCurve();
  }

  // ---------------------------------------------------------------
  // Layer Transform
  //
  // Rows follow the native Properties panel order. The DOM is built
  // once per layer "shape" (which layer, 2D vs 3D) and afterwards only
  // the field values are updated in place. Rebuilding the inputs on
  // every refresh is what previously killed drags mid-gesture: the
  // element under the cursor was destroyed and replaced, taking pointer
  // capture with it.
  // ---------------------------------------------------------------

  var TRANSFORM_SPEC = [
    { name: "anchor", label: "Anchor Point", suffix: "", step: 1, decimals: 1 },
    { name: "position", label: "Position", suffix: "", step: 1, decimals: 1 },
    { name: "scale", label: "Scale", suffix: "%", step: 0.5, decimals: 1, linkable: true },
    { name: "rotation", label: "Rotation", suffix: "°", step: 0.5, decimals: 1 },
    { name: "opacity", label: "Opacity", suffix: "%", step: 0.5, decimals: 0, min: 0, max: 100 }
  ];

  var STOPWATCH_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="9.2" r="5.4"/><path d="M8 6.4v2.8l1.9 1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.1 1.6h3.8" stroke-linecap="round"/><path d="M8 1.6v1.5" stroke-linecap="round"/></svg>';
  var LINK_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.8 0l2-2a2.7 2.7 0 0 0-3.8-3.8l-.9.9" stroke-linecap="round"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.8 0l-2 2a2.7 2.7 0 0 0 3.8 3.8l.9-.9" stroke-linecap="round"/></svg>';

  var transformState = {
    signature: null,
    rows: {},
    scaleLinked: true,
    busy: false,
    skipCounter: 0
  };

  // True when the currently selected layer is a text layer, set from the
  // last readLayerTransform response -- drives the poll throttle above
  // (and pollTick going fully silent while the panel is blurred).
  var selectionIsText = false;

  // Confirmed live (over several days of real use): typing fast into a
  // text layer directly in AE's own viewport can make AE's cursor jump
  // back to the start mid-sentence, because readLayerTransform's full
  // property read (Position/Scale/Rotation/Opacity) runs an evalScript
  // on AE's main thread every 700ms tick and that alone can collide with
  // a fast typing burst. So while the selected layer is a text layer
  // (selectionIsText, from the previous readLayerTransform response),
  // only 1 in TRANSFORM_TEXT_POLL_DIVISOR ticks actually reads -- cutting
  // the evalScript frequency during an active text edit by that factor.
  // Non-text layers poll at full speed so Position/Scale/etc. track
  // live keyframed/expression animation as playback moves.
  var TRANSFORM_TEXT_POLL_DIVISOR = 4;

  function formatTransformNumber(value, decimals) {
    var factor = Math.pow(10, decimals);
    var rounded = Math.round((Number(value) || 0) * factor) / factor;
    return String(rounded);
  }

  function layerSignature(layer) {
    if (!layer) {
      return null;
    }
    var parts = [layer.index, layer.threeD ? "3d" : "2d"];
    for (var i = 0; i < TRANSFORM_SPEC.length; i += 1) {
      var entry = layer.props[TRANSFORM_SPEC[i].name];
      parts.push(TRANSFORM_SPEC[i].name + ":" + (entry ? entry.values.length : 0));
    }
    return parts.join("|");
  }

  function commitTransform(spec, shouldKeyframe) {
    var row = transformState.rows[spec.name];
    if (!row) {
      return;
    }
    var values = readRowValues(row);
    transformState.busy = true;
    hostCall("setTransformValue", [spec.name, JSON.stringify(values), !!shouldKeyframe], function (result) {
      transformState.busy = false;
      if (!result.ok) {
        setStatus(result.error, "error");
      }
    });
  }

  function readRowValues(row) {
    var values = [];
    for (var i = 0; i < row.inputs.length; i += 1) {
      values.push(parseFloat(row.inputs[i].value) || 0);
    }
    return values;
  }

  // Shared numeric row: stopwatch, label, optional proportional-link
  // toggle, then one field per dimension. Used by both Layer Transform
  // and Shape Properties so their look and drag behaviour stay identical.
  function buildValueRow(spec, dimensionCount, callbacks) {
    var row = document.createElement("div");
    row.className = "t-row";

    var stopwatch = document.createElement("button");
    stopwatch.type = "button";
    stopwatch.className = "t-stopwatch";
    stopwatch.title = "Toggle animation for " + spec.label;
    stopwatch.setAttribute("aria-label", "Toggle animation for " + spec.label);
    stopwatch.innerHTML = STOPWATCH_SVG;
    stopwatch.addEventListener("click", function () {
      callbacks.toggleKeyframe();
    });

    var label = document.createElement("span");
    label.className = "t-label";
    label.textContent = spec.label;

    var fields = document.createElement("div");
    fields.className = "t-fields";

    var linkState = { on: spec.linkDefault !== false };
    var linkButton = null;
    if (spec.linkable && dimensionCount > 1) {
      linkButton = document.createElement("button");
      linkButton.type = "button";
      linkButton.className = "t-link" + (linkState.on ? " is-on" : "");
      linkButton.title = "Constrain proportions";
      linkButton.setAttribute("aria-label", "Constrain proportions");
      linkButton.innerHTML = LINK_SVG;
      linkButton.addEventListener("click", function () {
        linkState.on = !linkState.on;
        linkButton.classList.toggle("is-on", linkState.on);
      });
    }

    var inputs = [];
    for (var i = 0; i < dimensionCount; i += 1) {
      (function (index) {
        var wrap = document.createElement("div");
        wrap.className = "t-field";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "t-input";
        input.setAttribute("data-index", String(index));
        input.setAttribute("aria-label", spec.label + " " + (index + 1));
        wrap.appendChild(input);
        if (spec.suffix) {
          var suffix = document.createElement("span");
          suffix.className = "t-suffix";
          suffix.textContent = spec.suffix;
          wrap.appendChild(suffix);
        }
        bindNumericInput(input, spec, index, inputs, linkState, callbacks);
        inputs.push(input);
        fields.appendChild(wrap);
      }(i));
    }

    row.appendChild(stopwatch);
    row.appendChild(label);
    if (linkButton) {
      row.appendChild(linkButton);
    } else {
      var spacer = document.createElement("span");
      spacer.className = "t-link-spacer";
      row.appendChild(spacer);
    }
    row.appendChild(fields);

    return { row: row, inputs: inputs, stopwatch: stopwatch };
  }

  function buildTransformRow(spec, dimensionCount) {
    var built = buildValueRow(spec, dimensionCount, {
      commit: function () {
        commitTransform(spec, false);
      },
      revert: function () {
        refreshTransform(true);
      },
      toggleKeyframe: function () {
        hostCall("toggleTransformStopwatch", [spec.name], function (result) {
          if (!result.ok) {
            setStatus(result.error, "error");
            return;
          }
          setStatus(spec.label + (result.animating ? " animation started." : " keyframes removed."), "success");
          refreshTransform(true);
        });
      }
    });
    transformState.rows[spec.name] = built;
    return built.row;
  }

  function bindNumericInput(input, spec, index, siblings, linkState, callbacks) {
    var dragging = false;
    var moved = false;
    var typing = false;
    var startX = 0;
    var startValues = [];
    var pointerId = null;
    var lastCommit = 0;

    function clampValue(value) {
      if (typeof spec.min === "number") {
        value = Math.max(spec.min, value);
      }
      if (typeof spec.max === "number") {
        value = Math.min(spec.max, value);
      }
      return value;
    }

    function applyDelta(dx, coarse, fine) {
      var step = spec.step * (coarse ? 5 : (fine ? 0.1 : 1));
      var next = clampValue(startValues[index] + dx * step);
      input.value = formatTransformNumber(next, spec.decimals);

      // Constrain proportions: linked siblings keep the ratio they had
      // when the drag began.
      if (spec.linkable && linkState && linkState.on && startValues[index] !== 0) {
        var ratio = next / startValues[index];
        for (var i = 0; i < siblings.length; i += 1) {
          if (i === index) {
            continue;
          }
          siblings[i].value = formatTransformNumber(clampValue(startValues[i] * ratio), spec.decimals);
        }
      }
    }

    input.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || typing) {
        return;
      }
      // Suppress the browser's caret-placement / text-selection drag.
      // Mouse dragging here only ever scrubs; typing is reached by
      // double-click, matching the native fields.
      event.preventDefault();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startValues = [];
      for (var i = 0; i < siblings.length; i += 1) {
        startValues.push(parseFloat(siblings[i].value) || 0);
      }
      pointerId = event.pointerId;
      if (input.setPointerCapture) {
        try {
          input.setPointerCapture(pointerId);
        } catch (captureError) {
          // Falls back to plain hit-testing.
        }
      }
    });

    input.addEventListener("pointermove", function (event) {
      if (!dragging) {
        return;
      }
      var dx = event.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 3) {
          return;
        }
        moved = true;
        input.classList.add("is-scrubbing");
      }
      event.preventDefault();
      applyDelta(dx, event.shiftKey, event.altKey);

      var now = Date.now();
      if (now - lastCommit > 60) {
        lastCommit = now;
        callbacks.commit();
      }
    });

    function endDrag() {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (input.releasePointerCapture && pointerId !== null) {
        try {
          input.releasePointerCapture(pointerId);
        } catch (releaseError) {
          // Already released.
        }
      }
      if (moved) {
        input.classList.remove("is-scrubbing");
        callbacks.commit();
      }
      moved = false;
    }

    input.addEventListener("pointerup", endDrag);
    input.addEventListener("pointercancel", endDrag);
    input.addEventListener("lostpointercapture", endDrag);

    input.addEventListener("dblclick", function () {
      typing = true;
      dragging = false;
      input.classList.add("is-typing");
      input.focus();
      input.select();
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        input.blur();
      } else if (event.key === "Escape") {
        typing = false;
        input.classList.remove("is-typing");
        input.blur();
        callbacks.revert();
      }
    });

    input.addEventListener("blur", function () {
      if (!typing) {
        return;
      }
      typing = false;
      input.classList.remove("is-typing");
      var parsed = parseFloat(input.value);
      if (isNaN(parsed)) {
        callbacks.revert();
        return;
      }
      input.value = formatTransformNumber(clampValue(parsed), spec.decimals);
      callbacks.commit();
    });

    input.isBusy = function () {
      return dragging || typing;
    };
  }

  function rebuildTransformRows(layer) {
    transformState.rows = {};
    els.transformRows.innerHTML = "";
    for (var i = 0; i < TRANSFORM_SPEC.length; i += 1) {
      var spec = TRANSFORM_SPEC[i];
      var entry = layer.props[spec.name];
      if (!entry) {
        continue;
      }
      els.transformRows.appendChild(buildTransformRow(spec, entry.values.length));
    }
  }

  function updateTransformValues(layer) {
    for (var i = 0; i < TRANSFORM_SPEC.length; i += 1) {
      var spec = TRANSFORM_SPEC[i];
      var entry = layer.props[spec.name];
      var row = transformState.rows[spec.name];
      if (!entry || !row) {
        continue;
      }
      row.stopwatch.classList.toggle("is-animated", !!entry.animated);
      row.stopwatch.classList.toggle("is-keyed", !!entry.keyedNow);
      for (var j = 0; j < row.inputs.length; j += 1) {
        var input = row.inputs[j];
        // Never overwrite a field the user is currently dragging or
        // typing into.
        if (input.isBusy && input.isBusy()) {
          continue;
        }
        input.value = formatTransformNumber(entry.values[j], spec.decimals);
      }
    }
  }

  function refreshTransform(force) {
    if (transformState.busy && !force) {
      return;
    }
    // See TRANSFORM_TEXT_POLL_DIVISOR above -- while a text layer is the
    // selection, most ticks skip the full read entirely (no evalScript
    // call at all) instead of hitting AE's main thread every 700ms while
    // the user might be mid-keystroke in that same layer's viewport edit.
    // The first tick after selecting a text layer still reads at full
    // speed (selectionIsText is only set from a previous read), so the
    // section fills promptly and only then throttles.
    if (!force && selectionIsText) {
      transformState.skipCounter += 1;
      if (transformState.skipCounter < TRANSFORM_TEXT_POLL_DIVISOR) {
        return;
      }
      transformState.skipCounter = 0;
    } else {
      transformState.skipCounter = 0;
    }
    hostCall("readLayerTransform", [], function (result) {
      if (!result.ok) {
        return;
      }
      selectionIsText = !!(result.layer && result.layer.isText);
      if (!result.layer) {
        els.transformEmpty.hidden = false;
        els.transformRows.hidden = true;
        transformState.signature = null;
        transformState.rows = {};
        els.transformRows.innerHTML = "";
        return;
      }
      els.transformEmpty.hidden = true;
      els.transformRows.hidden = false;

      var signature = layerSignature(result.layer);
      if (signature !== transformState.signature) {
        transformState.signature = signature;
        rebuildTransformRows(result.layer);
      }
      updateTransformValues(result.layer);
    });
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb.length < 3) {
      return "#ffffff";
    }
    function byte(component) {
      var v = Math.round(clamp(Number(component) || 0, 0, 1) * 255).toString(16);
      return v.length === 1 ? "0" + v : v;
    }
    return "#" + byte(rgb[0]) + byte(rgb[1]) + byte(rgb[2]);
  }

  // ---------------------------------------------------------------
  // A smaller, search-less sibling of the font picker: a plain list of
  // fixed {value, label} options with a dot marking whichever one is
  // currently active. Reuses the same .fp-popover/.fp-list/.fp-item CSS
  // as the font picker (only .fp-item-dot is new) so it matches the rest
  // of the panel's popovers without inventing new visual language.
  // ---------------------------------------------------------------

  var choicePicker = null;

  function buildChoicePicker() {
    var root = document.createElement("div");
    root.className = "fp-popover";
    root.hidden = true;
    var list = document.createElement("div");
    list.className = "fp-list";
    root.appendChild(list);
    document.body.appendChild(root);

    var picker = { root: root, list: list, onPick: null };

    picker.setOptions = function (options, selectedValue) {
      list.innerHTML = "";
      for (var i = 0; i < options.length; i += 1) {
        (function (option) {
          var item = document.createElement("button");
          item.type = "button";
          item.className = "fp-item" + (option.value === selectedValue ? " is-selected" : "");
          var dot = document.createElement("span");
          dot.className = "fp-item-dot";
          item.appendChild(dot);
          var label = document.createElement("span");
          label.textContent = option.label;
          item.appendChild(label);
          item.addEventListener("click", function (event) {
            var onPick = picker.onPick;
            closeChoicePicker();
            if (onPick) {
              // Second argument is the raw click event -- most callers
              // (Save/Export category pickers) ignore it entirely, but
              // Delete reads event.shiftKey off it to tell "delete the
              // presets in this topic" (plain click) apart from "delete
              // the topic itself" (shift+click). Kept generic here
              // rather than a Delete-only picker variant, since any
              // future modifier-aware picker gets it for free.
              onPick(option.value, event);
            }
          });
          list.appendChild(item);
        }(options[i]));
      }
    };

    root.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    return picker;
  }

  function closeChoicePicker() {
    if (choicePicker) {
      choicePicker.root.hidden = true;
      choicePicker.onPick = null;
    }
  }

  function openChoicePicker(trigger, options, selectedValue, onPick) {
    if (!choicePicker) {
      choicePicker = buildChoicePicker();
    }
    choicePicker.setOptions(options, selectedValue);
    choicePicker.onPick = onPick;

    var rect = trigger.getBoundingClientRect();
    choicePicker.root.hidden = false;
    var width = choicePicker.root.offsetWidth || 180;
    var height = choicePicker.root.offsetHeight || 200;
    var left = Math.min(rect.left, window.innerWidth - width - 8);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight) {
      top = Math.max(6, rect.top - height - 6);
    }
    choicePicker.root.style.left = Math.max(6, left) + "px";
    choicePicker.root.style.top = top + "px";
  }

  function resetTransform() {
    hostCall("resetLayerTransform", [], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      setStatus("Transform reset.", "success");
      refreshTransform(true);
    });
  }

  function runUtility(action) {
    hostCall("keyframeUtility", [action], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      var layerNote = typeof result.layers === "number" ? " across " + result.layers + " layer" + (result.layers === 1 ? "" : "s") : "";
      var skippedNote = result.skipped ? " (" + result.skipped + " layer" + (result.skipped === 1 ? "" : "s") + " skipped)" : "";
      setStatus(action + " applied to " + result.changed + " keyframe(s)" + layerNote + "." + skippedNote, "success");
    });
  }

  // compFrame (Shift+click): the anchor goes to that point of the comp
  // frame instead of the layer's bounds; the layer stays where it is.
  function applyAnchorPreset(fx, fy, compFrame) {
    hostCall("setAnchorPreset", [{ fx: fx, fy: fy, compFrame: !!compFrame }], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      var skippedNote = result.skipped ? " (" + result.skipped + " layer" + (result.skipped === 1 ? "" : "s") + " skipped: " + result.skipReason + ")" : "";
      var whereNote = result.compFrame ? " to the comp frame" : "";
      setStatus("Anchor point moved" + whereNote + " on " + result.changed + " layer" + (result.changed === 1 ? "" : "s") + ", position compensated." + skippedNote, "success");
    });
  }

  function applyCurve() {
    var inInfluence = influenceValue(els.inValue, 64);
    var outInfluence = influenceValue(els.outValue, 64);
    var payload = {
      samples: profileSamples(),
      inInfluence: inInfluence,
      outInfluence: outInfluence,
      mode: velocity.mode
    };
    hostCall("applyVelocityProfile", [JSON.stringify(payload)], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      var skipped = result.skipped ? " (" + result.skipped + " skipped)" : "";
      setStatus("Velocity applied to " + result.changed + " keyframe(s)." + skipped, "success");
    });
  }

  // ---------------------------------------------------------------
  // Colour picker
  //
  // The implementation now lives in shared-core.js (window.MF) so the
  // satellite windows (palette.js, ...) use the exact same picker.
  // ---------------------------------------------------------------

  var cpApi = window.MF.initColorPicker({
    hostCall: hostCall,
    setStatus: setStatus
  });
  var openColorPicker = cpApi.open;
  var closeColorPicker = cpApi.close;
  var createColorSwatch = cpApi.createSwatch;

  document.addEventListener("click", function () {
    closeColorPicker();
    closeChoicePicker();
    // Function declarations are hoisted, so these are callable here even
    // though they're defined further down the file (Captions tab code).
    closeOptionPicker();
    closeNamePopover();
  });

  function createLayer(hostFunction, args, successLabel) {
    hostCall(hostFunction, args || [], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      var extra = result.compCentre ? " at comp centre" : "";
      extra += result.parented ? " · " + result.parented + " layer(s) parented" : "";
      extra += result.nullParent ? " · null follows “" + result.nullParent + "”" : "";
      extra += result.threeD ? " · 3D" : "";
      // Temporary diagnostic for the "null overshoots the end" report --
      // shows exactly what was requested vs. what AE actually stored,
      // in frames, plus each source layer's own range. Remove once the
      // cause is confirmed.
      if (result.diag) {
        var d = result.diag;
        var fd = d.frameDuration || 1;
        var toFrames = function (seconds) { return (seconds / fd).toFixed(2); };
        var layerNotes = [];
        for (var i = 0; i < d.layers.length; i += 1) {
          layerNotes.push(d.layers[i].name + " " + toFrames(d.layers[i].inPoint) + "-" + toFrames(d.layers[i].outPoint) + "f");
        }
        extra += " · requested " + toFrames(d.requestedIn) + "-" + toFrames(d.requestedOut) +
          "f, AE stored " + toFrames(d.createdIn) + "-" + toFrames(d.createdOut) +
          "f (" + layerNotes.join(", ") + ")";
      }
      setStatus(successLabel + ' "' + result.name + '" created.' + extra, "success");
      refreshTransform(true);
    });
  }

  // Push the current theme into the shared ExtendScript global so the
  // Colour Palette satellite window can follow it (see host.jsx
  // setSharedTheme / palette.js). Cheap, fire-and-forget.
  function publishTheme() {
    var accent = localStorage.getItem("motionfilm-accent") || window.MF.color.DEFAULT_ACCENT;
    var panel = localStorage.getItem("motionfilm-panel") || "#212121";
    hostCall("setSharedTheme", [JSON.stringify({ accent: accent, panel: panel })], function () {});
  }

  // ---------------------------------------------------------------
  // "MF - Camadas" satellite: a toggle in the settings popover that
  // moves the three footer layer buttons (Null / Adjustment / Solid)
  // out to the separate com.motionfilm.layers window. The main panel is
  // the sole owner of the setting -- cached to localStorage for instant
  // first paint, and pushed to host.jsx's shared global (per AE session)
  // so the satellite can read it to know whether to show its buttons.
  // ---------------------------------------------------------------
  var AUX_LAYERS_KEY = "motionfilm-aux-layers";
  var auxLayersEnabled = false;

  function applyAuxLayersUI() {
    var toggle = $("aux-layers-toggle");
    if (toggle) {
      toggle.setAttribute("aria-checked", auxLayersEnabled ? "true" : "false");
    }
    var homeFooter = document.querySelector("#page-home > .footer");
    if (homeFooter) {
      homeFooter.hidden = auxLayersEnabled;
    }
  }

  function pushAuxLayers() {
    hostCall("setAuxLayersEnabled", [{ enabled: auxLayersEnabled }], function () {});
  }

  function updateAuxLayersState(enabled, persist) {
    auxLayersEnabled = !!enabled;
    if (persist) {
      try {
        localStorage.setItem(AUX_LAYERS_KEY, auxLayersEnabled ? "1" : "0");
      } catch (writeError) {
        // Non-fatal -- just won't survive a reload.
      }
    }
    applyAuxLayersUI();
  }

  function initAuxLayers() {
    try {
      auxLayersEnabled = localStorage.getItem(AUX_LAYERS_KEY) === "1";
    } catch (readError) {
      auxLayersEnabled = false;
    }
    applyAuxLayersUI();
    // Re-seed the shared global -- it is per-AE-session, so after a
    // restart this panel's cached value is the source of truth.
    pushAuxLayers();

    var toggle = $("aux-layers-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        updateAuxLayersState(!auxLayersEnabled, true);
        pushAuxLayers();
        setStatus(
          auxLayersEnabled
            ? "Botões de camada movidos para a janela “MF - Camadas”."
            : "Botões de camada de volta no painel principal.",
          "success"
        );
      });
    }
  }

  // ---------------------------------------------------------------
  // Null marker size (Settings). host.jsx owns the value, in AE's own
  // preferences, so it survives restarts and the "MF - Camadas" window
  // uses the same size; this field only reads it at load and writes it
  // back when edited. AE prefs don't carry over to a new AE version, so
  // the value is also kept in localStorage (= Documents settings.json,
  // see shared-core.js) and re-seeded into AE when its prefs lack it.
  // ---------------------------------------------------------------
  var NULL_SIZE_KEY = "motionfilm-null-size";

  function initNullMarkerSize() {
    var input = $("null-marker-size");
    if (!input) {
      return;
    }
    hostCall("getNullMarkerSize", [], function (result) {
      if (!result || !result.ok) {
        return;
      }
      var backup = parseFloat(localStorage.getItem(NULL_SIZE_KEY));
      if (!result.saved && !isNaN(backup)) {
        hostCall("setNullMarkerSize", [{ size: backup }], function (seeded) {
          if (seeded && seeded.ok) {
            input.value = String(seeded.size);
          }
        });
        input.value = String(backup);
        return;
      }
      input.value = String(result.size);
      if (result.saved) {
        localStorage.setItem(NULL_SIZE_KEY, String(result.size));
      }
    });
    function commit() {
      var size = parseFloat(input.value);
      if (isNaN(size)) {
        return;
      }
      hostCall("setNullMarkerSize", [{ size: size }], function (result) {
        if (!result || !result.ok) {
          setStatus((result && result.error) || "Could not save the null size.", "error");
          return;
        }
        input.value = String(result.size);
        localStorage.setItem(NULL_SIZE_KEY, String(result.size));
        setStatus("Null size set to " + result.size + " px.", "success");
      });
    }
    input.addEventListener("change", commit);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        input.blur();
      }
    });
  }

  function setupAppearance() {
    var accentHex = localStorage.getItem("motionfilm-accent") || window.MF.color.DEFAULT_ACCENT;
    var panelHex = localStorage.getItem("motionfilm-panel") || "#212121";

    function applyAccent(hex, persist) {
      window.MF.color.applyAccent(document.documentElement.style, hex);
      if (persist) {
        localStorage.setItem("motionfilm-accent", hex);
        publishTheme();
      }
      drawCurve();
    }

    function applyPanel(hex, persist) {
      // Derive the whole --panel* family (cards, rows, wells) from the one
      // picked colour so every box tracks the background -- a step lighter
      // for raised surfaces, a step darker for recessed wells.
      window.MF.color.applyPanelShades(document.documentElement.style, hex);
      if (persist) {
        localStorage.setItem("motionfilm-panel", hex);
        publishTheme();
      }
    }

    applyAccent(accentHex, false);
    applyPanel(panelHex, false);
    publishTheme();

    var accentSwatch = createColorSwatch(accentHex, function (hex) {
      applyAccent(hex, true);
    });
    var panelSwatch = createColorSwatch(panelHex, function (hex) {
      applyPanel(hex, true);
    });
    var accentWrap = $("accent-color-wrap");
    var panelWrap = $("panel-color-wrap");
    if (accentWrap) { accentWrap.appendChild(accentSwatch); }
    if (panelWrap) { panelWrap.appendChild(panelSwatch); }

    els.resetSettings.addEventListener("click", function () {
      localStorage.removeItem("motionfilm-accent");
      localStorage.removeItem("motionfilm-panel");
      window.MF.color.applyAccent(document.documentElement.style, window.MF.color.DEFAULT_ACCENT);
      window.MF.color.applyPanelShades(document.documentElement.style, "#212121");
      accentSwatch.setHex(window.MF.color.DEFAULT_ACCENT);
      panelSwatch.setHex("#212121");
      publishTheme();
      drawCurve();
    });
  }

  // ---------------------------------------------------------------
  // Collapsible "folder tab" sections: each .section has a .section-tab
  // (the clickable label) and a .section-body (the content underneath).
  // Clicking a tab collapses/expands that section independently of the
  // others -- there's no accordion behaviour linking them.
  //
  // The resting expanded state never carries an inline max-height (left
  // at the CSS default of `none`), only the collapse/expand animation
  // itself does, cleared again once it finishes. This matters because
  // three of these sections also toggle a plain `hidden` attribute
  // elsewhere (shown/hidden depending on the selected layer's type): a
  // hidden section renders at zero height, so if the resting state were
  // some remembered pixel height captured while hidden, the section
  // would incorrectly stay clamped to that once it became visible again.
  // ---------------------------------------------------------------

  function setSectionCollapsed(section, collapsed, instant) {
    var tab = section.querySelector(".section-tab");
    var body = section.querySelector(".section-body");
    if (!tab || !body) {
      return;
    }
    if (instant) {
      section.classList.add("no-transition");
    }
    if (collapsed) {
      body.style.maxHeight = body.scrollHeight + "px";
      void body.offsetHeight; // Force layout so the browser has a starting point to animate from.
      section.classList.add("is-collapsed");
      body.style.maxHeight = "0px";
    } else {
      section.classList.remove("is-collapsed");
      body.style.maxHeight = body.scrollHeight + "px";
    }
    tab.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (instant) {
      void section.offsetHeight;
      section.classList.remove("no-transition");
    }
  }

  function initCollapsibleSections() {
    var sections = document.querySelectorAll("main > .section[data-section-id]");
    for (var i = 0; i < sections.length; i += 1) {
      (function (section) {
        var tab = section.querySelector(".section-tab");
        var body = section.querySelector(".section-body");
        if (!tab || !body) {
          return;
        }
        var storageKey = "motionfilm-collapsed-" + section.getAttribute("data-section-id");
        var collapsed = localStorage.getItem(storageKey) === "1";
        if (collapsed) {
          // Not routed through setSectionCollapsed: that measures
          // body.scrollHeight first to animate from, but three of these
          // sections start out `hidden` (shown later depending on the
          // selected layer), and a hidden element's scrollHeight is 0 --
          // measuring it here would freeze the wrong starting height for
          // whenever the section eventually becomes visible. Init just
          // needs the settled end state, no animation, so it goes
          // straight to max-height: 0.
          section.classList.add("no-transition");
          section.classList.add("is-collapsed");
          body.style.maxHeight = "0px";
          tab.setAttribute("aria-expanded", "false");
          void section.offsetHeight;
          section.classList.remove("no-transition");
        }

        // Once an expand animation finishes, drop the inline max-height
        // instead of leaving it pinned to whatever height was measured
        // at click time -- otherwise later content changes (a different
        // layer's fields rebuilding, say) could get clipped or leave a
        // stale gap.
        body.addEventListener("transitionend", function (event) {
          if (event.propertyName === "max-height" && !section.classList.contains("is-collapsed")) {
            body.style.maxHeight = "none";
          }
        });

        function toggle() {
          setSectionCollapsed(section, !section.classList.contains("is-collapsed"), false);
          localStorage.setItem(storageKey, section.classList.contains("is-collapsed") ? "1" : "0");
        }

        tab.addEventListener("click", function (event) {
          // Let the section's own controls (Auto Leading-style toggles,
          // the text stopwatch, "Reset") work normally instead of also
          // collapsing the section they live in.
          if (event.target.closest("button, a")) {
            return;
          }
          toggle();
        });
        tab.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            toggle();
          }
        });
      }(sections[i]));
    }
  }

  // ---------------------------------------------------------------
  // Page tabs (Home / Text): switching swaps the whole screen -- only
  // the active .page is shown -- rather than overlaying a side panel.
  // Home is every existing tool; Text is the new character-reveal tool.
  // ---------------------------------------------------------------

  // Only the active tab shows its label (see .page-tab-label in
  // styles.css) -- switching tabs changes every button's width in one
  // synchronous, un-animated snap (CSS transitions on width/
  // grid-template-columns were tried first and both looked janky in
  // this CEP build's Chromium: those are layout-affecting properties,
  // so the browser has to re-run layout on every frame of the
  // transition, and confirmed live here that grid-template-columns
  // with fr units doesn't even interpolate at all in this engine --
  // getComputedStyle read the exact same final value from the very
  // first sampled frame, no in-between steps). This is the standard
  // FLIP technique instead: read every tab's position BEFORE the width
  // snap (First), let the snap happen instantly (Last), then read the
  // new positions and give each tab a transform offsetting it back to
  // where it visually WAS (Invert) with transitions disabled, then on
  // the next frame re-enable the transition and animate that transform
  // back to zero (Play). transform is compositor-only -- no layout
  // recalculation per frame -- so it stays smooth regardless of how old
  // or busy the host's rendering engine is.
  function animateTabLayoutChange(tabButtons, applyChanges) {
    var before = [];
    for (var i = 0; i < tabButtons.length; i += 1) {
      before.push(tabButtons[i].getBoundingClientRect().left);
    }

    applyChanges();

    for (var j = 0; j < tabButtons.length; j += 1) {
      var delta = before[j] - tabButtons[j].getBoundingClientRect().left;
      if (delta) {
        tabButtons[j].style.transition = "none";
        tabButtons[j].style.transform = "translateX(" + delta + "px)";
      }
    }
    // Force layout to flush so the no-transition starting position above
    // is actually committed before switching to the real transition --
    // otherwise the browser could coalesce both style changes into one
    // paint and skip the animation entirely.
    void document.body.offsetHeight;
    for (var k = 0; k < tabButtons.length; k += 1) {
      tabButtons[k].style.transition = "transform .32s cubic-bezier(.22,.68,.24,1)";
      tabButtons[k].style.transform = "";
    }
    window.setTimeout(function () {
      for (var m = 0; m < tabButtons.length; m += 1) {
        tabButtons[m].style.transition = "";
      }
    }, 340);
  }

  function initPageTabs() {
    var tabButtons = document.querySelectorAll(".page-tab");
    var pages = document.querySelectorAll(".page");
    for (var i = 0; i < tabButtons.length; i += 1) {
      tabButtons[i].addEventListener("click", function () {
        var clicked = this;
        animateTabLayoutChange(tabButtons, function () {
          var targetPage = "page-" + clicked.getAttribute("data-page");
          for (var j = 0; j < tabButtons.length; j += 1) {
            var isActive = tabButtons[j] === clicked;
            tabButtons[j].classList.toggle("is-active", isActive);
            tabButtons[j].setAttribute("aria-selected", isActive ? "true" : "false");
          }
          for (var k = 0; k < pages.length; k += 1) {
            pages[k].hidden = pages[k].id !== targetPage;
          }
          if (targetPage === "page-effects") {
            // refreshEffectsManager() otherwise only runs from the 700ms
            // poll and skips entirely while the tab is hidden -- without
            // this, switching to it would show stale/empty content for
            // up to 700ms. Function declarations are hoisted, so this
            // is callable here despite being defined further down.
            refreshEffectsManager(true);
          }
          if (targetPage !== "page-kit" && (kitDeleteMode || kitExportMode)) {
            // Leaving the Kit tab always cancels an armed delete/export
            // mode -- otherwise coming back later could land straight in
            // a state where a stray hold/click on any tile deletes or
            // exports it, with no reminder of why.
            kitDeleteMode = false;
            kitExportMode = false;
            renderKitPresets();
          }
        });
      });
    }
  }

  // ---------------------------------------------------------------
  // Kit tab: a category rail (left) + a preview grid (right) of ready-
  // made presets. Each preset's "preview" is a small looping CSS
  // animation, not a real AE render -- there's no way to preview actual
  // After Effects motion from inside this panel, so this is a visual
  // stand-in that communicates the shape of what clicking the tile will
  // do. Applying a preset is a single hostCall carrying the preset's id;
  // host.jsx (applyKitPreset) owns what each id actually does to the
  // selected layer(s).
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Pack library ON DISK (v0.9.7, replaces the old localStorage store).
  // The Kit tab is a library the user builds: save layers or a whole comp
  // from one project, apply it in any other project, on any machine,
  // without depending on the original media still existing. So every pack
  // is a self-contained folder holding COPIES of everything it uses:
  //
  //   Documents/Mótion Film Packs/
  //     library.json          { version, categories: [...] }  (order of the rail)
  //     packs/<id>/meta.json  { id, kind, category, label, createdAt, ... }
  //                           small -- the only file read to list the grid
  //     packs/<id>/data.json  the capture (layer templates / whole comp)
  //     packs/<id>/preview.mp4, preview.jpg
  //     packs/<id>/assets/    copies of every image/video/audio/PSD/AI...
  //
  // In Documents, NOT inside the extension folder: reinstalling/updating
  // the extension replaces its folder (the installer deletes it) and
  // would wipe the whole library. Deleting a pack deletes its folder --
  // media included. Applying a pack copies its media next to the target
  // project first (see kitApplyPack), so a project never points into the
  // library and deleting a pack later can't break it.
  // ---------------------------------------------------------------

  // Default rail for a brand new library (no library.json yet).
  var KIT_CATEGORIES = ["Packs"];
  var KIT_LIBRARY_DIRNAME = "Mótion Film Packs";
  var kitLibraryCache = null;
  var kitPacksCache = null;

  function kitDocumentsDir() {
    var path = nodeRequire("path");
    try {
      var raw = window.__adobe_cep__.getSystemPath("myDocuments");
      var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
      if (p && !/^[A-Za-z]:/.test(p)) {
        p = "/" + p; // macOS
      }
      if (p) {
        return path.normalize(p);
      }
    } catch (docsError) {}
    return path.join(nodeRequire("os").homedir(), "Documents");
  }

  function kitLibraryDir() {
    return nodeRequire("path").join(kitDocumentsDir(), KIT_LIBRARY_DIRNAME);
  }

  function kitPacksDir() {
    return nodeRequire("path").join(kitLibraryDir(), "packs");
  }

  function kitPackDir(id) {
    return nodeRequire("path").join(kitPacksDir(), String(id));
  }

  // file:/// URL for <img>/<video> src (spaces, accents, # and ? escaped).
  function kitFileUrl(p) {
    // macOS paths already start with "/" -- drop it so the URL stays
    // file:///Users/... and not file:////Users/...
    return "file:///" + encodeURI(String(p).replace(/\\/g, "/").replace(/^\/+/, "")).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  function kitReadJsonFile(p, fallback) {
    try {
      return JSON.parse(nodeRequire("fs").readFileSync(p, "utf8"));
    } catch (readError) {
      return fallback;
    }
  }

  // Write to a temp name, then rename -- a crash mid-write never leaves a
  // half-written meta/data/library file behind.
  function kitWriteJsonFile(p, obj) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    var tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
    fs.renameSync(tmp, p);
  }

  function kitLoadLibrary() {
    if (kitLibraryCache) {
      return kitLibraryCache;
    }
    var path = nodeRequire("path");
    var lib = kitReadJsonFile(path.join(kitLibraryDir(), "library.json"), null);
    if (!lib || !Array.isArray(lib.categories)) {
      lib = { version: 1, categories: KIT_CATEGORIES.slice() };
      try {
        kitWriteJsonFile(path.join(kitLibraryDir(), "library.json"), lib);
      } catch (writeError) {}
    }
    kitLibraryCache = lib;
    return lib;
  }

  function kitSaveLibrary() {
    try {
      kitWriteJsonFile(nodeRequire("path").join(kitLibraryDir(), "library.json"), kitLoadLibrary());
    } catch (writeError) {
      setStatus("Couldn't save the pack library: " + writeError, "error");
    }
  }

  // Rescans packs/ (meta.json only). Called on load and after any change.
  // A pack folder copied in by hand shows up too.
  function kitRefreshPacks() {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var list = [];
    try {
      fs.readdirSync(kitPacksDir()).forEach(function (name) {
        var meta = kitReadJsonFile(path.join(kitPacksDir(), name, "meta.json"), null);
        if (meta && meta.kind) {
          meta.id = name; // the folder name is the id
          list.push(meta);
        }
      });
    } catch (scanError) {
      // No packs/ yet -- empty library.
    }
    list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    kitPacksCache = list;
    return list;
  }

  // Every category the rail shows: the library's own ordered list, plus
  // any category a pack names that isn't in it (e.g. a pack folder copied
  // in by hand) -- a pack always has somewhere visible to live.
  function getAllKitCategories() {
    var categories = kitLoadLibrary().categories.slice();
    (kitPacksCache || kitRefreshPacks()).forEach(function (p) {
      if (p.category && categories.indexOf(p.category) === -1) {
        categories.push(p.category);
      }
    });
    return categories;
  }

  function kitEnsureCategory(category) {
    var lib = kitLoadLibrary();
    if (lib.categories.indexOf(category) === -1) {
      lib.categories.push(category);
      kitSaveLibrary();
    }
  }

  // Deletes a pack's folder -- data, preview AND every copied media file
  // (user request: deleting a pack must free its media on disk too).
  // The tile's <video> may still hold preview.mp4 open, so the grid
  // releases it first and rmSync retries on Windows' EBUSY.
  function kitDeletePackFiles(id) {
    var fs = nodeRequire("fs");
    var dir = kitPackDir(id);
    var videos = document.querySelectorAll('.kit-preset-video[data-pack="' + String(id).replace(/"/g, "") + '"]');
    for (var i = 0; i < videos.length; i += 1) {
      try { videos[i].removeAttribute("src"); videos[i].load(); } catch (releaseError) {}
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
      return true;
    } catch (rmError) {
      return !fs.existsSync(dir);
    }
  }

  // Deletes a whole topic (Shift+click on its name in the Delete picker)
  // plus every pack filed under it -- folders and media included.
  function deleteKitCategory(category) {
    var lib = kitLoadLibrary();
    lib.categories = lib.categories.filter(function (c) { return c !== category; });
    kitSaveLibrary();
    var toRemove = (kitPacksCache || kitRefreshPacks()).filter(function (p) {
      return p.category === category;
    });
    var failed = 0;
    toRemove.forEach(function (p) {
      if (!kitDeletePackFiles(p.id)) { failed += 1; }
    });
    kitRefreshPacks();
    if (kitState.category === category) {
      kitState.category = getAllKitCategories()[0] || "";
    }
    kitDeleteMode = false;
    kitExportMode = false;
    renderKitCategories();
    renderKitPresets();
    var presetNote = toRemove.length ? " and " + toRemove.length + " pack" + (toRemove.length === 1 ? "" : "s") + " in it" : "";
    setStatus(failed ? "Deleted “" + category + "”, but " + failed + " pack folder(s) are in use -- close AE and delete them in " + kitPacksDir() : "Deleted “" + category + "”" + presetNote + ".", failed ? "error" : "success");
  }

  // Curated, ship-with-the-extension presets go here (kind "modify" --
  // the default, applies onto whatever's selected via
  // KIT_PRESET_HANDLERS in host.jsx -- or kind "layers"/"comp", looked
  // up by id in KIT_LAYER_GROUP_PRESETS). Empty for now: the two that
  // used to live here ("Fade In"/"Duo Intro") were test presets, removed
  // at the user's request now that real ones get saved directly through
  // the footer's "Preset layers"/"Preset comp" buttons (getAllKitPresets
  // below merges those in from localStorage alongside whatever's here).
  var KIT_PRESETS = [];

  // getAllKitCategories()[0] rather than the bare KIT_CATEGORIES[0] --
  // if the user already deleted "Text reveal" (any built-in topic is
  // deletable now, see deleteKitCategory), this needs to land on
  // whatever topic is ACTUALLY first, not one that's been hidden.
  var kitState = { category: getAllKitCategories()[0] || "" };

  // Armed by the footer's "Delete preset" button (see initKitSaveTools):
  // while true, tiles stop applying on click and instead delete on a
  // 3-second left-button hold (see renderKitPresets) -- only for
  // user-saved presets, never the built-in ones.
  var kitDeleteMode = false;

  // Armed by the footer's "Export preset" button (see initKitSaveTools):
  // while true, tiles stop applying on click and instead export on a
  // plain click (see renderKitPresets) -- same scoping as delete mode
  // (user-saved presets only), but a single click is enough since
  // exporting isn't destructive the way deleting is.
  var kitExportMode = false;

  // ---------------------------------------------------------------
  // User-saved packs -- listed from the on-disk library (see the "Pack
  // library ON DISK" block above). Each entry is a pack's meta.json:
  // { id, kind: "layers"|"comp", category, label, createdAt, ... }; the
  // heavy capture (data.json) is only read when applying/exporting.
  // ---------------------------------------------------------------

  function loadKitCustomPresets() {
    return kitPacksCache || kitRefreshPacks();
  }

  // Merges the curated, ship-with-the-extension presets (KIT_PRESETS)
  // with the user's packs, into the one shape renderKitPresets needs.
  function getAllKitPresets() {
    var all = KIT_PRESETS.slice();
    var custom = loadKitCustomPresets();
    for (var i = 0; i < custom.length; i += 1) {
      var c = custom[i];
      all.push({
        id: c.id,
        category: c.category,
        label: c.label,
        previewClass: c.kind === "comp" ? "kit-anim-comp-insert" : "kit-anim-fade-in",
        kind: c.kind,
        custom: true,
        meta: c
      });
    }
    return all;
  }

  function renderKitCategories() {
    var root = $("kit-categories");
    if (!root) {
      return;
    }
    root.innerHTML = "";
    var categories = getAllKitCategories();
    for (var i = 0; i < categories.length; i += 1) {
      (function (category) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "kit-category" + (category === kitState.category ? " is-active" : "");
        btn.textContent = category;
        btn.addEventListener("click", function () {
          // Picking a category from the sidebar always means "just
          // browsing" -- cancel delete/export mode (armed by the
          // footer's Delete preset/Export preset buttons, see
          // initKitSaveTools) even if it's the SAME category, so
          // those modes' visuals/behavior don't linger once the user
          // has clearly moved on.
          var wasDeleteMode = kitDeleteMode;
          var wasExportMode = kitExportMode;
          kitDeleteMode = false;
          kitExportMode = false;
          if (kitState.category === category) {
            if (wasDeleteMode || wasExportMode) {
              renderKitPresets();
            }
            return;
          }
          kitState.category = category;
          renderKitCategories();
          renderKitPresets();
        });
        root.appendChild(btn);
      }(categories[i]));
    }

    // "+" -- adds a new group, same name-only popover already used
    // elsewhere (openNamePopover). Appended after the last category
    // rather than styled as one of them, so it reads as an action, not
    // another group to click into.
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "kit-category-add";
    addBtn.title = "Add a new group";
    addBtn.setAttribute("aria-label", "Add a new group");
    addBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>';
    addBtn.addEventListener("click", function (event) {
      // Synchronous (no hostCall in between) -- needs to stop
      // propagation itself, same reasoning as the Delete preset button:
      // without it, the document-level "close every popover on any
      // click" listener would immediately close the one this click just opened.
      event.stopPropagation();
      openNamePopover(addBtn, "Group name", function (name) {
        if (getAllKitCategories().indexOf(name) !== -1) {
          setStatus("“" + name + "” already exists.", "error");
          return;
        }
        kitEnsureCategory(name);
        kitState.category = name;
        renderKitCategories();
        renderKitPresets();
        setStatus("Added “" + name + "”.", "success");
      });
    });
    root.appendChild(addBtn);
  }

  function renderKitPresets() {
    var root = $("kit-presets");
    if (!root) {
      return;
    }
    root.innerHTML = "";
    var allPresets = getAllKitPresets();
    var matches = [];
    for (var i = 0; i < allPresets.length; i += 1) {
      if (allPresets[i].category === kitState.category) {
        matches.push(allPresets[i]);
      }
    }
    if (!matches.length) {
      var empty = document.createElement("div");
      empty.className = "kit-empty";
      empty.textContent = "No presets in this category yet.";
      root.appendChild(empty);
      return;
    }
    for (var j = 0; j < matches.length; j += 1) {
      (function (preset) {
        var tile = document.createElement("button");
        tile.type = "button";
        tile.className = "kit-preset-tile";
        tile.title = preset.label;

        var preview = document.createElement("div");
        preview.className = "kit-preset-preview";
        var swatch = document.createElement("div");
        swatch.className = "kit-swatch " + preset.previewClass;
        preview.appendChild(swatch);

        // Real preview media, by naming convention -- assets/kit-previews/
        // <preset id>.jpg (poster, shown at rest) and .mp4 (plays on
        // hover, muted+looped). .mp4/H.264, not .webm: confirmed live
        // that an .mp4 rendered by AE's OWN "H.264 - Match Render
        // Settings" Output Module template plays back fine in this
        // panel's Chromium -- unlike the ffmpeg build bundled for the
        // Captions tab, whose own H.264 encoder (libopenh264, no
        // licensed AVC) doesn't play back reliably here; AE's encoder is
        // a different, standards-conformant one and isn't affected by
        // that limitation. generateKitPresetPreview (below) renders
        // these automatically right after a Kit preset is saved. Neither
        // file has to exist: a 404 just adds the matching no-thumb/
        // no-video class, which falls back to the CSS-animation swatch
        // above (see styles.css) instead of showing a broken image or
        // doing nothing on hover.
        // User packs: preview files live in the pack's own folder (see
        // the library block); ?t= busts Chromium's cache when a preview
        // gets re-rendered under the same path.
        var mediaBase = "assets/kit-previews/" + preset.id;
        var mediaQuery = "";
        if (preset.custom) {
          var packPath = nodeRequire("path");
          mediaBase = kitFileUrl(packPath.join(kitPackDir(preset.id), "preview"));
          mediaQuery = "?t=" + ((preset.meta && preset.meta.previewAt) || 0);
        }
        var thumb = document.createElement("img");
        thumb.className = "kit-preset-thumb";
        thumb.src = mediaBase + ".jpg" + mediaQuery;
        thumb.alt = "";
        thumb.loading = "lazy";
        thumb.addEventListener("error", function () {
          hasThumb = false;
          preview.classList.add("no-thumb");
        });

        var video = document.createElement("video");
        video.className = "kit-preset-video";
        video.setAttribute("data-pack", preset.id);
        video.src = mediaBase + ".mp4" + mediaQuery;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.addEventListener("error", function () {
          hasVideo = false;
          preview.classList.add("no-video");
        });

        var hasThumb = true;
        var hasVideo = true;
        // thumb painted first (underneath), video last (on top) -- the
        // poster now stays fully opaque unconditionally (see styles.css)
        // instead of being faded out while the video plays, so there's
        // no longer a transition window where both can end up
        // transparent at once (see the "goes gray on mouseleave" bug
        // this replaced: the crossfade between two independently-
        // animated opacities could momentarily -- or, on a slow/heavy
        // clip, not-so-momentarily -- leave neither one opaque,
        // revealing the plain dark .kit-preset-preview background).
        preview.appendChild(thumb);
        preview.appendChild(video);

        // Hover to play/pause -- straightforward in principle, but
        // video.play() is ASYNC (it returns a Promise that only settles
        // once playback actually starts) and video.pause() is not. A
        // fast enough mouseenter-then-mouseleave calls pause() while
        // the play() from that same enter is still in flight -- and on
        // top of that, moving the mouse on/off/on/off rapidly used to
        // fire a brand new currentTime=0 seek + play() on every single
        // enter, piling up several overlapping in-flight requests on
        // the same <video>. Confirmed by the user: doing that left the
        // tile stuck for good -- hovering it again afterward wouldn't
        // play it any more. playRequestPending below makes sure only
        // ONE play() request is ever in flight per tile; a mouseleave
        // that lands before it settles doesn't call pause() itself, it
        // just records that playback is no longer wanted (wantsPlaying)
        // and lets the pending request's own resolution reconcile that
        // once AE/Chromium actually gets around to it -- so pause()
        // only ever runs against a play() that has already settled, or
        // isn't in flight at all.
        var wantsPlaying = false;
        var playRequestPending = false;

        function startPlaying() {
          if (!hasVideo) {
            return;
          }
          wantsPlaying = true;
          preview.classList.add("is-playing");
          if (playRequestPending) {
            // A previous rapid hover's play() hasn't settled yet --
            // its own .then()/.catch() below already reconciles
            // against the latest wantsPlaying, so there's nothing to
            // do here except not pile on a second overlapping request.
            return;
          }
          try {
            video.currentTime = 0;
          } catch (seekError) {
            // Not loaded far enough yet to seek -- fine, play() below still starts it from wherever it can.
          }
          playRequestPending = true;
          var playPromise = video.play();
          var settle = function () {
            playRequestPending = false;
            if (!wantsPlaying) {
              // The mouse already left before this request actually
              // started playing -- catch up on the pause() that
              // mouseleave deliberately skipped.
              video.pause();
            }
          };
          if (playPromise && playPromise.then) {
            playPromise.then(settle).catch(settle);
          } else {
            settle();
          }
        }

        function stopPlaying() {
          wantsPlaying = false;
          preview.classList.remove("is-playing");
          if (!playRequestPending) {
            video.pause();
          }
          // else: leave it running until settle() above catches up --
          // pausing a <video> with an unsettled play() request is the
          // exact race that left it stuck.
        }

        tile.addEventListener("mouseenter", startPlaying);
        tile.addEventListener("mouseleave", stopPlaying);

        var label = document.createElement("span");
        label.className = "kit-preset-label";
        label.textContent = preset.label;

        tile.appendChild(preview);
        tile.appendChild(label);

        // Hold-to-delete: armed only in kitDeleteMode (footer's "Delete
        // preset" button, see initKitSaveTools) and only for a preset
        // the user actually saved themselves -- holding on a built-in
        // tile while in delete mode does nothing, on purpose, since
        // those aren't stored anywhere a delete could touch. 3 real
        // seconds of holding the left button down, not a click; the
        // label shakes (kitPresetShake, styles.css) as long as it's
        // held, and cancels cleanly (timer cleared, shake stops) on an
        // early release or the pointer leaving the tile.
        var deleteHoldTimer = null;
        function cancelDeleteHold() {
          if (deleteHoldTimer) {
            window.clearTimeout(deleteHoldTimer);
            deleteHoldTimer = null;
            tile.classList.remove("is-deleting-armed");
          }
        }
        tile.addEventListener("mousedown", function (event) {
          if (!kitDeleteMode || !preset.custom || event.button !== 0) {
            return;
          }
          event.preventDefault();
          tile.classList.add("is-deleting-armed");
          deleteHoldTimer = window.setTimeout(function () {
            deleteHoldTimer = null;
            tile.classList.remove("is-deleting-armed");
            var removed = kitDeletePackFiles(preset.id);
            kitRefreshPacks();
            kitDeleteMode = false;
            renderKitPresets();
            if (removed) {
              setStatus("Deleted “" + preset.label + "” and its media.", "success");
            } else {
              setStatus("Couldn't delete every file of “" + preset.label + "” (in use?). Folder: " + kitPackDir(preset.id), "error");
            }
          }, 3000);
        });
        tile.addEventListener("mouseup", cancelDeleteHold);
        tile.addEventListener("mouseleave", cancelDeleteHold);

        tile.addEventListener("click", function () {
          if (kitDeleteMode) {
            // Delete mode only ever acts on the 3-second hold above --
            // a plain click (release before the timer fires) must not
            // also apply/insert the preset.
            return;
          }
          if (kitExportMode) {
            // Same custom-only scoping as delete -- holding/clicking a
            // built-in tile in export mode does nothing, since there's
            // no saved data anywhere to build a file from.
            if (preset.custom) {
              kitExportPack(preset.meta);
            }
            return;
          }
          if (preset.custom) {
            kitApplyPack(preset.meta);
            return;
          }
          // Curated, built-in presets (none ship right now): kind "layers"
          // is looked up by id in KIT_LAYER_GROUP_PRESETS, anything else
          // paints onto the selection via KIT_PRESET_HANDLERS.
          var fn, args, isInsert;
          if (preset.kind === "layers") {
            isInsert = true;
            fn = "applyKitLayerGroupPreset";
            args = [preset.id];
          } else {
            fn = "applyKitPreset";
            args = [preset.id];
            isInsert = false;
          }
          hostCall(fn, args, function (result) {
            if (!result.ok) {
              setStatus(result.error, "error");
              return;
            }
            var verb = isInsert ? " inserted (" + result.applied + " layer(s))." : " applied to " + result.applied + " layer(s).";
            setStatus(preset.label + verb, "success");
          });
        });
        root.appendChild(tile);
      }(matches[j]));
    }
  }

  // ---------------------------------------------------------------
  // Kit tab footer: "Preset layers" / "Preset comp" -- save whatever's
  // captured as a new user preset. Two-step popover, in that order,
  // because picking "which group" is the part the user explicitly asked
  // for first; naming reuses the same openNamePopover already built for
  // Style Presets, so this doesn't need its own name-only widget.
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Saving a pack: capture (host writes the JSON straight to a temp
  // file -- a whole comp can be many MB, never sent as an evalScript
  // string) -> ask group + name -> new pack folder -> COPY every media
  // file it uses into packs/<id>/assets -> data.json/meta.json -> render
  // the preview. Async with a progress overlay, so copying big videos
  // never freezes the panel.
  // ---------------------------------------------------------------

  function kitHost(name, args) {
    return new Promise(function (resolve) {
      hostCall(name, args, resolve);
    });
  }

  function kitHostEval(expression) {
    return new Promise(function (resolve) {
      evalHost(expression, function (raw) { resolve(raw); });
    });
  }

  // Lets the UI breathe between file operations.
  function kitYield() {
    return new Promise(function (resolve) { window.setTimeout(resolve, 0); });
  }

  // Full-panel overlay with the spinner (#kit-render-overlay, the same
  // one the preview render uses). kitBusy(null) hides it.
  function kitBusy(text) {
    var overlay = $("kit-render-overlay");
    var label = document.querySelector(".kit-render-spinner-text");
    if (!overlay) {
      return;
    }
    if (text === null) {
      overlay.hidden = true;
      if (label) { label.textContent = "Rendering preview…"; }
      return;
    }
    var spinnerWrap = $("kit-render-spinner-wrap");
    if (spinnerWrap) { spinnerWrap.hidden = false; }
    if (label) { label.textContent = text; }
    overlay.hidden = false;
  }

  function kitSafeName(name) {
    var cleaned = String(name || "pack").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
    if (cleaned.length > 80) { cleaned = cleaned.substring(0, 80).replace(/\s+$/, ""); }
    return cleaned || "pack";
  }

  function kitEscapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // The layer-template array inside a capture, for either pack kind.
  function kitDataLayers(kind, data) {
    if (!data) { return []; }
    if (kind === "comp") { return (data.comp && data.comp.layers) || []; }
    return data.layers || [];
  }

  // Walks every layer template at any nesting depth -- a precomp layer's
  // avSource (kind:"comp", see captureKitCompFull in host.jsx) carries its
  // own `layers`. Calls visitFile(avSource) for every file-backed source.
  function walkKitAvSources(layers, visitFile) {
    if (!layers || !layers.length) {
      return;
    }
    layers.forEach(function (t) {
      var av = t && t.avSource;
      if (!av) {
        return;
      }
      if (av.kind === "file") {
        visitFile(av);
      } else if (av.kind === "comp" && av.layers) {
        walkKitAvSources(av.layers, visitFile);
      }
    });
  }

  // Drops each template's `preset` -- a backward-compat copy of its own
  // effects/textAnimators/transform that captureSingleLayerTemplate adds
  // for old style-preset readers. Packs never read it when the top-level
  // fields exist (and its layerInPoint === inPoint), and it doubled every
  // pack (481 KB -> ~250 KB) -- size AE then has to parse on apply.
  // Old templates that ONLY have `preset` keep it.
  function kitSlimLayers(layers) {
    (layers || []).forEach(function (t) {
      if (!t) {
        return;
      }
      if (t.preset && (t.transform || t.effects)) {
        delete t.preset;
      }
      if (t.avSource && t.avSource.kind === "comp") {
        kitSlimLayers(t.avSource.layers);
      }
    });
  }

  // Copies every media source of a capture into packs/<id>/assets and
  // records the relative path in avSource.assetFile (mutates `layers`).
  // - same file used by several layers -> copied once
  // - same file NAME from different folders -> renamed (foo_2.png)
  // - image sequence -> its own subfolder with every frame
  // - layer of a layered PSD/AI -> host saves exactly that layer as PNG
  async function kitCopyPackAssets(packId, layers, onProgress) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var assetsDir = path.join(kitPackDir(packId), "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    var list = [];
    walkKitAvSources(layers, function (av) { list.push(av); });
    var byKey = {};
    var used = {};
    var result = { copied: 0, failed: 0, bytes: 0, total: list.length, failedNames: [] };

    function uniqueName(name) {
      var ext = path.extname(name);
      var stem = name.slice(0, name.length - ext.length);
      var candidate = name;
      var n = 2;
      while (used[candidate.toLowerCase()]) {
        candidate = stem + "_" + n + ext;
        n += 1;
      }
      used[candidate.toLowerCase()] = true;
      return candidate;
    }

    for (var i = 0; i < list.length; i += 1) {
      var av = list[i];
      if (onProgress) { onProgress(i + 1, list.length, av.name); }
      await kitYield();
      var key = (av.bake ? "bake:" + av.itemId : String(av.originalPath || "").toLowerCase()) + (av.sequence ? "|seq" : "");
      if (byKey[key]) {
        av.assetFile = byKey[key].assetFile;
        if (byKey[key].baked) { av.baked = true; av.isStill = true; delete av.bake; }
        continue;
      }
      try {
        if (av.bake) {
          var pngName = uniqueName(kitSafeName(av.name) + ".png");
          // AE writes the PNG to an ASCII-only temp path (see
          // kitAsciiTempDir), Node moves it into the pack.
          var bakeTmp = path.join(await kitAsciiTempDir(), "mf_bake_" + Date.now() + "_" + i + ".png");
          var bake = await kitHost("kitBakeFootageItem", [av.itemId, bakeTmp.replace(/\\/g, "/")]);
          if (!bake || !bake.ok) {
            throw new Error((bake && bake.error) || "bake failed");
          }
          fs.copyFileSync(bakeTmp, path.join(assetsDir, pngName));
          try { fs.unlinkSync(bakeTmp); } catch (bakeCleanupError) {}
          av.assetFile = pngName;
          av.baked = true;
          av.isStill = true;
          delete av.bake;
        } else if (av.sequence) {
          var first = av.originalPath;
          var srcDir = path.dirname(first);
          var base = path.basename(first);
          var m = /^(.*?)(\d+)(\.[^.]+)$/.exec(base);
          var folder = uniqueName(kitSafeName(m ? (m[1].replace(/[_\-. ]+$/, "") || "sequence") : base));
          var destDir = path.join(assetsDir, folder);
          fs.mkdirSync(destDir, { recursive: true });
          var frames = [base];
          if (m) {
            var re = new RegExp("^" + kitEscapeRe(m[1]) + "\\d{" + m[2].length + "}" + kitEscapeRe(m[3]) + "$", "i");
            frames = fs.readdirSync(srcDir).filter(function (f) { return re.test(f); });
          }
          for (var f = 0; f < frames.length; f += 1) {
            await fs.promises.copyFile(path.join(srcDir, frames[f]), path.join(destDir, frames[f]));
            if (f % 20 === 0 && onProgress) { onProgress(i + 1, list.length, av.name + " (" + (f + 1) + "/" + frames.length + ")"); }
          }
          av.assetFile = folder + "/" + base;
        } else {
          var name = uniqueName(path.basename(av.originalPath));
          await fs.promises.copyFile(av.originalPath, path.join(assetsDir, name));
          av.assetFile = name;
        }
        try { result.bytes += fs.statSync(path.join(assetsDir, av.assetFile)).size; } catch (statError) {}
        byKey[key] = { assetFile: av.assetFile, baked: !!av.baked };
        result.copied += 1;
      } catch (copyError) {
        result.failed += 1;
        result.failedNames.push(av.name);
      }
    }
    return result;
  }

  // assetFile -> absolute absPath under `baseDir` for the host to import.
  // A source whose copy failed falls back to its original path.
  function kitResolveAbsPaths(layers, baseDir) {
    var path = nodeRequire("path");
    walkKitAvSources(layers, function (av) {
      if (av.assetFile) {
        av.absPath = path.join(baseDir, av.assetFile).replace(/\\/g, "/");
      } else if (av.originalPath) {
        av.absPath = av.originalPath;
      }
    });
  }

  // A folder whose path is plain ASCII, for files AE itself must WRITE
  // (render output, saveFrameToPng). Confirmed live: AE's output module
  // fails with "Can not create a file in directory C:\Users" when the
  // target path has accents ("Usuário", "Mótion Film Packs") -- it
  // truncates at the first non-ASCII character. Reading/importing such
  // paths is fine; only AE-side writes are affected. AE renders here,
  // Node (which handles any path) moves the file into the pack.
  var kitAsciiTempCache = null;
  function kitAsciiTempDir() {
    if (kitAsciiTempCache) {
      return Promise.resolve(kitAsciiTempCache);
    }
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var fs = nodeRequire("fs");
    var isAscii = function (p) { return /^[\x20-\x7e]*$/.test(p); };
    var tmp = os.tmpdir();
    function done(dir) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (mkdirError) {}
      kitAsciiTempCache = dir;
      return dir;
    }
    if (isAscii(tmp) || os.platform() !== "win32") {
      return Promise.resolve(done(tmp));
    }
    return toShortPath(tmp).then(function (shortPath) {
      if (shortPath && isAscii(shortPath) && fs.existsSync(shortPath)) {
        return done(shortPath);
      }
      throw new Error("no ascii short path");
    }).catch(function () {
      var pub = process.env && process.env.PUBLIC ? process.env.PUBLIC : "C:\\Users\\Public";
      return done(path.join(isAscii(pub) ? pub : "C:\\Users\\Public", "MotionFilmTemp"));
    });
  }

  function kitWriteTempJson(prefix, obj) {
    var path = nodeRequire("path");
    var p = path.join(nodeRequire("os").tmpdir(), prefix + Date.now() + "_" + Math.floor(Math.random() * 1e6) + ".json");
    nodeRequire("fs").writeFileSync(p, JSON.stringify(obj), "utf8");
    return p;
  }

  function kitStartSave(trigger, kind) {
    var path = nodeRequire("path");
    var tmp = path.join(nodeRequire("os").tmpdir(), "mf_pack_capture_" + Date.now() + ".json");
    kitBusy("Reading the selected layers…");
    hostCall("kitCaptureToFile", [kind, tmp.replace(/\\/g, "/")], function (res) {
      kitBusy(null);
      if (!res || !res.ok) {
        setStatus((res && res.error) || "Couldn't read what's selected.", "error");
        return;
      }
      if (res.avSkipped) {
        setStatus(res.avSkipped + " layer" + (res.avSkipped === 1 ? "" : "s") + " couldn't be read and " + (res.avSkipped === 1 ? "was" : "were") + " skipped.", "error");
      } else if (res.dependencies) {
        // A selected layer's parent / track matte wasn't selected -- it
        // rides along so the layer keeps its motion and cut-out.
        setStatus(res.dependencies + " parent/matte layer" + (res.dependencies === 1 ? "" : "s") + " the selection depends on " + (res.dependencies === 1 ? "was" : "were") + " included.", "success");
      }
      var options = getAllKitCategories().map(function (c) {
        return { value: c, label: c };
      });
      if (!options.length) {
        options = [{ value: KIT_CATEGORIES[0], label: KIT_CATEGORIES[0] }];
      }
      openChoicePicker(trigger, options, kitState.category, function (category) {
        openNamePopover(trigger, "Pack name", function (name) {
          kitCreatePack(kind, category, name, tmp, res);
        }, res.name || "");
      });
    });
  }

  async function kitCreatePack(kind, category, label, capturePath, summary) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var id = "pack-" + Date.now();
    var dir = kitPackDir(id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      var data = JSON.parse(fs.readFileSync(capturePath, "utf8"));
      var layers = kitDataLayers(kind, data);
      kitSlimLayers(layers);
      kitBusy("Copying media…");
      var copy = await kitCopyPackAssets(id, layers, function (i, n) {
        kitBusy("Copying media " + i + "/" + n + "…");
      });
      kitWriteJsonFile(path.join(dir, "data.json"), data);
      var meta = {
        id: id,
        kind: kind,
        category: category,
        label: label,
        createdAt: Date.now(),
        formatVersion: 2,
        compName: kind === "comp" ? label : null,
        sourceComp: summary.compName || null,
        selected: summary.selected,
        width: data.compWidth,
        height: data.compHeight,
        frameRate: data.compFrameRate,
        layers: summary.layers,
        media: copy.copied,
        mediaBytes: copy.bytes
      };
      kitWriteJsonFile(path.join(dir, "meta.json"), meta);
      try { fs.unlinkSync(capturePath); } catch (unlinkError) {}
      kitEnsureCategory(category);
      kitRefreshPacks();
      kitState.category = category;
      renderKitCategories();
      renderKitPresets();
      var missing = summary.sources ? summary.sources.missing : 0;
      if (copy.failed || missing) {
        var problems = [];
        if (copy.failed) { problems.push(copy.failed + " media file(s) couldn't be copied (" + copy.failedNames.slice(0, 3).join(", ") + ")"); }
        if (missing) { problems.push(missing + " media file(s) are missing in this project and were saved as placeholders"); }
        setStatus("Saved “" + label + "”, but " + problems.join("; ") + ".", "error");
      } else {
        setStatus("Saved “" + label + "”" + (copy.copied ? " with " + copy.copied + " media file" + (copy.copied === 1 ? "" : "s") : "") + " -- rendering preview…", "success");
      }
      generateKitPresetPreview(id, kind);
    } catch (saveError) {
      kitBusy(null);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (cleanupError) {}
      setStatus("Couldn't save the pack: " + saveError, "error");
    }
  }

  // Recursive copy that skips files already there with the same size --
  // applying the same pack twice in one project copies nothing new.
  async function kitCopyDir(src, dest, onFile) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    fs.mkdirSync(dest, { recursive: true });
    var entries = fs.readdirSync(src, { withFileTypes: true });
    for (var i = 0; i < entries.length; i += 1) {
      var from = path.join(src, entries[i].name);
      var to = path.join(dest, entries[i].name);
      if (entries[i].isDirectory()) {
        await kitCopyDir(from, to, onFile);
        continue;
      }
      var same = false;
      try { same = fs.statSync(to).size === fs.statSync(from).size; } catch (statError) { same = false; }
      if (!same) {
        if (onFile) { onFile(entries[i].name); }
        await kitYield();
        await fs.promises.copyFile(from, to);
      }
    }
  }

  // Applying a pack. Media is copied NEXT TO THE PROJECT first
  // (<project folder>/Pack Assets/<pack>/; an unsaved project uses
  // Documents/Mótion Film Packs/_Unsaved projects/<pack>/) and imported
  // from there -- the project never points into the library, so deleting
  // a pack later can't leave it with missing media.
  async function kitApplyPack(meta) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var dir = kitPackDir(meta.id);
    var data = kitReadJsonFile(path.join(dir, "data.json"), null);
    if (!data) {
      setStatus("This pack's data is missing or damaged (" + dir + ").", "error");
      return;
    }
    var layers = kitDataLayers(meta.kind, data);
    kitSlimLayers(layers); // packs saved before 0.9.7b still carry the duplicate
    var hasMedia = false;
    walkKitAvSources(layers, function (av) { if (av.assetFile) { hasMedia = true; } });
    var mediaDir = path.join(dir, "assets");
    var tmp = null;
    try {
      if (hasMedia && fs.existsSync(mediaDir)) {
        var projectDir = await kitHostEval("(function(){ try { return app.project && app.project.file ? app.project.file.parent.fsName : ''; } catch (e) { return ''; } }())");
        var targetDir = (projectDir && projectDir !== "undefined")
          ? path.join(projectDir, "Pack Assets", kitSafeName(meta.label))
          : path.join(kitLibraryDir(), "_Unsaved projects", kitSafeName(meta.label));
        kitBusy("Copying media to the project…");
        await kitCopyDir(mediaDir, targetDir, function (name) {
          kitBusy("Copying " + name + "…");
        });
        mediaDir = targetDir;
      }
      kitResolveAbsPaths(layers, mediaDir);
      tmp = kitWriteTempJson("mf_pack_apply_", { kind: meta.kind, label: meta.label, data: data });
      kitBusy("Applying “" + meta.label + "”…");
    } catch (prepError) {
      kitBusy(null);
      setStatus("Couldn't prepare the pack's media: " + prepError, "error");
      return;
    }
    hostCall("applyKitPackFile", [tmp.replace(/\\/g, "/")], function (result) {
      kitBusy(null);
      try { fs.unlinkSync(tmp); } catch (unlinkError) {}
      if (!result || !result.ok) {
        setStatus((result && result.error) || "Couldn't apply this pack.", "error");
        return;
      }
      if (meta.kind === "comp") {
        setStatus(result.inserted ? "“" + meta.label + "” added to “" + result.into + "”." : "Comp “" + result.comp + "” created.", "success");
      } else {
        setStatus(meta.label + " inserted (" + result.applied + " layer(s)).", "success");
      }
    });
  }

  // Loads the just-rendered clip in a detached <video>, seeks to a
  // representative frame (roughly a third in, so it's past a fade-from-
  // black/zero-scale start but still early enough to read as "before"),
  // and saves a JPEG snapshot of it next to the clip -- the exact
  // technique already confirmed live to read real (non-black) pixel
  // data from a real <video>, not a placeholder/blank frame.
  function captureKitPreviewPoster(mp4Path, jpgPath, callback) {
    var fs = nodeRequire("fs");
    var video = document.createElement("video");
    video.muted = true;
    video.src = kitFileUrl(mp4Path) + "?t=" + Date.now(); // spaces/accents escaped (pack paths have both)
    var settled = false;
    function finish(ok, error) {
      if (settled) {
        return;
      }
      settled = true;
      callback(ok, error);
    }
    video.addEventListener("loadeddata", function () {
      video.currentTime = video.duration ? Math.min(0.3, video.duration / 3) : 0.3;
    });
    video.addEventListener("seeked", function () {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        var base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        fs.writeFileSync(jpgPath, nodeRequire("buffer").Buffer.from(base64, "base64"));
        finish(true);
      } catch (captureError) {
        finish(false, String(captureError));
      }
    });
    video.addEventListener("error", function () {
      finish(false, "Could not load the rendered clip.");
    });
  }

  // Phase 2 of the render overlay (see the HTML comment on
  // #kit-render-overlay) -- called once a preview has actually finished
  // rendering successfully (the "Preview rendered." status, see
  // generateKitPresetPreview), never while the render itself is still
  // in flight. The overlay is already up with the spinner showing by
  // this point (phase 1); this just swaps the spinner out for the
  // mascot canvas -- it does NOT re-show/re-blur the overlay itself, so
  // there's no flicker at the handoff. Plays the mascot clip exactly
  // once (no loop) and hides the WHOLE overlay once it's done, same
  // dim+blur backdrop as the other .modal-overlay panels (Caption
  // Settings, Manage Style Presets).
  //
  // The source <video> stays invisible; each frame is manually
  // chroma-keyed onto #kit-render-mascot (a <canvas>) instead of being
  // shown directly. Two things confirmed live, in order, before landing
  // on this: (1) mix-blend-mode: screen on the <video> itself painted
  // the clip's black background as a solid opaque box no matter what,
  // despite getComputedStyle correctly reporting the property as set;
  // (2) switching to drawing frames onto a <canvas> and putting the
  // blend mode there instead did NOT fix it either -- a plain white
  // test div with mix-blend-mode: difference, added both inside this
  // same overlay and as a completely unrelated position:fixed element
  // elsewhere in the page, rendered as flat solid white in both places
  // (difference against anything should never look like the unblended
  // source color). Conclusion: mix-blend-mode isn't compositing at all
  // in this CEP build's Chromium, not a video- or backdrop-filter-
  // specific quirk -- so this doesn't lean on it anywhere anymore.
  //
  // Instead, every source pixel's own brightness becomes its alpha
  // (`alpha = max(r, g, b)`) via real ImageData manipulation: a pixel
  // that's genuinely black (r=g=b=0) becomes fully transparent, a
  // saturated color (the mascot's green, or white highlights) stays
  // fully opaque, and anti-aliased edge pixels in between fall
  // somewhere in between automatically -- mathematically the same
  // result "screen blend against a black destination" would have
  // produced, just computed by hand with a real alpha channel instead
  // of depending on a CSS feature this build doesn't actually apply.
  function playKitMascotConfirmation() {
    var overlay = $("kit-render-overlay");
    var spinnerWrap = $("kit-render-spinner-wrap");
    var video = $("kit-render-mascot-source");
    var canvas = $("kit-render-mascot");
    if (!overlay || !video || !canvas) {
      return;
    }
    var ctx = canvas.getContext("2d");
    var rafId = null;
    var sampleCanvas = null;
    var sampleCtx = null;

    function drawFrame() {
      if (video.paused || video.ended) {
        return;
      }
      try {
        sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
        var frame = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
        var data = frame.data;
        for (var i = 0; i < data.length; i += 4) {
          data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]);
        }
        ctx.putImageData(frame, 0, 0);
      } catch (drawError) {
        // Non-fatal -- just skip this frame (e.g. not decoded far enough yet).
      }
      rafId = window.requestAnimationFrame(drawFrame);
    }

    function finish() {
      video.removeEventListener("ended", finish);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      overlay.hidden = true;
      // Reset back to phase 1's initial state (spinner visible, canvas
      // hidden) so the NEXT render cycle starts clean instead of
      // flashing the last-drawn mascot frame for an instant before
      // startDrawing() below gets around to hiding it again.
      canvas.hidden = true;
      if (spinnerWrap) {
        spinnerWrap.hidden = false;
      }
    }

    // overlay.hidden is deliberately NOT touched here -- generateKitPresetPreview
    // already showed it (with the spinner) back when rendering started,
    // and it's meant to stay up, unbroken, through this handoff. Only
    // set defensively in case this ever gets called on its own, outside
    // that normal flow.
    overlay.hidden = false;
    video.addEventListener("ended", finish);
    try {
      video.currentTime = 0;
    } catch (seekError) {
      // Not loaded far enough yet to seek -- play() below still starts it.
    }

    function startDrawing() {
      if (spinnerWrap) {
        spinnerWrap.hidden = true;
      }
      canvas.hidden = false;
      // Downscaled from the source's own native resolution (this clip
      // is 4K) rather than a hardcoded size -- keeps the aspect ratio
      // automatically correct for whatever mascot clip ends up here,
      // and keeps the per-pixel chroma-key work (done every frame,
      // real CPU work unlike a GPU-composited blend mode) proportional
      // to what's actually visible instead of a full 4K frame.
      var scale = video.videoWidth > 0 ? Math.min(1, 960 / video.videoWidth) : 1;
      var w = Math.round((video.videoWidth || 960) * scale);
      var h = Math.round((video.videoHeight || 540) * scale);
      canvas.width = w;
      canvas.height = h;
      sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = w;
      sampleCanvas.height = h;
      sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      drawFrame();
    }

    var playPromise = video.play();
    if (playPromise && playPromise.then) {
      playPromise.then(startDrawing).catch(function () {
        // Autoplay refused -- nothing to wait for, don't leave the
        // overlay stuck up over a clip that will never play/end.
        finish();
      });
    } else {
      startDrawing();
    }
  }

  // Renders packs/<id>/preview.mp4 (+ .jpg poster). Small on purpose:
  // the host renders at reduced resolution (~480px long side, see
  // KIT_PREVIEW_MAX_SIDE in host.jsx) and at most KIT_PREVIEW_MAX_DURATION
  // seconds, Draft quality. Only the pack's own (selected) layers, rebuilt
  // in a throwaway comp from the pack's media copies and reaped after.
  // onDone (optional): called when this preview is finished either way --
  // the import queue renders several previews one after another.
  function generateKitPresetPreview(id, kind, onDone) {
    function finish() {
      if (onDone) { onDone(); }
    }
    var path = nodeRequire("path");
    var fs = nodeRequire("fs");
    var dir = kitPackDir(id);
    var mp4Path = path.join(dir, "preview.mp4");
    var jpgPath = path.join(dir, "preview.jpg");
    var data = kitReadJsonFile(path.join(dir, "data.json"), null);
    if (!data) {
      kitBusy(null);
      finish();
      return;
    }
    kitSlimLayers(kitDataLayers(kind, data));
    kitResolveAbsPaths(kitDataLayers(kind, data), path.join(dir, "assets"));
    var tmp;
    try {
      tmp = kitWriteTempJson("mf_pack_preview_", data);
    } catch (tmpError) {
      kitBusy(null);
      setStatus("Pack saved, but its preview couldn't start: " + tmpError, "error");
      finish();
      return;
    }
    kitBusy("Rendering preview…");

    function markPreview() {
      var meta = kitReadJsonFile(path.join(dir, "meta.json"), null);
      if (meta) {
        meta.previewAt = Date.now();
        try { kitWriteJsonFile(path.join(dir, "meta.json"), meta); } catch (metaError) {}
      }
      kitRefreshPacks();
    }

    // AE renders into an ASCII-only temp folder (it can't write to the
    // accented pack path, see kitAsciiTempDir); Node moves the clip in.
    kitAsciiTempDir().then(function (asciiDir) {
      var renderPath = path.join(asciiDir, "mf_preview_" + id + "_" + Date.now() + ".mp4");
      hostCall("renderKitPackPreview", [tmp.replace(/\\/g, "/"), kind, renderPath.replace(/\\/g, "/")], function (result) {
        if (result && result.ok && !result.empty) {
          try {
            fs.copyFileSync(renderPath, mp4Path);
          } catch (moveError) {
            result = { ok: false, error: "Rendered, but couldn't move the clip into the pack: " + moveError };
          }
        }
        try { fs.unlinkSync(renderPath); } catch (renderCleanupError) {}
        onRendered(result);
      });
    });

    function onRendered(result) {
      try { fs.unlinkSync(tmp); } catch (unlinkError) {}
      if (result.ok && result.empty) {
        kitBusy(null);
        renderKitPresets();
        setStatus("Pack saved. (No preview -- nothing visible to render.)", "success");
        finish();
        return;
      }
      if (!result.ok) {
        kitBusy(null);
        setStatus("Pack saved, but rendering its preview failed: " + result.error, "error");
        finish();
        return;
      }
      captureKitPreviewPoster(mp4Path, jpgPath, function (posterOk, posterError) {
        markPreview();
        renderKitPresets();
        if (posterOk && !onDone) {
          setStatus("Preview rendered.", "success");
          playKitMascotConfirmation(); // takes over the already-visible overlay -- no flicker
        } else if (posterOk) {
          kitBusy(null); // import queue: no mascot between renders
        } else {
          kitBusy(null);
          setStatus("Preview video rendered, but its poster frame failed: " + posterError, "error");
        }
        finish();
      });
    }
  }

  // Custom delayed hover tooltip for any [data-tooltip] element -- built
  // for the Kit footer buttons (Preset layers/comp, Export/Delete preset)
  // once they went icon-only (user feedback: 4 labeled buttons side by
  // side felt cramped/hard to read). One shared tooltip <div>, reused for
  // every trigger instead of one per button. Deliberately NOT the native
  // `title` attribute -- that pops up instantly with zero style control;
  // this one waits for the mouse to sit still ~1s first (so it doesn't
  // flash while just moving the cursor across the footer) and renders as
  // a small themed bubble above the button, matching the rest of the
  // panel instead of the OS's plain tooltip box.
  function initFooterTooltips() {
    var triggers = document.querySelectorAll("[data-tooltip]");
    if (!triggers.length) {
      return;
    }
    var bubble = document.createElement("div");
    bubble.className = "footer-tooltip";
    bubble.hidden = true;
    document.body.appendChild(bubble);
    var showTimer = null;
    var activeTrigger = null;

    function position(trigger) {
      var rect = trigger.getBoundingClientRect();
      bubble.style.left = "-9999px";
      bubble.style.top = "-9999px";
      bubble.hidden = false;
      var bubbleWidth = bubble.offsetWidth;
      var bubbleHeight = bubble.offsetHeight;
      var left = rect.left + rect.width / 2 - bubbleWidth / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - bubbleWidth - 6));
      var top = rect.top - bubbleHeight - 8;
      if (top < 6) {
        // Not enough room above (footer sits at the bottom of the
        // panel) -- flip below the button instead.
        top = rect.bottom + 8;
      }
      bubble.style.left = left + "px";
      bubble.style.top = top + "px";
    }

    function hide() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      bubble.classList.remove("is-visible");
      bubble.hidden = true;
      activeTrigger = null;
    }

    for (var i = 0; i < triggers.length; i += 1) {
      (function (trigger) {
        trigger.addEventListener("mouseenter", function () {
          if (showTimer) {
            clearTimeout(showTimer);
          }
          showTimer = setTimeout(function () {
            bubble.textContent = trigger.getAttribute("data-tooltip") || "";
            activeTrigger = trigger;
            position(trigger);
            bubble.classList.add("is-visible");
          }, 1000);
        });
        trigger.addEventListener("mouseleave", hide);
        trigger.addEventListener("mousedown", hide);
      }(triggers[i]));
    }
  }

  function initKitSaveTools() {
    var layersBtn = $("kit-save-layers");
    var compBtn = $("kit-save-comp");
    if (layersBtn) {
      layersBtn.addEventListener("click", function () {
        kitStartSave(layersBtn, "layers");
      });
    }
    if (compBtn) {
      // The SELECTED layers, saved to be pasted back as one new comp
      // (like Pre-compose) at the playhead -- in any project, with a copy
      // of all their media. Never the whole comp (user rule).
      compBtn.addEventListener("click", function () {
        kitStartSave(compBtn, "comp");
      });
    }

    // "Delete preset" -- same first step as saving (openChoicePicker
    // asking which group), but instead of naming a new preset, picking
    // a category ARMS kitDeleteMode and switches the grid to that
    // category. From there, deleting a specific preset is a 3-second
    // left-button hold directly on its tile (see renderKitPresets),
    // not a click -- so nothing gets removed by a stray click, and this
    // needs no native confirm() dialog (see the documented lesson on
    // those freezing this panel solid).
    //
    // Same button also deletes a whole TOPIC now (user request): in
    // that same category picker, holding Shift while clicking a topic's
    // name deletes the topic itself (and every custom preset filed
    // under it) instead of arming delete-mode for what's inside it. A
    // plain click keeps doing exactly what it always did. No separate
    // button, no hold-timer for this one -- Shift+click already reads
    // as a deliberate, different action from a plain click, which is
    // the same "friction instead of a native confirm()" reasoning the
    // 3-second hold uses for individual presets.
    var deleteBtn = $("kit-delete-preset");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function (event) {
        // Opens openChoicePicker synchronously (no hostCall in between)
        // -- without stopping propagation, the document-level "close
        // every popover on any click" listener would immediately close
        // the picker this same click just opened (see the Save flow's
        // buttons, which dodge this only because their picker opens
        // from inside an async callback instead).
        event.stopPropagation();
        var options = getAllKitCategories().map(function (c) {
          return { value: c, label: c };
        });
        openChoicePicker(deleteBtn, options, kitState.category, function (category, pickEvent) {
          if (pickEvent && pickEvent.shiftKey) {
            deleteKitCategory(category);
            return;
          }
          kitState.category = category;
          kitDeleteMode = true;
          kitExportMode = false;
          renderKitCategories();
          renderKitPresets();
          setStatus("Hold a preset for 3 seconds to delete it. Built-in presets can't be deleted this way.", "success");
        });
      });
    }

    // "Export preset" -- same first step as Delete (openChoicePicker
    // asking which group), but picking a category ARMS kitExportMode
    // instead: from there, exporting a specific preset is a plain click
    // on its tile (see renderKitPresets) -- exporting isn't destructive
    // the way deleting is, so a click (not a 3-second hold) is enough.
    // Only ever offers user-saved presets, same as Delete -- a curated
    // preset isn't stored anywhere a file could be built from.
    var exportBtn = $("kit-export-preset");
    if (exportBtn) {
      exportBtn.addEventListener("click", function (event) {
        // Same synchronous-picker propagation note as Delete above.
        event.stopPropagation();
        var options = getAllKitCategories().map(function (c) {
          return { value: c, label: c };
        });
        openChoicePicker(exportBtn, options, kitState.category, function (category) {
          kitState.category = category;
          kitExportMode = true;
          kitDeleteMode = false;
          renderKitCategories();
          renderKitPresets();
          setStatus("Click a preset to export it. Built-in presets can't be exported this way.", "success");
        });
      });
    }

    // Import goes through the native open dialog (real file PATHS), not an
    // <input type=file>: a pack .zip can be gigabytes of video, and with a
    // path it's unpacked straight from disk in chunks instead of being
    // loaded into memory whole.
    var importBtn = $("kit-import-preset");
    if (importBtn) {
      importBtn.addEventListener("click", function () {
        kitImportPacks();
      });
    }
  }

  // ---------------------------------------------------------------
  // Export / import of a pack as ONE .zip with everything in it:
  //   preset.json  envelope { motionFilmKitPresetFile, formatVersion: 2,
  //                preset: { kind, category, label, data } }
  //   preview.mp4, preview.jpg
  //   assets/...   every media file (images, video, audio, PSD, sequences)
  // Same layout as the v1 bundles, so older exports still import.
  // Written and read in chunks straight from/to disk (Node fs), never as
  // one in-memory blob -- a pack with long videos can be gigabytes. STORE
  // (no compression): media is already compressed, and this keeps it fast.
  // ---------------------------------------------------------------

  var KIT_ZIP_CHUNK = 4 * 1024 * 1024;
  var kitCrcTable = null;

  function kitCrcUpdate(crc, buf) {
    if (!kitCrcTable) {
      kitCrcTable = new Int32Array(256);
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        kitCrcTable[n] = c;
      }
    }
    var table = kitCrcTable;
    for (var i = 0, len = buf.length; i < len; i += 1) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return crc;
  }

  function kitDosDateTime(d) {
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  // entries: [{ name, path } | { name, data: Buffer }]
  async function kitZipWrite(destPath, entries, onProgress) {
    var fs = nodeRequire("fs");
    var Buffer = nodeRequire("buffer").Buffer;
    var dt = kitDosDateTime(new Date());
    var fd = fs.openSync(destPath, "w");
    var offset = 0;
    var central = [];
    var chunk = Buffer.allocUnsafe(KIT_ZIP_CHUNK);
    function write(buf, len) {
      var n = len === undefined ? buf.length : len;
      fs.writeSync(fd, buf, 0, n);
      offset += n;
    }
    try {
      if (entries.length > 65535) {
        throw new Error("Too many files for one zip.");
      }
      for (var e = 0; e < entries.length; e += 1) {
        var ent = entries[e];
        var nameB = Buffer.from(ent.name, "utf8");
        var crc = -1;
        var size;
        var srcFd = null;
        var pos;
        var n;
        if (onProgress) { onProgress(e + 1, entries.length, ent.name); }
        if (ent.data) {
          size = ent.data.length;
          crc = kitCrcUpdate(crc, ent.data);
        } else {
          size = fs.statSync(ent.path).size;
          srcFd = fs.openSync(ent.path, "r");
          pos = 0;
          while (pos < size) {
            n = fs.readSync(srcFd, chunk, 0, Math.min(KIT_ZIP_CHUNK, size - pos), pos);
            if (n <= 0) { break; }
            crc = kitCrcUpdate(crc, chunk.subarray(0, n));
            pos += n;
            await kitYield();
          }
        }
        crc = (crc ^ -1) >>> 0;
        if (size > 0xFFFFFFFF || offset + size + 30 + nameB.length > 0xFFFFFFFF) {
          if (srcFd !== null) { fs.closeSync(srcFd); }
          throw new Error("This pack is bigger than 4 GB -- the zip export doesn't support that size.");
        }
        var lho = offset;
        var lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4);
        lfh.writeUInt16LE(0x0800, 6);   // UTF-8 names
        lfh.writeUInt16LE(0, 8);        // STORE
        lfh.writeUInt16LE(dt.time, 10);
        lfh.writeUInt16LE(dt.date, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(size, 18);
        lfh.writeUInt32LE(size, 22);
        lfh.writeUInt16LE(nameB.length, 26);
        lfh.writeUInt16LE(0, 28);
        write(lfh);
        write(nameB);
        if (ent.data) {
          write(ent.data);
        } else {
          pos = 0;
          while (pos < size) {
            n = fs.readSync(srcFd, chunk, 0, Math.min(KIT_ZIP_CHUNK, size - pos), pos);
            if (n <= 0) { break; }
            write(chunk, n);
            pos += n;
            await kitYield();
          }
          fs.closeSync(srcFd);
        }
        central.push({ nameB: nameB, crc: crc, size: size, lho: lho });
      }
      var cdStart = offset;
      for (var c = 0; c < central.length; c += 1) {
        var ce = central[c];
        var cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0);
        cdh.writeUInt16LE(20, 4);
        cdh.writeUInt16LE(20, 6);
        cdh.writeUInt16LE(0x0800, 8);
        cdh.writeUInt16LE(0, 10);
        cdh.writeUInt16LE(dt.time, 12);
        cdh.writeUInt16LE(dt.date, 14);
        cdh.writeUInt32LE(ce.crc, 16);
        cdh.writeUInt32LE(ce.size, 20);
        cdh.writeUInt32LE(ce.size, 24);
        cdh.writeUInt16LE(ce.nameB.length, 28);
        cdh.writeUInt32LE(ce.lho, 42);
        write(cdh);
        write(ce.nameB);
      }
      var eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(central.length, 8);
      eocd.writeUInt16LE(central.length, 10);
      eocd.writeUInt32LE(offset - cdStart, 12);
      eocd.writeUInt32LE(cdStart, 16);
      write(eocd);
      fs.closeSync(fd);
    } catch (zipError) {
      try { fs.closeSync(fd); } catch (closeError) {}
      try { fs.unlinkSync(destPath); } catch (unlinkError) {}
      throw zipError;
    }
  }

  // Opens a zip and lists its entries (central directory only).
  function kitZipOpen(zipPath) {
    var fs = nodeRequire("fs");
    var Buffer = nodeRequire("buffer").Buffer;
    var fd = fs.openSync(zipPath, "r");
    var size = fs.fstatSync(fd).size;
    var tailLen = Math.min(size, 65557);
    var tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    var i = tailLen - 22;
    for (; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { break; }
    }
    if (i < 0) {
      fs.closeSync(fd);
      throw new Error("Not a zip file.");
    }
    var count = tail.readUInt16LE(i + 10);
    var cdSize = tail.readUInt32LE(i + 12);
    var cdOffset = tail.readUInt32LE(i + 16);
    var cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    var entries = [];
    var p = 0;
    var lh = Buffer.alloc(30);
    for (var e = 0; e < count; e += 1) {
      if (cd.readUInt32LE(p) !== 0x02014b50) {
        fs.closeSync(fd);
        throw new Error("Damaged zip (central directory).");
      }
      var method = cd.readUInt16LE(p + 10);
      var compSize = cd.readUInt32LE(p + 20);
      var rawSize = cd.readUInt32LE(p + 24);
      var nameLen = cd.readUInt16LE(p + 28);
      var extraLen = cd.readUInt16LE(p + 30);
      var commentLen = cd.readUInt16LE(p + 32);
      var lho = cd.readUInt32LE(p + 42);
      var name = cd.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
      fs.readSync(fd, lh, 0, 30, lho);
      var dataStart = lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      entries.push({ name: name, method: method, compSize: compSize, size: rawSize, dataStart: dataStart });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { fd: fd, entries: entries };
  }

  function kitZipReadBuffer(zip, entry) {
    var fs = nodeRequire("fs");
    var buf = nodeRequire("buffer").Buffer.alloc(entry.compSize);
    fs.readSync(zip.fd, buf, 0, entry.compSize, entry.dataStart);
    if (entry.method === 8) {
      return nodeRequire("zlib").inflateRawSync(buf);
    }
    if (entry.method !== 0) {
      throw new Error("Unsupported zip compression (" + entry.method + ").");
    }
    return buf;
  }

  async function kitZipExtract(zip, entry, destPath) {
    var fs = nodeRequire("fs");
    fs.mkdirSync(nodeRequire("path").dirname(destPath), { recursive: true });
    if (entry.method !== 0) {
      fs.writeFileSync(destPath, kitZipReadBuffer(zip, entry));
      return;
    }
    var chunk = nodeRequire("buffer").Buffer.allocUnsafe(KIT_ZIP_CHUNK);
    var out = fs.openSync(destPath, "w");
    try {
      var pos = 0;
      while (pos < entry.size) {
        var n = fs.readSync(zip.fd, chunk, 0, Math.min(KIT_ZIP_CHUNK, entry.size - pos), entry.dataStart + pos);
        if (n <= 0) { break; }
        fs.writeSync(out, chunk, 0, n);
        pos += n;
        await kitYield();
      }
    } finally {
      fs.closeSync(out);
    }
  }

  // Machine-specific bits never leave (or enter) a pack file: original
  // media paths, resolved paths, and the source comp's project item id
  // (meaningless -- or worse, a different item -- in another project).
  function kitStripMachinePaths(kind, data) {
    walkKitAvSources(kitDataLayers(kind, data), function (av) {
      if (!av.assetFile && av.originalPath) {
        av.assetFile = String(av.originalPath).split(/[\\/]/).pop(); // v1 bundles
      }
      delete av.originalPath;
      delete av.absPath;
      delete av.itemId;
    });
    delete data.sourceCompId;
    return data;
  }

  function kitListFilesRecursive(root, rel, out) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    fs.readdirSync(path.join(root, rel), { withFileTypes: true }).forEach(function (d) {
      var r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) {
        kitListFilesRecursive(root, r, out);
      } else {
        out.push(r);
      }
    });
    return out;
  }

  function kitFormatBytes(n) {
    if (n > 1024 * 1024 * 1024) { return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB"; }
    if (n > 1024 * 1024) { return (n / (1024 * 1024)).toFixed(1) + " MB"; }
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  async function kitExportPack(meta) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var Buffer = nodeRequire("buffer").Buffer;
    var dir = kitPackDir(meta.id);
    function end() {
      kitExportMode = false;
      renderKitPresets();
    }
    var data = kitReadJsonFile(path.join(dir, "data.json"), null);
    if (!data) {
      setStatus("This pack's data is missing or damaged.", "error");
      end();
      return;
    }
    var dest = null;
    try {
      var choice = window.cep.fs.showSaveDialogEx("Export Pack", "", ["zip"], kitSafeName(meta.label) + ".zip");
      dest = choice && choice.data;
      if (Array.isArray(dest)) { dest = dest[0]; }
    } catch (dialogError) {
      dest = null;
    }
    if (!dest) {
      end();
      return;
    }
    if (!/\.zip$/i.test(dest)) { dest += ".zip"; }

    var envelope = {
      motionFilmKitPresetFile: true,
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      preset: { kind: meta.kind, category: meta.category, label: meta.label, compName: meta.compName || null, data: kitStripMachinePaths(meta.kind, data) }
    };
    var entries = [{ name: "preset.json", data: Buffer.from(JSON.stringify(envelope), "utf8") }];
    ["mp4", "jpg"].forEach(function (ext) {
      var fp = path.join(dir, "preview." + ext);
      if (fs.existsSync(fp)) { entries.push({ name: "preview." + ext, path: fp }); }
    });
    var assetsDir = path.join(dir, "assets");
    var total = 0;
    if (fs.existsSync(assetsDir)) {
      kitListFilesRecursive(assetsDir, "", []).forEach(function (rel) {
        var fp = path.join(assetsDir, rel);
        entries.push({ name: "assets/" + rel, path: fp });
        try { total += fs.statSync(fp).size; } catch (statError) {}
      });
    }
    try {
      kitBusy("Exporting…");
      await kitZipWrite(dest, entries, function (i, n) {
        kitBusy("Exporting " + i + "/" + n + "…");
      });
      kitBusy(null);
      var mediaCount = entries.filter(function (x) { return x.name.indexOf("assets/") === 0; }).length;
      setStatus("Exported “" + meta.label + "”" + (mediaCount ? " with " + mediaCount + " media file" + (mediaCount === 1 ? "" : "s") + " (" + kitFormatBytes(total) + ")" : "") + ".", "success");
    } catch (exportError) {
      kitBusy(null);
      setStatus("Export failed: " + (exportError && exportError.message ? exportError.message : exportError), "error");
    }
    end();
  }

  // Accepts the real envelope, a bare { presets: [...] } or a bare preset.
  function parseImportedKitPresetEntries(jsonText) {
    var data = JSON.parse(jsonText);
    if (data && data.motionFilmKitPresetFile && data.preset) {
      return [data.preset];
    }
    if (data && Array.isArray(data.presets)) {
      return data.presets;
    }
    if (data && data.kind && data.data) {
      return [data];
    }
    throw new Error("Not a Mótion Film pack file.");
  }

  function uniqueKitPresetLabel(label, existingLabels) {
    if (existingLabels.indexOf(label) === -1) {
      return label;
    }
    var n = 2;
    while (existingLabels.indexOf(label + " (" + n + ")") !== -1) {
      n += 1;
    }
    return label + " (" + n + ")";
  }

  // One imported entry -> one new pack folder. Returns { id, kind,
  // hasPreview } or null for the old reference-only comp presets (they
  // never stored the comp itself, so there's nothing to rebuild).
  async function kitCreateImportedPack(entry, zip, existingLabels) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    if (!entry || !entry.kind || !entry.data) {
      throw new Error("Empty pack entry.");
    }
    if (entry.kind === "comp" && !entry.data.comp) {
      return null;
    }
    var id = "pack-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
    var dir = kitPackDir(id);
    fs.mkdirSync(dir, { recursive: true });
    var hasPreview = false;
    try {
      if (zip) {
        for (var z = 0; z < zip.entries.length; z += 1) {
          var ze = zip.entries[z];
          var rel = ze.name;
          if (rel.indexOf("assets/") === 0 && rel.length > 7 && rel.charAt(rel.length - 1) !== "/") {
            var safeRel = rel.slice(7).split("/").filter(function (s) { return s && s !== "." && s !== ".."; }).join("/");
            if (!safeRel) { continue; }
            kitBusy("Importing " + safeRel.split("/").pop() + "…");
            await kitZipExtract(zip, ze, path.join(dir, "assets", safeRel));
          } else if (rel === "preview.mp4" || rel === "preview.jpg") {
            await kitZipExtract(zip, ze, path.join(dir, rel));
            if (rel === "preview.mp4") { hasPreview = true; }
          }
        }
      }
      var data = kitStripMachinePaths(entry.kind, entry.data);
      var label = uniqueKitPresetLabel(String(entry.label || "Imported pack"), existingLabels);
      existingLabels.push(label);
      var category = (entry.category && String(entry.category)) || getAllKitCategories()[0] || KIT_CATEGORIES[0];
      kitWriteJsonFile(path.join(dir, "data.json"), data);
      var comp = data.comp || {};
      kitWriteJsonFile(path.join(dir, "meta.json"), {
        id: id,
        kind: entry.kind,
        category: category,
        label: label,
        createdAt: Date.now(),
        formatVersion: 2,
        compName: entry.compName || comp.compName || null,
        width: data.compWidth || comp.width,
        height: data.compHeight || comp.height,
        frameRate: data.compFrameRate || comp.frameRate,
        previewAt: hasPreview ? Date.now() : 0,
        imported: true
      });
      kitEnsureCategory(category);
      return { id: id, kind: entry.kind, hasPreview: hasPreview, category: category };
    } catch (importError) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (cleanupError) {}
      throw importError;
    }
  }

  async function kitImportPacks() {
    var fs = nodeRequire("fs");
    var paths = null;
    try {
      var choice = window.cep.fs.showOpenDialogEx(true, false, "Import Pack", "", ["zip", "json"]);
      paths = choice && choice.data;
    } catch (dialogError) {
      paths = null;
    }
    if (!paths || !paths.length) {
      return;
    }
    var existingLabels = loadKitCustomPresets().map(function (p) { return p.label; });
    var created = [];
    var failed = 0;
    var oldFormat = 0;
    for (var i = 0; i < paths.length; i += 1) {
      var p = paths[i];
      var zip = null;
      try {
        kitBusy("Importing " + p.split(/[\\/]/).pop() + "…");
        var entries;
        if (/\.json$/i.test(p)) {
          entries = parseImportedKitPresetEntries(fs.readFileSync(p, "utf8"));
        } else {
          zip = kitZipOpen(p);
          var presetEntry = null;
          for (var z = 0; z < zip.entries.length; z += 1) {
            if (zip.entries[z].name === "preset.json") { presetEntry = zip.entries[z]; }
          }
          if (!presetEntry) {
            throw new Error("No preset.json in this zip.");
          }
          entries = parseImportedKitPresetEntries(kitZipReadBuffer(zip, presetEntry).toString("utf8"));
        }
        for (var e = 0; e < entries.length; e += 1) {
          var made = await kitCreateImportedPack(entries[e], zip, existingLabels);
          if (made) { created.push(made); } else { oldFormat += 1; }
        }
      } catch (importError) {
        failed += 1;
      } finally {
        if (zip) { try { fs.closeSync(zip.fd); } catch (closeError) {} }
      }
    }
    kitBusy(null);
    kitRefreshPacks();
    if (created.length) {
      kitState.category = created[created.length - 1].category;
    }
    renderKitCategories();
    renderKitPresets();
    var notes = [];
    if (failed) { notes.push(failed + " file(s) couldn't be read"); }
    if (oldFormat) { notes.push(oldFormat + " old comp preset(s) skipped -- they only stored the comp's name; save them again from the original project"); }
    if (created.length) {
      setStatus("Imported " + created.length + " pack" + (created.length === 1 ? "" : "s") + (notes.length ? " -- " + notes.join("; ") : "") + ".", notes.length ? "error" : "success");
    } else {
      setStatus("Nothing imported" + (notes.length ? ": " + notes.join("; ") : "") + ".", "error");
    }
    // Packs that came without a preview get one rendered, one at a time.
    var queue = created.filter(function (c) { return !c.hasPreview; });
    (function next() {
      var item = queue.shift();
      if (item) {
        generateKitPresetPreview(item.id, item.kind, next);
      }
    }());
  }

  // Drag-to-resize the category rail against the preset grid. The rail
  // gets an inline pixel width (persisted in localStorage, same pattern
  // as the collapsible-section state elsewhere); the grid needs no width
  // of its own since it's flex:1 and just fills whatever's left.
  var KIT_RAIL_WIDTH_KEY = "motionfilm-kit-rail-width";
  var KIT_RAIL_MIN = 64;
  var KIT_RAIL_MAX = 200;

  function initKitResizer() {
    var resizer = $("kit-resizer");
    var rail = $("kit-categories");
    if (!resizer || !rail) {
      return;
    }

    var stored = parseFloat(localStorage.getItem(KIT_RAIL_WIDTH_KEY));
    if (!isNaN(stored)) {
      rail.style.width = clamp(stored, KIT_RAIL_MIN, KIT_RAIL_MAX) + "px";
    }

    var dragging = false;
    var startX = 0;
    var startWidth = 0;

    function applyWidth(px) {
      var next = clamp(px, KIT_RAIL_MIN, KIT_RAIL_MAX);
      rail.style.width = next + "px";
      return next;
    }

    resizer.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startWidth = rail.getBoundingClientRect().width;
      resizer.classList.add("is-dragging");
      if (resizer.setPointerCapture) {
        try {
          resizer.setPointerCapture(event.pointerId);
        } catch (captureError) {
          // Falls back to plain hit-testing.
        }
      }
    });

    resizer.addEventListener("pointermove", function (event) {
      if (!dragging) {
        return;
      }
      applyWidth(startWidth + (event.clientX - startX));
    });

    function endDrag() {
      if (!dragging) {
        return;
      }
      dragging = false;
      resizer.classList.remove("is-dragging");
      localStorage.setItem(KIT_RAIL_WIDTH_KEY, String(rail.getBoundingClientRect().width));
    }
    resizer.addEventListener("pointerup", endDrag);
    resizer.addEventListener("pointercancel", endDrag);
    resizer.addEventListener("lostpointercapture", endDrag);

    // Keyboard support to match the separator role: arrow keys nudge the
    // rail width in 8px steps.
    resizer.addEventListener("keydown", function (event) {
      var delta = 0;
      if (event.key === "ArrowLeft") {
        delta = -8;
      } else if (event.key === "ArrowRight") {
        delta = 8;
      } else {
        return;
      }
      event.preventDefault();
      var next = applyWidth(rail.getBoundingClientRect().width + delta);
      localStorage.setItem(KIT_RAIL_WIDTH_KEY, String(next));
    });
  }

  function initKitTools() {
    renderKitCategories();
    renderKitPresets();
    initKitResizer();
  }

  // ---------------------------------------------------------------
  // Action-bar (footer) height: draggable from a handle on its top
  // edge, same feel as the Kit category resizer but vertical. Home and
  // Kit share ONE height (a single --footer-h on :root); main /
  // .kit-layout are flex:1 so they absorb the change. Unset means "auto"
  // -- the original content height -- so nothing looks different until
  // the user actually drags.
  // ---------------------------------------------------------------
  var FOOTER_HEIGHT_KEY = "motionfilm-footer-height";
  var FOOTER_MIN = 42;
  var FOOTER_MAX = 120;

  function currentFooterHeightVar(fallback) {
    var raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-h"));
    return isNaN(raw) ? fallback : raw;
  }

  function setFooterHeight(px) {
    var next = clamp(px, FOOTER_MIN, FOOTER_MAX);
    document.documentElement.style.setProperty("--footer-h", next + "px");
    return next;
  }

  function initFooterResizer() {
    var stored = parseFloat(localStorage.getItem(FOOTER_HEIGHT_KEY));
    if (!isNaN(stored)) {
      setFooterHeight(stored);
    }

    var handles = document.querySelectorAll(".footer-resizer");
    for (var i = 0; i < handles.length; i += 1) {
      wireFooterHandle(handles[i]);
    }
  }

  function wireFooterHandle(handle) {
    var footer = handle.parentElement;
    var dragging = false;
    var startY = 0;
    var startHeight = 0;

    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragging = true;
      startY = event.clientY;
      startHeight = footer.getBoundingClientRect().height;
      handle.classList.add("is-dragging");
      if (handle.setPointerCapture) {
        try {
          handle.setPointerCapture(event.pointerId);
        } catch (captureError) {
          // Falls back to plain hit-testing.
        }
      }
    });

    handle.addEventListener("pointermove", function (event) {
      if (!dragging) {
        return;
      }
      // Drag up (clientY decreases) makes the bar taller.
      setFooterHeight(startHeight - (event.clientY - startY));
    });

    function endDrag() {
      if (!dragging) {
        return;
      }
      dragging = false;
      handle.classList.remove("is-dragging");
      localStorage.setItem(FOOTER_HEIGHT_KEY, String(currentFooterHeightVar(startHeight)));
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("lostpointercapture", endDrag);

    // Match the separator role: arrow keys nudge the height in 6px steps.
    handle.addEventListener("keydown", function (event) {
      var delta = 0;
      if (event.key === "ArrowUp") {
        delta = 6;
      } else if (event.key === "ArrowDown") {
        delta = -6;
      } else {
        return;
      }
      event.preventDefault();
      var base = currentFooterHeightVar(footer.getBoundingClientRect().height);
      var next = setFooterHeight(base + delta);
      localStorage.setItem(FOOTER_HEIGHT_KEY, String(next));
    });
  }

  // ---------------------------------------------------------------
  // Icons tab: search Iconify (api.iconify.design -- no API key, no
  // login, aggregates 150+ openly-licensed icon sets) and import any
  // result straight into the project, so there's no manual round trip
  // through a browser tab and a Downloads folder. Needs an internet
  // connection, same as the hint text in index.html already says.
  // ---------------------------------------------------------------

  var ICONS_SEARCH_DEBOUNCE_MS = 400;
  var iconsSearchTimer = null;
  // Guards against a slow, older search response overwriting the grid
  // after a newer search has already started -- only the response whose
  // token still matches the latest one gets rendered.
  var iconsSearchToken = 0;

  // Network layer: batched icon data + disk cache + mirror failover.
  //
  // History: every tile used to load its own
  // <img src="api.iconify.design/<prefix>/<name>.svg">, i.e. ONE request
  // per icon. Even lazy + throttled (5 every 180ms) a single "house"
  // search scrolled a little meant 100+ requests, which trips Iconify's
  // per-IP limit (HTTP 429, a Cloudflare page) -- then previews stay blank
  // and imports fail for a minute (user report: "às vezes não consigo usar
  // nenhum ícone").
  //
  // Now:
  //  - Icon DATA is fetched in batches from Iconify's
  //    /<prefix>.json?icons=a,b,c endpoint (one request per prefix per
  //    batch -- a 64-tile page of "house" spans 25 prefixes, measured)
  //    and the SVG is built locally (data: URI for the preview, a real
  //    file for the import). Import needs NO request at all when the
  //    preview already loaded.
  //  - Everything fetched (icon data + search results) is cached on disk
  //    (Documents/Mótion Film Tools/icon-cache.json), so a repeated search
  //    or a re-opened AE costs zero requests for what was already seen.
  //  - Requests rotate across Iconify's three official public hosts
  //    (api.iconify.design / api.simplesvg.com / api.unisvg.com -- same
  //    data, confirmed live); a 429 cools down only that host and the
  //    next one is used. Only when all three are cooling does the panel
  //    wait (and say so), resuming automatically.
  //
  // Nothing here runs until the user types a search -- opening the
  // extension makes no Iconify request at all.
  var ICONIFY_HOSTS = ["https://api.iconify.design", "https://api.simplesvg.com", "https://api.unisvg.com"];
  var iconifyHostCooldown = [0, 0, 0];
  // Why each host is cooling: true = HTTP 429 (rate limit), false =
  // unreachable. Only used to word the toast correctly.
  var iconifyHostLimited = [false, false, false];
  var iconifyHostCursor = 0;
  var ICONIFY_RATE_COOLDOWN_MS = 60000;
  var ICONIFY_NETWORK_COOLDOWN_MS = 15000;
  var iconsRateLimitNoticeAt = 0;
  var iconsPreviewObserver = null;
  // Bumped every time the grid is torn down (new search, or the field
  // cleared). A tile captures the value at build time and ignores data
  // arriving for an older generation.
  var iconPreviewGen = 0;

  // Next host that isn't cooling down (round-robin), or -1 if none.
  function pickIconifyHost() {
    var now = Date.now();
    for (var n = 0; n < ICONIFY_HOSTS.length; n += 1) {
      var i = (iconifyHostCursor + n) % ICONIFY_HOSTS.length;
      if (now >= iconifyHostCooldown[i]) {
        iconifyHostCursor = (i + 1) % ICONIFY_HOSTS.length;
        return i;
      }
    }
    return -1;
  }

  function iconifyNextReadyIn() {
    var earliest = Math.min.apply(null, iconifyHostCooldown);
    return Math.max(0, earliest - Date.now());
  }

  function noteIconRateLimit() {
    var now = Date.now();
    if (now - iconsRateLimitNoticeAt > 8000) {
      iconsRateLimitNoticeAt = now;
      var seconds = Math.ceil(iconifyNextReadyIn() / 1000);
      var limited = iconifyHostLimited[0] || iconifyHostLimited[1] || iconifyHostLimited[2];
      setStatus(limited ?
        "Iconify is limiting requests right now -- icons will keep loading by themselves in ~" + seconds + "s." :
        "Can't reach Iconify -- check your internet connection (retrying in ~" + seconds + "s).", "error");
    }
  }

  // GET + JSON with failover across the hosts. Rejects with
  // { rateLimited: true } when every host is cooling down, { status }
  // for a real HTTP error (no point asking a mirror), or { network }.
  function iconifyFetchJson(path) {
    return new Promise(function (resolve, reject) {
      var tried = 0;
      function attempt() {
        var host = pickIconifyHost();
        if (host < 0 || tried >= ICONIFY_HOSTS.length) {
          reject(host < 0 ? { rateLimited: true } : { network: true });
          return;
        }
        tried += 1;
        fetch(ICONIFY_HOSTS[host] + path).then(function (response) {
          if (response.status === 429) {
            iconifyHostCooldown[host] = Date.now() + ICONIFY_RATE_COOLDOWN_MS;
            iconifyHostLimited[host] = true;
            attempt();
            return null;
          }
          if (!response.ok) {
            reject({ status: response.status });
            return null;
          }
          return response.json().then(resolve);
        }).catch(function () {
          // Offline / DNS / bad JSON on this host -- try the next one.
          iconifyHostCooldown[host] = Date.now() + ICONIFY_NETWORK_COOLDOWN_MS;
          iconifyHostLimited[host] = false;
          attempt();
        });
      }
      attempt();
    });
  }

  // --- Disk cache ---------------------------------------------------
  // { icons: { "prefix:name": {b,w,h,l,t} }, order: [...],
  //   searches: { term: { names, at } } }. Memory-only when Node isn't
  // available (e.g. the panel opened in a plain browser for testing).
  var ICON_CACHE_MAX_ICONS = 6000;
  var ICON_CACHE_MAX_SEARCHES = 60;
  var ICON_SEARCH_TTL_MS = 7 * 24 * 3600 * 1000;
  var iconCache = null;
  var iconCacheSaveTimer = null;

  function iconCacheFile() {
    try {
      var path = nodeRequire("path");
      return path.join(captionsPaths().toolsDir, "icon-cache.json");
    } catch (pathError) {
      return null;
    }
  }

  function loadIconCache() {
    if (iconCache) {
      return iconCache;
    }
    iconCache = { icons: {}, order: [], searches: {} };
    var file = iconCacheFile();
    if (!file) {
      return iconCache;
    }
    try {
      var fs = nodeRequire("fs");
      if (fs.existsSync(file)) {
        var parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && parsed.icons && parsed.order instanceof Array) {
          iconCache.icons = parsed.icons;
          iconCache.order = parsed.order;
          iconCache.searches = parsed.searches || {};
        }
      }
    } catch (readError) {
      // Corrupt/unreadable cache -- start empty, it rebuilds itself.
    }
    return iconCache;
  }

  function scheduleIconCacheSave() {
    if (iconCacheSaveTimer) {
      return;
    }
    iconCacheSaveTimer = window.setTimeout(function () {
      iconCacheSaveTimer = null;
      var file = iconCacheFile();
      if (!file) {
        return;
      }
      try {
        var fs = nodeRequire("fs");
        var path = nodeRequire("path");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFile(file, JSON.stringify(iconCache), "utf8", function () {});
      } catch (writeError) {
        // Non-fatal: the cache just won't survive this session.
      }
    }, 2000);
  }

  function iconCacheGet(fullName) {
    return loadIconCache().icons[fullName] || null;
  }

  function iconCachePut(fullName, entry) {
    var cache = loadIconCache();
    if (!cache.icons[fullName]) {
      cache.order.push(fullName);
      while (cache.order.length > ICON_CACHE_MAX_ICONS) {
        delete cache.icons[cache.order.shift()];
      }
    }
    cache.icons[fullName] = entry;
    scheduleIconCacheSave();
  }

  function cachedSearch(term) {
    var hit = loadIconCache().searches[term];
    if (hit && hit.names instanceof Array && Date.now() - hit.at < ICON_SEARCH_TTL_MS) {
      return hit.names;
    }
    return null;
  }

  function cacheSearch(term, names) {
    var searches = loadIconCache().searches;
    searches[term] = { names: names, at: Date.now() };
    var terms = Object.keys(searches);
    if (terms.length > ICON_CACHE_MAX_SEARCHES) {
      terms.sort(function (a, b) { return searches[a].at - searches[b].at; });
      for (var i = 0; i < terms.length - ICON_CACHE_MAX_SEARCHES; i += 1) {
        delete searches[terms[i]];
      }
    }
    scheduleIconCacheSave();
  }

  // --- Icon data -> SVG ---------------------------------------------
  // Mirrors @iconify/utils (mergeIconData + iconToSVG): resolves alias
  // chains and bakes hFlip/vFlip/rotate into the body, so the stored
  // entry is just { b: body, l, t, w, h } (viewBox) -- same output the
  // API's own .svg endpoint renders.
  function firstDefined(a, b, fallback) {
    return a !== undefined ? a : (b !== undefined ? b : fallback);
  }

  function resolveIconData(data, name) {
    var icons = data.icons || {};
    var aliases = data.aliases || {};
    var chain = [];
    var current = name;
    for (var depth = 0; depth < 6 && !icons[current]; depth += 1) {
      var alias = aliases[current];
      if (!alias || !alias.parent) {
        return null;
      }
      chain.push(alias);
      current = alias.parent;
    }
    var icon = icons[current];
    if (!icon) {
      return null;
    }
    var m = {
      body: icon.body,
      left: firstDefined(icon.left, data.left, 0),
      top: firstDefined(icon.top, data.top, 0),
      width: firstDefined(icon.width, data.width, 16),
      height: firstDefined(icon.height, data.height, 16),
      hFlip: !!icon.hFlip,
      vFlip: !!icon.vFlip,
      rotate: icon.rotate || 0
    };
    for (var c = chain.length - 1; c >= 0; c -= 1) {
      var a = chain[c];
      if (a.left !== undefined) { m.left = a.left; }
      if (a.top !== undefined) { m.top = a.top; }
      if (a.width !== undefined) { m.width = a.width; }
      if (a.height !== undefined) { m.height = a.height; }
      if (a.hFlip) { m.hFlip = !m.hFlip; }
      if (a.vFlip) { m.vFlip = !m.vFlip; }
      if (a.rotate) { m.rotate = (m.rotate + a.rotate) % 4; }
    }
    return applyIconTransforms(m);
  }

  function applyIconTransforms(m) {
    var box = { left: m.left, top: m.top, width: m.width, height: m.height };
    var transforms = [];
    var rotation = m.rotate || 0;
    var temp;
    if (m.hFlip) {
      if (m.vFlip) {
        rotation += 2;
      } else {
        transforms.push("translate(" + (box.width + box.left) + " " + (0 - box.top) + ")", "scale(-1 1)");
        box.top = box.left = 0;
      }
    } else if (m.vFlip) {
      transforms.push("translate(" + (0 - box.left) + " " + (box.height + box.top) + ")", "scale(1 -1)");
      box.top = box.left = 0;
    }
    rotation = ((rotation % 4) + 4) % 4;
    if (rotation === 1) {
      temp = box.height / 2 + box.top;
      transforms.unshift("rotate(90 " + temp + " " + temp + ")");
    } else if (rotation === 2) {
      transforms.unshift("rotate(180 " + (box.width / 2 + box.left) + " " + (box.height / 2 + box.top) + ")");
    } else if (rotation === 3) {
      temp = box.width / 2 + box.left;
      transforms.unshift("rotate(-90 " + temp + " " + temp + ")");
    }
    if (rotation % 2 === 1) {
      temp = box.left; box.left = box.top; box.top = temp;
      temp = box.width; box.width = box.height; box.height = temp;
    }
    var body = m.body;
    if (transforms.length) {
      body = '<g transform="' + transforms.join(" ") + '">' + body + "</g>";
    }
    return { b: body, l: box.left, t: box.top, w: box.width, h: box.height };
  }

  // `color` replaces currentColor (an <img>/AE can't resolve it -- see
  // the note on why both preview and import bake a colour in). `height`
  // (optional) sets a real pixel size: AE's SVG importer has no CSS
  // font-size, so Iconify's default 1em size imported near-zero.
  function buildIconSvg(entry, color, height) {
    var outH = height || entry.h;
    var outW = height ? Math.round((height * entry.w / entry.h) * 1000) / 1000 : entry.w;
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + outW +
      '" height="' + outH + '" viewBox="' + entry.l + " " + entry.t + " " + entry.w + " " + entry.h + '">' +
      entry.b.replace(/currentColor/g, color) + "</svg>";
  }

  // --- Batched request queue ----------------------------------------
  var iconDataWaiters = {};  // fullName -> [callback(entry|null)]
  var iconDataPending = {};  // prefix -> [names not yet requested]
  var iconDataInFlight = 0;
  var iconDataPumpTimer = null;
  var ICON_DATA_MAX_IN_FLIGHT = 2;
  var ICON_DATA_GAP_MS = 120;
  // Iconify's docs recommend keeping API URLs under ~500 characters.
  var ICON_DATA_MAX_URL = 450;

  function requestIconData(fullName, callback) {
    var cached = iconCacheGet(fullName);
    if (cached) {
      callback(cached);
      return;
    }
    var waiters = iconDataWaiters[fullName];
    if (waiters) {
      waiters.push(callback); // already queued or in flight
      return;
    }
    iconDataWaiters[fullName] = [callback];
    var split = fullName.indexOf(":");
    var prefix = fullName.slice(0, split);
    (iconDataPending[prefix] = iconDataPending[prefix] || []).push(fullName.slice(split + 1));
    scheduleIconDataPump(0);
  }

  function scheduleIconDataPump(delay) {
    if (!iconDataPumpTimer) {
      iconDataPumpTimer = window.setTimeout(pumpIconData, delay);
    }
  }

  function nextIconBatch() {
    for (var prefix in iconDataPending) {
      if (!iconDataPending.hasOwnProperty(prefix)) {
        continue;
      }
      var queue = iconDataPending[prefix];
      var names = [];
      var length = prefix.length + 20;
      while (queue.length && (names.length === 0 || length + queue[0].length + 1 <= ICON_DATA_MAX_URL)) {
        var name = queue.shift();
        names.push(name);
        length += name.length + 1;
      }
      if (!queue.length) {
        delete iconDataPending[prefix];
      }
      if (names.length) {
        return { prefix: prefix, names: names };
      }
    }
    return null;
  }

  function settleIconData(fullName, entry) {
    var waiters = iconDataWaiters[fullName];
    delete iconDataWaiters[fullName];
    if (!waiters) {
      return;
    }
    for (var i = 0; i < waiters.length; i += 1) {
      waiters[i](entry);
    }
  }

  function pumpIconData() {
    iconDataPumpTimer = null;
    while (iconDataInFlight < ICON_DATA_MAX_IN_FLIGHT) {
      if (iconifyNextReadyIn() > 0) {
        noteIconRateLimit();
        scheduleIconDataPump(iconifyNextReadyIn() + 300);
        return;
      }
      var batch = nextIconBatch();
      if (!batch) {
        return;
      }
      iconDataInFlight += 1;
      fetchIconBatch(batch);
    }
  }

  function fetchIconBatch(batch) {
    iconifyFetchJson("/" + batch.prefix + ".json?icons=" + batch.names.join(","))
      .then(function (data) {
        for (var i = 0; i < batch.names.length; i += 1) {
          var fullName = batch.prefix + ":" + batch.names[i];
          var entry = data ? resolveIconData(data, batch.names[i]) : null;
          if (entry) {
            iconCachePut(fullName, entry);
          }
          settleIconData(fullName, entry);
        }
      }, function (error) {
        if (error && error.rateLimited) {
          // Put the names back -- the pump resumes once a host is free.
          var queue = iconDataPending[batch.prefix] = iconDataPending[batch.prefix] || [];
          for (var r = 0; r < batch.names.length; r += 1) {
            if (iconDataWaiters[batch.prefix + ":" + batch.names[r]]) {
              queue.push(batch.names[r]);
            }
          }
          noteIconRateLimit();
          return;
        }
        for (var j = 0; j < batch.names.length; j += 1) {
          settleIconData(batch.prefix + ":" + batch.names[j], null);
        }
      })
      .then(function () {
        iconDataInFlight -= 1;
        scheduleIconDataPump(ICON_DATA_GAP_MS);
      });
  }

  function loadIconPreview(img) {
    if (!img || img.getAttribute("data-requested")) {
      return;
    }
    img.setAttribute("data-requested", "1");
    var gen = iconPreviewGen;
    requestIconData(img.getAttribute("data-icon"), function (entry) {
      if (gen !== iconPreviewGen || !img.isConnected) {
        return;
      }
      if (!entry) {
        img.style.visibility = "hidden";
        return;
      }
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildIconSvg(entry, ICON_PREVIEW_COLOR));
    });
  }

  function resetIconPreviewQueue() {
    iconPreviewGen += 1;
    // Drop everything not yet sent for the old grid. Batches already in
    // flight still land in the cache (useful later), but nothing waits
    // on them any more.
    iconDataPending = {};
    iconDataWaiters = {};
    if (iconsPreviewObserver) {
      iconsPreviewObserver.disconnect();
    }
  }

  function observeIconPreview(img) {
    if (!("IntersectionObserver" in window)) {
      loadIconPreview(img);
      return;
    }
    if (!iconsPreviewObserver) {
      iconsPreviewObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i].isIntersecting) {
            var el = entries[i].target;
            iconsPreviewObserver.unobserve(el);
            loadIconPreview(el);
          }
        }
      }, { root: $("icons-grid"), rootMargin: "200px 0px" });
    }
    iconsPreviewObserver.observe(img);
  }

  // Why buildIconSvg always bakes in a colour and (for import) a size:
  //  - The raw icon uses fill="currentColor", which only resolves inside
  //    a CSS cascade. An <img>-loaded SVG can't inherit it, and After
  //    Effects' SVG footage renderer doesn't understand it at all --
  //    confirmed live: importing a raw currentColor SVG gave a layer with
  //    the right bounding box but no visible pixels. The import is white
  //    (easy to recolour with a Fill effect / the palette).
  //  - Iconify's default size is 1em, which has no meaning in AE's SVG
  //    importer -- confirmed live it fell back to a near-zero layer
  //    (~470000% scale to look normal). A real 512px height fixes it
  //    without touching the vector paths/viewBox.
  var ICON_PREVIEW_COLOR = "#f2f0f5";
  var ICON_IMPORT_COLOR = "#ffffff";
  var ICON_IMPORT_HEIGHT = 512;

  function iconsGridMessage(text) {
    var root = $("icons-grid");
    if (!root) {
      return;
    }
    // Replacing the grid with a status line ("Searching…", an error) also
    // invalidates any previews still queued or retrying.
    resetIconPreviewQueue();
    root.innerHTML = "";
    var el = document.createElement("div");
    el.className = "icons-status";
    el.textContent = text;
    root.appendChild(el);
  }

  // Builds the SVG from the cached icon data -- normally already there
  // because the tile's preview loaded, so importing makes NO network
  // request. Only an icon clicked before its preview arrived is fetched,
  // directly (not through the preview queue, which a new search clears).
  function importIcon(fullName, tile) {
    tile.disabled = true;

    function finish(entry) {
      if (!entry) {
        tile.disabled = false;
        setStatus("Could not load this icon from Iconify.", "error");
        return;
      }
      hostCall("importSvgIcon", [buildIconSvg(entry, ICON_IMPORT_COLOR, ICON_IMPORT_HEIGHT), fullName], function (result) {
        tile.disabled = false;
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        setStatus("Imported “" + fullName + "”" + (result.addedToComp ? " and added to the composition." : "."), "success");
      });
    }

    var cached = iconCacheGet(fullName);
    if (cached) {
      finish(cached);
      return;
    }
    var split = fullName.indexOf(":");
    var prefix = fullName.slice(0, split);
    var name = fullName.slice(split + 1);
    iconifyFetchJson("/" + prefix + ".json?icons=" + name).then(function (data) {
      var entry = data ? resolveIconData(data, name) : null;
      if (entry) {
        iconCachePut(fullName, entry);
      }
      finish(entry);
    }, function (error) {
      tile.disabled = false;
      if (error && error.rateLimited) {
        noteIconRateLimit();
      } else {
        setStatus("Could not download this icon -- check your internet connection.", "error");
      }
    });
  }

  // Iconify's search matches literal icon names/tags -- great for
  // interface words ("heart", "search", "menu") but it has no thesaurus,
  // so a plain-English word for a broader concept (a profession, in
  // particular) that no icon happens to be *named* comes back with zero
  // results even though the underlying icon sets often do cover that
  // concept under a different word. Confirmed empirically (batch-tested
  // ~35 common profession words against the live API): "attorney",
  // "physician", "professor", "policeman", "salesman", "journalist",
  // "photographer", "athlete", "surgeon", "veterinarian" and "secretary"
  // all returned 0 results, while a related term that IS how icon
  // authors actually named things returns plenty. This is a small,
  // hand-verified fallback map for exactly that gap -- not a general
  // synonym engine (that would need a real thesaurus/NLP, out of scope
  // for an icon search box). Extend this list as more empty-result
  // profession/concept words come up in practice.
  var ICON_SEARCH_FALLBACK_TERMS = {
    "attorney": "law",
    "physician": "doctor",
    "professor": "teacher",
    "policeman": "police",
    "salesman": "sales",
    "journalist": "news",
    "photographer": "camera",
    "athlete": "sports",
    "surgeon": "surgery",
    "veterinarian": "vet",
    "secretary": "assistant"
  };

  // The grid used to hard-code "&limit=64" and never ask for more --
  // confirmed live that's why a common word like "house" (hundreds of
  // real matches on Iconify) always looked like exactly the same 64
  // icons no matter what was searched, and why there was nothing left
  // below to scroll to. The fix is NOT "ask Iconify for page 2 of 64"
  // though -- confirmed live that /search's own "total" field is not a
  // stable, limit-independent count at all: the exact same query
  // returned total=64 at limit=64, total=32 at limit=10, and total=689
  // at limit=999 (its search clearly does an early-exit once it's found
  // "limit" matches, and "total" just reports whatever it counted during
  // that bounded pass -- not a real total across the whole index). So
  // instead of paginating via repeated network calls with "start"
  // (unreliable given the above), do ONE search per query at Iconify's
  // actual max (999, its documented ceiling), keep the full name list in
  // memory, and reveal it into the grid ICONS_PAGE_SIZE tiles at a time
  // as the user scrolls -- pure client-side slicing, no more network
  // calls or "total" ambiguity involved.
  var ICONS_FETCH_LIMIT = 999;
  var ICONS_PAGE_SIZE = 64;

  // Tracks the in-progress/most recent search so the scroll listener
  // knows what to reveal next -- null when nothing has been searched, or
  // once every result for the current term has been shown.
  var iconsSearchState = null;

  function iconsGridNote(text) {
    var el = document.createElement("p");
    el.className = "icons-note";
    el.textContent = text;
    return el;
  }

  function iconsGridTile(fullName) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "icons-tile";
    tile.title = fullName;
    var img = document.createElement("img");
    // No alt text: while the preview is pending an empty tile reads
    // better than the browser printing the icon name inside it.
    img.alt = "";
    // Deferred: the preview is requested only when the tile nears the
    // viewport, and its SVG is built locally from batched data (see the
    // network-layer note above) -- never one request per tile.
    img.setAttribute("data-icon", fullName);
    img.addEventListener("error", function () {
      img.style.visibility = "hidden";
    });
    tile.appendChild(img);
    tile.addEventListener("click", function () {
      importIcon(fullName, tile);
    });
    observeIconPreview(img);
    return tile;
  }

  function removeIconsGridFooter() {
    var root = $("icons-grid");
    var footer = root && root.querySelector(".icons-footer");
    if (footer) {
      footer.remove();
    }
  }

  // Shows how many of the fetched matches are revealed so far -- removed
  // entirely once everything fetched has been shown (nothing more to
  // scroll to). No "loading" state needed any more: revealing more is a
  // synchronous slice of the array already in memory, not a network call.
  function updateIconsGridFooter() {
    var root = $("icons-grid");
    if (!root || !iconsSearchState) {
      return;
    }
    removeIconsGridFooter();
    var shown = iconsSearchState.shown;
    var names = iconsSearchState.allNames;
    if (shown >= names.length) {
      return;
    }
    var footer = document.createElement("div");
    footer.className = "icons-status icons-footer";
    footer.textContent = "Showing " + shown + " of " + names.length + " -- scroll for more";
    root.appendChild(footer);
  }

  function renderIconsGrid(names, note) {
    var root = $("icons-grid");
    if (!root) {
      return;
    }
    // Stop watching / queueing / retrying the tiles we are about to throw
    // away (resetIconPreviewQueue bumps the generation, clears the queue
    // and disconnects the observer).
    resetIconPreviewQueue();
    root.innerHTML = "";
    if (note) {
      root.appendChild(iconsGridNote(note));
    }
    if (!names.length) {
      // Not iconsGridMessage() here -- that clears the whole grid, which
      // would also wipe the "showing results for X instead" note above.
      var status = document.createElement("div");
      status.className = "icons-status";
      status.textContent = "No icons found. Try a more general term -- for job titles in particular, a related object or field (\"law\", \"medicine\", \"camera\"...) usually works better than the title itself.";
      root.appendChild(status);
      return;
    }
    for (var i = 0; i < names.length; i += 1) {
      root.appendChild(iconsGridTile(names[i]));
    }
  }

  function appendIconsGrid(names) {
    var root = $("icons-grid");
    if (!root) {
      return;
    }
    removeIconsGridFooter();
    for (var i = 0; i < names.length; i += 1) {
      root.appendChild(iconsGridTile(names[i]));
    }
  }

  // Search results are cached on disk for a week (see cacheSearch), so
  // repeating a search -- even after restarting AE -- costs no request.
  function fetchIconNames(term) {
    var key = term.trim().toLowerCase();
    var cached = cachedSearch(key);
    if (cached) {
      return Promise.resolve(cached);
    }
    return iconifyFetchJson("/search?query=" + encodeURIComponent(term) + "&limit=" + ICONS_FETCH_LIMIT)
      .then(function (data) {
        var names = (data && data.icons) || [];
        cacheSearch(key, names);
        return names;
      });
  }

  // Reveals the next ICONS_PAGE_SIZE names already sitting in
  // iconsSearchState.allNames -- synchronous, no network call, so there's
  // no loading state to show while it happens.
  function loadMoreIcons() {
    if (!iconsSearchState || iconsSearchState.shown >= iconsSearchState.allNames.length) {
      return;
    }
    var state = iconsSearchState;
    var nextSlice = state.allNames.slice(state.shown, state.shown + ICONS_PAGE_SIZE);
    state.shown += nextSlice.length;
    appendIconsGrid(nextSlice);
    updateIconsGridFooter();
  }

  // A short result list (or a tall panel) can render its first page
  // without ever actually overflowing the grid -- and with nothing to
  // overflow, the "scroll" listener that drives loadMoreIcons() has
  // nothing to fire on, so it would silently stall with more names still
  // sitting unrevealed in memory. Keep revealing pages right away, with
  // no user action needed, until either everything's shown or the grid
  // is genuinely scrollable (at which point the normal scroll listener
  // takes back over).
  function fillIconsGridIfNotScrollable() {
    var grid = $("icons-grid");
    if (!grid || !iconsSearchState) {
      return;
    }
    while (iconsSearchState.shown < iconsSearchState.allNames.length && grid.scrollHeight <= grid.clientHeight) {
      loadMoreIcons();
    }
  }

  function runIconSearch(query) {
    var token = (iconsSearchToken += 1);
    iconsSearchState = null;
    // Empty field -> tear everything down: grid blank, no observer, no
    // queued or retrying previews. Nothing hits api.iconify.design again
    // until the user types a new term.
    if (!query) {
      resetIconPreviewQueue();
      var root = $("icons-grid");
      if (root) {
        root.innerHTML = "";
      }
      return;
    }
    iconsGridMessage("Searching…");
    fetchIconNames(query)
      .then(function (names) {
        if (token !== iconsSearchToken) {
          return;
        }
        if (names.length) {
          var firstPage = names.slice(0, ICONS_PAGE_SIZE);
          renderIconsGrid(firstPage);
          iconsSearchState = { allNames: names, shown: firstPage.length };
          updateIconsGridFooter();
          fillIconsGridIfNotScrollable();
          return;
        }
        // Zero results for the literal word -- if it's one of the known
        // profession/concept gaps (see ICON_SEARCH_FALLBACK_TERMS above),
        // silently retry with the term icon authors actually use, but
        // still tell the user that substitution happened rather than
        // pretending "attorney" itself matched something.
        var fallback = ICON_SEARCH_FALLBACK_TERMS[query.trim().toLowerCase()];
        if (!fallback) {
          renderIconsGrid([]);
          return;
        }
        fetchIconNames(fallback)
          .then(function (fallbackNames) {
            if (token !== iconsSearchToken) {
              return;
            }
            var firstPage = fallbackNames.slice(0, ICONS_PAGE_SIZE);
            renderIconsGrid(firstPage, "No icons named “" + query.trim() + "” -- showing results for “" + fallback + "” instead.");
            if (fallbackNames.length) {
              iconsSearchState = { allNames: fallbackNames, shown: firstPage.length };
              updateIconsGridFooter();
              fillIconsGridIfNotScrollable();
            }
          })
          .catch(function () {
            if (token !== iconsSearchToken) {
              return;
            }
            renderIconsGrid([]);
          });
      })
      .catch(function (error) {
        if (token !== iconsSearchToken) {
          return;
        }
        if (error && error.rateLimited && (iconifyHostLimited[0] || iconifyHostLimited[1] || iconifyHostLimited[2])) {
          iconsGridMessage("Iconify is limiting requests right now -- search again in ~" + Math.ceil(iconifyNextReadyIn() / 1000) + "s.");
          return;
        }
        iconsGridMessage("Could not reach the icon search -- check your internet connection.");
      });
  }

  function initIconsTools() {
    var search = $("icons-search");
    if (search) {
      search.addEventListener("input", function () {
        var value = search.value.trim();
        if (iconsSearchTimer) {
          window.clearTimeout(iconsSearchTimer);
          iconsSearchTimer = null;
        }
        if (!value) {
          // Clearing the field takes effect immediately -- no debounce
          // delay before the grid empties and icon traffic stops.
          runIconSearch("");
          return;
        }
        iconsSearchTimer = window.setTimeout(function () {
          runIconSearch(value);
        }, ICONS_SEARCH_DEBOUNCE_MS);
      });
    }
    var grid = $("icons-grid");
    if (grid) {
      // 200px lookahead so the next batch reveals a little before the
      // user actually hits the bottom, instead of a visible pause.
      grid.addEventListener("scroll", function () {
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
          loadMoreIcons();
        }
      });
    }
  }

  // ---------------------------------------------------------------
  // Captions tab: transcribe the selected layer's own audio, entirely
  // locally -- no account, no per-use cost, no internet needed once the
  // one-time setup below finishes. The whole pipeline runs from this
  // panel's Node.js context (CEP's `--enable-nodejs` flag, already set in
  // the manifest): ffmpeg converts the layer's source file to a plain
  // 16kHz mono WAV, whisper.cpp transcribes that WAV to timestamped JSON,
  // and this file groups whisper's word-level tokens into sentences
  // before handing them to host.jsx's createCaptionLayers to become
  // actual text layers.
  //
  // Real bug found and worked around while building this: whisper-cli.exe
  // mis-decodes non-ASCII characters in its OWN command-line arguments
  // (confirmed live -- it's a cross-compiled, Linux-first codebase that
  // assumes UTF-8 argv, but Windows hands console apps ANSI-codepage
  // bytes by default) -- so a path like "C:\Users\Usuário\..." comes
  // out corrupted and the model fails to load. ffmpeg does NOT have this
  // bug (confirmed live, same accented path works fine). The fix used
  // here is Windows' own short (8.3) path alias -- toShortPath() below --
  // applied only to the arguments handed to whisper-cli.exe.
  // ---------------------------------------------------------------

  var CAPTIONS_WHISPER_ZIP_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip";
  var CAPTIONS_FFMPEG_ZIP_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";
  var CAPTIONS_MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

  function nodeRequire(name) {
    // CEP's Node bridge in this build shows up as `window.cep_node.require`
    // -- confirmed live that plain `window.require`/a bare `require` are
    // NOT reliably present (one early test happened to see a global
    // `require`, but that did not hold across panel reloads). cep_node is
    // the one that actually works consistently.
    var req = (window.cep_node && window.cep_node.require) || window.require || (typeof require !== "undefined" ? require : null);
    if (!req) {
      throw new Error("Node.js isn't available in this panel (missing --enable-nodejs).");
    }
    return req(name);
  }

  // macOS: whisper.cpp publishes no Mac command-line build, so the Mac
  // installer (.pkg, built on a GitHub Actions Mac -- see
  // installer/mac/) ships its own whisper-cli, same whisper.cpp tag as the
  // Windows zip above, inside the extension at bin/mac/. ffmpeg comes from
  // ffmpeg-static's macOS builds (one gzipped binary per CPU). Downloaded
  // by Node, so neither gets the quarantine flag that would block it.
  var CAPTIONS_FFMPEG_MAC_URL = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-";

  function captionsIsMac() {
    return nodeRequire("os").platform() === "darwin";
  }

  function captionsExtensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; } // macOS
    return p;
  }

  function captionsPaths() {
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var toolsDir = path.join(os.homedir(), "Documents", "Mótion Film Tools");
    var mac = captionsIsMac();
    return {
      toolsDir: toolsDir,
      whisperDir: path.join(toolsDir, "whisper"),
      whisperExe: mac
        ? path.join(captionsExtensionDir(), "bin", "mac", "whisper-cli")
        : path.join(toolsDir, "whisper", "whisper-cli.exe"),
      ffmpegDir: path.join(toolsDir, "ffmpeg"),
      ffmpegExe: path.join(toolsDir, "ffmpeg", mac ? "ffmpeg" : "ffmpeg.exe"),
      modelPath: path.join(toolsDir, "models", "ggml-small.bin"),
      tempDir: path.join(toolsDir, "temp")
    };
  }

  function checkCaptionsToolsInstalled() {
    var fs = nodeRequire("fs");
    var p = captionsPaths();
    return fs.existsSync(p.whisperExe) && fs.existsSync(p.ffmpegExe) && fs.existsSync(p.modelPath);
  }

  function downloadFile(url, destPath, onProgress) {
    return new Promise(function (resolve, reject) {
      var https = nodeRequire("https");
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      function get(currentUrl, redirectsLeft) {
        https.get(currentUrl, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error("Too many redirects downloading " + url));
              return;
            }
            get(res.headers.location, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error("Download failed (HTTP " + res.statusCode + ") for " + currentUrl));
            return;
          }
          var total = parseInt(res.headers["content-length"] || "0", 10);
          var received = 0;
          var file = fs.createWriteStream(destPath);
          res.on("data", function (chunk) {
            received += chunk.length;
            if (onProgress && total) {
              onProgress(received / total);
            }
          });
          res.pipe(file);
          file.on("finish", function () {
            file.close(function () {
              resolve();
            });
          });
          file.on("error", reject);
        }).on("error", reject);
      }

      get(url, 5);
    });
  }

  // Deliberately built on spawn()+"exit", not execFile() (which waits for
  // the "close" event). Confirmed live in this Node-in-CEP embedding:
  // ffmpeg.exe and whisper-cli.exe both emit "exit" within milliseconds
  // of actually finishing (measured directly), but never emit "close" at
  // all -- their stdio pipes never signal EOF even though the process
  // itself is long gone. execFile's callback is tied to "close", so it
  // hung indefinitely (the only thing that ever "resolved" it was an
  // unrelated timeout forcibly killing an already-finished process).
  // "exit" is a strict subset of what "close" waits for -- it always
  // fires at or before "close" would -- so this is a pure fix, not a
  // trade-off.
  function runCommand(exePath, args, options) {
    return new Promise(function (resolve, reject) {
      var cp = nodeRequire("child_process");
      var opts = options || {};
      var child = cp.spawn(exePath, args, { windowsHide: true });
      var stdout = "";
      var stderr = "";
      var settled = false;
      var timer = null;

      function finish(err, result) {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }

      if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", function (chunk) {
          stdout += chunk;
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", function (chunk) {
          stderr += chunk;
        });
      }
      child.on("error", function (err) {
        finish(err);
      });
      child.on("exit", function (code) {
        if (code !== 0) {
          var err = new Error("Command failed (exit code " + code + "): " + exePath);
          err.stdout = stdout;
          err.stderr = stderr;
          finish(err);
          return;
        }
        finish(null, { stdout: stdout, stderr: stderr });
      });
      if (opts.timeout) {
        timer = setTimeout(function () {
          try {
            child.kill();
          } catch (killError) {
            // Non-fatal -- we're erroring out either way.
          }
          finish(new Error("Command timed out after " + opts.timeout + "ms: " + exePath));
        }, opts.timeout);
      }
    });
  }

  // Windows keeps an ASCII-only 8.3 alias for every long/Unicode path --
  // this reads it back via a `for` loop, a cmd.exe builtin (not an
  // executable), so there's no separate encoding-prone process involved.
  // Only works on a path that already exists on disk.
  function toShortPath(longPath) {
    // macOS has no 8.3 names and whisper-cli reads UTF-8 argv fine there.
    if (nodeRequire("os").platform() !== "win32") {
      return Promise.resolve(longPath);
    }
    return new Promise(function (resolve, reject) {
      var cp = nodeRequire("child_process");
      var cmd = 'for %I in ("' + longPath + '") do @echo %~sI';
      cp.exec(cmd, { timeout: 10000 }, function (err, stdout) {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  function extractZip(zipPath, destDir) {
    var fs = nodeRequire("fs");
    fs.mkdirSync(destDir, { recursive: true });
    var psCommand = "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") + "' -DestinationPath '" + destDir.replace(/'/g, "''") + "' -Force";
    return runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { maxBuffer: 1024 * 1024 * 20, timeout: 120000 });
  }

  function findFileRecursive(dir, fileName) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i += 1) {
      var full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) {
        var found = findFileRecursive(full, fileName);
        if (found) {
          return found;
        }
      } else if (entries[i].name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
    }
    return null;
  }

  function setCaptionsSetupStatus(text, fraction) {
    var statusEl = $("captions-setup-status-text");
    var fillEl = $("captions-progress-fill");
    if (statusEl) {
      statusEl.textContent = text;
    }
    if (fillEl && typeof fraction === "number") {
      fillEl.style.width = Math.round(fraction * 100) + "%";
    }
  }

  function showCaptionsSetupUI() {
    var setup = $("captions-setup");
    var main = $("captions-main");
    if (setup) {
      setup.hidden = false;
    }
    if (main) {
      main.hidden = true;
    }
  }

  function showCaptionsMainUI() {
    var setup = $("captions-setup");
    var main = $("captions-main");
    if (setup) {
      setup.hidden = true;
    }
    if (main) {
      main.hidden = false;
    }
  }

  function refreshCaptionsSetupState() {
    try {
      if (checkCaptionsToolsInstalled()) {
        showCaptionsMainUI();
      } else {
        showCaptionsSetupUI();
      }
    } catch (error) {
      showCaptionsSetupUI();
    }
  }

  function setupCaptionsTools() {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var p = captionsPaths();
    var button = $("captions-setup-button");
    var progress = $("captions-setup-progress");
    if (button) {
      button.disabled = true;
    }
    if (progress) {
      progress.hidden = false;
    }

    if (captionsIsMac()) {
      setupCaptionsToolsMac(p, button);
      return;
    }

    var scratchDir = path.join(p.toolsDir, "_download-temp");
    fs.mkdirSync(scratchDir, { recursive: true });
    var whisperZip = path.join(scratchDir, "whisper-bin-x64.zip");
    var ffmpegZip = path.join(scratchDir, "ffmpeg-build.zip");
    var ffmpegExtractDir = path.join(scratchDir, "ffmpeg-extracted");

    setCaptionsSetupStatus("Downloading speech-recognition engine (~8MB)…", 0);
    downloadFile(CAPTIONS_WHISPER_ZIP_URL, whisperZip, function (frac) {
      setCaptionsSetupStatus("Downloading speech-recognition engine (~8MB)… " + Math.round(frac * 100) + "%", frac * 0.05);
    }).then(function () {
      setCaptionsSetupStatus("Extracting speech-recognition engine…", 0.06);
      return extractZip(whisperZip, p.whisperDir);
    }).then(function () {
      // whisper-bin-x64.zip nests everything inside a "Release" folder --
      // flatten it straight into whisperDir.
      var releaseDir = path.join(p.whisperDir, "Release");
      if (fs.existsSync(releaseDir)) {
        var entries = fs.readdirSync(releaseDir);
        for (var i = 0; i < entries.length; i += 1) {
          fs.renameSync(path.join(releaseDir, entries[i]), path.join(p.whisperDir, entries[i]));
        }
        fs.rmdirSync(releaseDir);
      }
      setCaptionsSetupStatus("Downloading audio converter (~65MB)…", 0.08);
      return downloadFile(CAPTIONS_FFMPEG_ZIP_URL, ffmpegZip, function (frac) {
        setCaptionsSetupStatus("Downloading audio converter (~65MB)… " + Math.round(frac * 100) + "%", 0.08 + frac * 0.25);
      });
    }).then(function () {
      setCaptionsSetupStatus("Extracting audio converter…", 0.34);
      return extractZip(ffmpegZip, ffmpegExtractDir);
    }).then(function () {
      var found = findFileRecursive(ffmpegExtractDir, "ffmpeg.exe");
      if (!found) {
        throw new Error("Could not find ffmpeg.exe in the downloaded package.");
      }
      fs.mkdirSync(p.ffmpegDir, { recursive: true });
      fs.copyFileSync(found, p.ffmpegExe);
      setCaptionsSetupStatus("Downloading language model (~465MB, this is the big one)…", 0.36);
      return downloadFile(CAPTIONS_MODEL_URL, p.modelPath, function (frac) {
        setCaptionsSetupStatus("Downloading language model (~465MB, this is the big one)… " + Math.round(frac * 100) + "%", 0.36 + frac * 0.62);
      });
    }).then(function () {
      setCaptionsSetupStatus("Cleaning up temporary files…", 0.99);
      try {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Non-fatal -- the tools themselves are already in place.
      }
      setCaptionsSetupStatus("Done! Ready to transcribe.", 1);
      setStatus("Setup complete -- ready to transcribe.", "success");
      showCaptionsMainUI();
    }).catch(function (error) {
      var message = String((error && error.message) || error);
      setCaptionsSetupStatus("Setup failed: " + message, 0);
      setStatus("Captions setup failed: " + message, "error");
      if (button) {
        button.disabled = false;
      }
    });
  }

  // Mac version of the one-time setup: whisper-cli already came with the
  // installer, so only ffmpeg (for this CPU) and the model are downloaded.
  function setupCaptionsToolsMac(p, button) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var arch = nodeRequire("os").arch() === "arm64" ? "arm64" : "x64";
    var gzPath = path.join(p.toolsDir, "_download-temp", "ffmpeg.gz");

    Promise.resolve().then(function () {
      if (!fs.existsSync(p.whisperExe)) {
        throw new Error("whisper-cli is missing from the extension -- reinstall Mótion Film with the Mac installer (.pkg).");
      }
      setCaptionsSetupStatus("Downloading audio converter (~25MB)…", 0.02);
      return downloadFile(CAPTIONS_FFMPEG_MAC_URL + arch + ".gz", gzPath, function (frac) {
        setCaptionsSetupStatus("Downloading audio converter (~25MB)… " + Math.round(frac * 100) + "%", 0.02 + frac * 0.2);
      });
    }).then(function () {
      setCaptionsSetupStatus("Extracting audio converter…", 0.23);
      fs.mkdirSync(p.ffmpegDir, { recursive: true });
      fs.writeFileSync(p.ffmpegExe, nodeRequire("zlib").gunzipSync(fs.readFileSync(gzPath)));
      fs.chmodSync(p.ffmpegExe, 493); // 0755
      setCaptionsSetupStatus("Downloading language model (~465MB, this is the big one)…", 0.25);
      return downloadFile(CAPTIONS_MODEL_URL, p.modelPath, function (frac) {
        setCaptionsSetupStatus("Downloading language model (~465MB, this is the big one)… " + Math.round(frac * 100) + "%", 0.25 + frac * 0.73);
      });
    }).then(function () {
      try {
        fs.rmSync(path.dirname(gzPath), { recursive: true, force: true });
      } catch (cleanupError) {
        // Non-fatal.
      }
      setCaptionsSetupStatus("Done! Ready to transcribe.", 1);
      setStatus("Setup complete -- ready to transcribe.", "success");
      showCaptionsMainUI();
    }).catch(function (error) {
      var message = String((error && error.message) || error);
      setCaptionsSetupStatus("Setup failed: " + message, 0);
      setStatus("Captions setup failed: " + message, "error");
      if (button) {
        button.disabled = false;
      }
    });
  }

  // whisper.cpp emits several kinds of bracketed meta tokens mixed into
  // the real word tokens -- not just "[_BEG_]", but also internal
  // alignment markers like "[_TT_444]" (confirmed live: a narrower
  // "[_..._]" pattern missed those, and they leaked straight into
  // caption text, mid-sentence). Actual transcribed speech never comes
  // back bracket-wrapped, so filtering out anything fully "[...]" is
  // safe. Returns a flat, ordered list -- segment boundaries dropped,
  // since they don't align with sentence or line boundaries anyway.
  function flattenWhisperTokens(whisperResult) {
    var segments = (whisperResult && whisperResult.transcription) || [];
    var tokens = [];
    for (var i = 0; i < segments.length; i += 1) {
      var segTokens = segments[i].tokens || [];
      for (var j = 0; j < segTokens.length; j += 1) {
        var raw = segTokens[j].text || "";
        if (/^\[.*\]$/.test(raw.replace(/^\s+|\s+$/g, ""))) {
          continue;
        }
        var offsets = segTokens[j].offsets || {};
        tokens.push({
          text: raw,
          start: (offsets.from || 0) / 1000,
          end: (offsets.to || offsets.from || 0) / 1000
        });
      }
    }
    return tokens;
  }

  // whisper.cpp frequently splits one real word into several tokens
  // (subword/BPE pieces, or punctuation glued onto the previous word) --
  // a token starting with whitespace marks the start of a NEW word, one
  // with no leading whitespace is a continuation of the previous token.
  // Confirmed live this distinction matters: packing/wrapping directly
  // off the raw token stream let a caption or line break land exactly
  // between two pieces of the same word, visibly splitting it in half.
  // This merges the flat token stream into whole, never-split words
  // before anything else touches character counts.
  function flattenWhisperWords(whisperResult) {
    var tokens = flattenWhisperTokens(whisperResult);
    var words = [];
    for (var i = 0; i < tokens.length; i += 1) {
      var raw = tokens[i].text;
      if (words.length === 0 || /^\s/.test(raw)) {
        words.push({ text: raw.replace(/^\s+/, ""), start: tokens[i].start, end: tokens[i].end });
      } else {
        var last = words[words.length - 1];
        last.text += raw;
        last.end = tokens[i].end;
      }
    }
    return words;
  }

  // Groups whisper's words into captions according to the user's chosen
  // length mode:
  // - "word": one caption per whole word, ignoring the character limit
  //   entirely (there's nothing to wrap or pack).
  // - "1-line"/"2-lines": for each caption, fills up to `lineCount` lines
  //   one at a time, each independently bounded at `charLimit` -- a word
  //   that would push a line over the limit starts the NEXT line (or the
  //   next caption, once `lineCount` lines are already full) instead.
  //   Filling ever stops early the moment a word ends in sentence
  //   punctuation, so a caption never spans past a sentence boundary even
  //   with room left on the line. Packing whole words (see
  //   flattenWhisperWords above) means a break can only ever land between
  //   two real words, never mid-word -- and bounding EVERY line
  //   individually (not just the first, then splitting the leftover
  //   into a second line) means the character limit actually holds on
  //   both lines, not just the first.
  function buildCaptionsFromTranscript(whisperResult, settings) {
    var words = flattenWhisperWords(whisperResult);

    if (settings.length === "word") {
      var wordCaptions = [];
      for (var w = 0; w < words.length; w += 1) {
        if (words[w].text) {
          wordCaptions.push({ text: words[w].text, start: words[w].start, end: words[w].end });
        }
      }
      return wordCaptions;
    }

    var perLine = settings.charLimit;
    var lineCount = settings.length === "2-lines" ? 2 : 1;
    var captions = [];
    var wi = 0;

    function endsSentence(word) {
      return /[.!?]$/.test(word.text);
    }

    while (wi < words.length) {
      var lines = [];
      var start = words[wi].start;
      var end = words[wi].end;
      var stoppedForSentence = false;
      for (var lineIdx = 0; lineIdx < lineCount && !stoppedForSentence; lineIdx += 1) {
        if (wi >= words.length) {
          break;
        }
        var lineWords = [];
        var used = 0;
        while (wi < words.length) {
          var word = words[wi];
          var next = lineWords.length ? used + 1 + word.text.length : word.text.length;
          if (lineWords.length && next > perLine) {
            break; // doesn't fit on this line -- next line, or next caption
          }
          lineWords.push(word.text);
          used = next;
          end = word.end;
          wi += 1;
          if (endsSentence(word)) {
            stoppedForSentence = true;
            break;
          }
        }
        if (!lineWords.length) {
          // one word alone is already longer than the limit -- keep it
          // whole on its own line rather than looping forever.
          lineWords.push(words[wi].text);
          end = words[wi].end;
          wi += 1;
        }
        lines.push(lineWords.join(" "));
      }
      captions.push({ text: lines.join("\r"), start: start, end: end });
    }

    return captions;
  }

  // ---------------------------------------------------------------
  // Caption Settings modal -- opened from "Transcribe Selected Layer"
  // instead of running immediately. Everything here (length mode,
  // character limit, presets, language) is persisted to localStorage so
  // it's remembered across panel reloads, same pattern as the Kit rail
  // width and appearance settings elsewhere in this file.
  // ---------------------------------------------------------------

  var CAPTIONS_SETTINGS_KEY = "motionfilm-caption-settings";
  var CAPTIONS_CUSTOM_PRESETS_KEY = "motionfilm-caption-presets";

  var CAPTION_BUILTIN_PRESETS = [
    { id: "default", name: "Default", length: "2-lines", charLimit: 42 },
    { id: "single-line", name: "Single Line", length: "1-line", charLimit: 32 },
    { id: "word-by-word", name: "Word by Word", length: "word", charLimit: 42 }
  ];

  // The official whisper language table (99 languages -- same list
  // whisper.cpp itself ships with), plus "auto" prepended as the default.
  var WHISPER_LANGUAGES = [
    ["en", "English"], ["zh", "Chinese"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"],
    ["ko", "Korean"], ["fr", "French"], ["ja", "Japanese"], ["pt", "Portuguese"], ["tr", "Turkish"],
    ["pl", "Polish"], ["ca", "Catalan"], ["nl", "Dutch"], ["ar", "Arabic"], ["sv", "Swedish"],
    ["it", "Italian"], ["id", "Indonesian"], ["hi", "Hindi"], ["fi", "Finnish"], ["vi", "Vietnamese"],
    ["he", "Hebrew"], ["uk", "Ukrainian"], ["el", "Greek"], ["ms", "Malay"], ["cs", "Czech"],
    ["ro", "Romanian"], ["da", "Danish"], ["hu", "Hungarian"], ["ta", "Tamil"], ["no", "Norwegian"],
    ["th", "Thai"], ["ur", "Urdu"], ["hr", "Croatian"], ["bg", "Bulgarian"], ["lt", "Lithuanian"],
    ["la", "Latin"], ["mi", "Maori"], ["ml", "Malayalam"], ["cy", "Welsh"], ["sk", "Slovak"],
    ["te", "Telugu"], ["fa", "Persian"], ["lv", "Latvian"], ["bn", "Bengali"], ["sr", "Serbian"],
    ["az", "Azerbaijani"], ["sl", "Slovenian"], ["kn", "Kannada"], ["et", "Estonian"], ["mk", "Macedonian"],
    ["br", "Breton"], ["eu", "Basque"], ["is", "Icelandic"], ["hy", "Armenian"], ["ne", "Nepali"],
    ["mn", "Mongolian"], ["bs", "Bosnian"], ["kk", "Kazakh"], ["sq", "Albanian"], ["sw", "Swahili"],
    ["gl", "Galician"], ["mr", "Marathi"], ["pa", "Punjabi"], ["si", "Sinhala"], ["km", "Khmer"],
    ["sn", "Shona"], ["yo", "Yoruba"], ["so", "Somali"], ["af", "Afrikaans"], ["oc", "Occitan"],
    ["ka", "Georgian"], ["be", "Belarusian"], ["tg", "Tajik"], ["sd", "Sindhi"], ["gu", "Gujarati"],
    ["am", "Amharic"], ["yi", "Yiddish"], ["lo", "Lao"], ["uz", "Uzbek"], ["fo", "Faroese"],
    ["ht", "Haitian Creole"], ["ps", "Pashto"], ["tk", "Turkmen"], ["nn", "Nynorsk"], ["mt", "Maltese"],
    ["sa", "Sanskrit"], ["lb", "Luxembourgish"], ["my", "Myanmar"], ["bo", "Tibetan"], ["tl", "Tagalog"],
    ["mg", "Malagasy"], ["as", "Assamese"], ["tt", "Tatar"], ["haw", "Hawaiian"], ["ln", "Lingala"],
    ["ha", "Hausa"], ["ba", "Bashkir"], ["jw", "Javanese"], ["su", "Sundanese"], ["yue", "Cantonese"]
  ].map(function (pair) {
    return { value: pair[0], label: pair[1] };
  });

  var captionsSettingsCache = null;

  function loadCaptionsSettings() {
    if (captionsSettingsCache) {
      return captionsSettingsCache;
    }
    var settings = { length: "2-lines", charLimit: 42, presetId: "default", language: "auto", stylePresetId: null };
    try {
      var raw = window.localStorage.getItem(CAPTIONS_SETTINGS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.length) {
          settings.length = parsed.length;
        }
        if (parsed.charLimit) {
          settings.charLimit = parsed.charLimit;
        }
        if (parsed.presetId) {
          settings.presetId = parsed.presetId;
        }
        if (parsed.language) {
          settings.language = parsed.language;
        }
        if (parsed.stylePresetId) {
          settings.stylePresetId = parsed.stylePresetId;
        }
      }
    } catch (readError) {
      // Fall back to defaults.
    }
    captionsSettingsCache = settings;
    return settings;
  }

  function saveCaptionsSettings() {
    try {
      window.localStorage.setItem(CAPTIONS_SETTINGS_KEY, JSON.stringify(captionsSettingsCache));
    } catch (writeError) {
      // Non-fatal -- just won't persist across reloads.
    }
  }

  function loadCustomCaptionPresets() {
    try {
      var raw = window.localStorage.getItem(CAPTIONS_CUSTOM_PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (readError) {
      return [];
    }
  }

  function saveCustomCaptionPresets(list) {
    try {
      window.localStorage.setItem(CAPTIONS_CUSTOM_PRESETS_KEY, JSON.stringify(list));
    } catch (writeError) {
      // Non-fatal.
    }
  }

  function allCaptionPresets() {
    return CAPTION_BUILTIN_PRESETS.concat(loadCustomCaptionPresets());
  }

  // ---------------------------------------------------------------
  // A single reusable dropdown-style picker: an optionally-searchable
  // list of {value,label} with a dot marking the current selection, plus
  // an optional "save new" footer (name field + button). Shares the
  // .fp-popover/.fp-list/.fp-item CSS with the existing font picker and
  // Direction picker so it looks native to the rest of the panel instead
  // of inventing new visual language -- kept as its own component (not
  // folded into buildFontPicker/buildChoicePicker) so those two known-
  // working pickers stay untouched.
  //
  // NOTE: deliberately NOT using window.prompt() for the "save new"
  // input -- confirmed live that calling it froze this panel's entire JS
  // thread solid (even a trivial `1+1` stopped responding), with no
  // dialog CDP could detect or dismiss; recovering required closing and
  // reopening the panel from AE itself. Whatever this CEP build does
  // with native dialogs, it isn't safe to call -- every input in this
  // panel, this one included, has to be a normal in-page element.
  // ---------------------------------------------------------------

  var optionPicker = null;

  function buildOptionPicker() {
    var root = document.createElement("div");
    root.className = "fp-popover";
    root.hidden = true;
    root.innerHTML = '<input class="fp-search" type="text" spellcheck="false" placeholder="Search" hidden />' +
      '<div class="fp-list"></div>' +
      '<div class="option-picker-add" hidden>' +
        '<input type="text" class="option-picker-add-input" spellcheck="false" />' +
        '<button type="button" class="option-picker-add-button">Save</button>' +
      '</div>';
    document.body.appendChild(root);

    var picker = {
      root: root,
      search: root.querySelector(".fp-search"),
      list: root.querySelector(".fp-list"),
      addRow: root.querySelector(".option-picker-add"),
      addInput: root.querySelector(".option-picker-add-input"),
      addButton: root.querySelector(".option-picker-add-button"),
      options: [],
      selectedValue: null,
      onPick: null,
      onAdd: null,
      onRemove: null
    };

    function render() {
      var query = picker.search.hidden ? "" : picker.search.value.trim().toLowerCase();
      var filtered = [];
      for (var i = 0; i < picker.options.length; i += 1) {
        if (!query || picker.options[i].label.toLowerCase().indexOf(query) !== -1) {
          filtered.push(picker.options[i]);
        }
      }
      picker.list.innerHTML = "";
      if (!filtered.length) {
        var empty = document.createElement("div");
        empty.className = "fp-empty";
        empty.textContent = "No matches.";
        picker.list.appendChild(empty);
        return;
      }
      for (var j = 0; j < filtered.length; j += 1) {
        (function (option) {
          var item = document.createElement("button");
          item.type = "button";
          item.className = "fp-item" + (option.value === picker.selectedValue ? " is-selected" : "");
          var dot = document.createElement("span");
          dot.className = "fp-item-dot";
          item.appendChild(dot);
          var label = document.createElement("span");
          label.textContent = option.label;
          item.appendChild(label);
          if (option.removable) {
            var removeBtn = document.createElement("span");
            removeBtn.className = "fp-item-remove";
            removeBtn.textContent = "×";
            removeBtn.title = "Delete this preset";
            removeBtn.addEventListener("click", function (event) {
              event.stopPropagation();
              var onRemove = picker.onRemove;
              if (onRemove) {
                onRemove(option.value);
              }
            });
            item.appendChild(removeBtn);
          }
          item.addEventListener("click", function () {
            var onPick = picker.onPick;
            closeOptionPicker();
            if (onPick) {
              onPick(option.value);
            }
          });
          picker.list.appendChild(item);
        }(filtered[j]));
      }
    }

    picker.render = render;

    picker.setOptions = function (options, selectedValue, config) {
      config = config || {};
      picker.options = options;
      picker.selectedValue = selectedValue;
      picker.search.hidden = !config.searchable;
      picker.search.value = "";
      picker.addRow.hidden = !config.allowAdd;
      picker.addInput.value = "";
      picker.addInput.placeholder = config.addPlaceholder || "New name";
      render();
    };

    picker.search.addEventListener("input", render);
    picker.addButton.addEventListener("click", function () {
      var name = picker.addInput.value.trim();
      if (!name) {
        return;
      }
      var onAdd = picker.onAdd;
      closeOptionPicker();
      if (onAdd) {
        onAdd(name);
      }
    });
    picker.addInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        picker.addButton.click();
      }
    });
    root.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    return picker;
  }

  function closeOptionPicker() {
    if (optionPicker) {
      optionPicker.root.hidden = true;
      optionPicker.onPick = null;
      optionPicker.onAdd = null;
      optionPicker.onRemove = null;
    }
  }

  function openOptionPicker(trigger, options, selectedValue, config, onPick) {
    if (!optionPicker) {
      optionPicker = buildOptionPicker();
    }
    optionPicker.setOptions(options, selectedValue, config);
    optionPicker.onPick = onPick;
    optionPicker.onAdd = config && config.onAdd;
    optionPicker.onRemove = config && config.onRemove;

    var rect = trigger.getBoundingClientRect();
    optionPicker.root.hidden = false;
    var width = optionPicker.root.offsetWidth || 220;
    var height = optionPicker.root.offsetHeight || 220;
    var left = Math.min(rect.left, window.innerWidth - width - 8);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight) {
      top = Math.max(6, rect.top - height - 6);
    }
    optionPicker.root.style.left = Math.max(6, left) + "px";
    optionPicker.root.style.top = top + "px";
    if (config && config.searchable) {
      optionPicker.search.focus();
    }
  }

  function captionPresetLabel(settings) {
    var presets = allCaptionPresets();
    for (var i = 0; i < presets.length; i += 1) {
      if (presets[i].id === settings.presetId) {
        return presets[i].name;
      }
    }
    return "Custom";
  }

  function captionLanguageLabel(code) {
    if (code === "auto") {
      return "Auto-detect";
    }
    for (var i = 0; i < WHISPER_LANGUAGES.length; i += 1) {
      if (WHISPER_LANGUAGES[i].value === code) {
        return WHISPER_LANGUAGES[i].label;
      }
    }
    return code;
  }

  function renderCaptionsLengthSegmented(activeValue) {
    var buttons = document.querySelectorAll("#captions-length-segmented .segmented-option");
    for (var i = 0; i < buttons.length; i += 1) {
      var isActive = buttons[i].getAttribute("data-value") === activeValue;
      buttons[i].classList.toggle("is-active", isActive);
    }
  }

  function updateCaptionsCharLimitField(settings) {
    var input = $("captions-charlimit-input");
    if (!input) {
      return;
    }
    input.value = settings.charLimit;
    input.disabled = settings.length === "word";
  }

  function updateCaptionsPresetButton(settings) {
    var button = $("captions-preset-button");
    if (button) {
      button.textContent = captionPresetLabel(settings);
    }
  }

  function updateCaptionsLanguageButton(settings) {
    var button = $("captions-language-button");
    if (button) {
      button.textContent = captionLanguageLabel(settings.language);
    }
  }

  function refreshCaptionsModalFields() {
    var settings = loadCaptionsSettings();
    renderCaptionsLengthSegmented(settings.length);
    updateCaptionsCharLimitField(settings);
    updateCaptionsPresetButton(settings);
    updateCaptionsStylePresetButton(settings);
    updateCaptionsLanguageButton(settings);
  }

  function applyCaptionPreset(presetId) {
    var preset = null;
    var presets = allCaptionPresets();
    for (var i = 0; i < presets.length; i += 1) {
      if (presets[i].id === presetId) {
        preset = presets[i];
        break;
      }
    }
    if (!preset) {
      return;
    }
    var settings = loadCaptionsSettings();
    settings.presetId = preset.id;
    settings.length = preset.length;
    settings.charLimit = preset.charLimit;
    saveCaptionsSettings();
    refreshCaptionsModalFields();
  }

  function saveCurrentSettingsAsPreset(name) {
    var settings = loadCaptionsSettings();
    var id = "custom-" + Date.now();
    var custom = loadCustomCaptionPresets();
    custom.push({ id: id, name: name, length: settings.length, charLimit: settings.charLimit });
    saveCustomCaptionPresets(custom);
    settings.presetId = id;
    saveCaptionsSettings();
    updateCaptionsPresetButton(settings);
  }

  function removeCustomCaptionPreset(presetId) {
    var custom = loadCustomCaptionPresets().filter(function (preset) {
      return preset.id !== presetId;
    });
    saveCustomCaptionPresets(custom);
    var settings = loadCaptionsSettings();
    if (settings.presetId === presetId) {
      applyCaptionPreset("default");
    }
    // Re-open the picker with the updated list so a delete click doesn't
    // just close the whole thing.
    openCaptionPresetPicker(lastCaptionPresetTrigger);
  }

  var lastCaptionPresetTrigger = null;

  function openCaptionPresetPicker(trigger) {
    lastCaptionPresetTrigger = trigger;
    var settings = loadCaptionsSettings();
    var custom = loadCustomCaptionPresets();
    var options = CAPTION_BUILTIN_PRESETS.map(function (preset) {
      return { value: preset.id, label: preset.name, removable: false };
    }).concat(custom.map(function (preset) {
      return { value: preset.id, label: preset.name, removable: true };
    }));
    openOptionPicker(trigger, options, settings.presetId, {
      allowAdd: true,
      addPlaceholder: "Save current as…",
      onAdd: saveCurrentSettingsAsPreset,
      onRemove: removeCustomCaptionPreset
    }, applyCaptionPreset);
  }

  function openCaptionsLanguagePicker(trigger) {
    var settings = loadCaptionsSettings();
    var options = [{ value: "auto", label: "Auto-detect" }].concat(WHISPER_LANGUAGES);
    openOptionPicker(trigger, options, settings.language, { searchable: true }, function (value) {
      settings.language = value;
      saveCaptionsSettings();
      updateCaptionsLanguageButton(settings);
    });
  }

  // ---------------------------------------------------------------
  // Style presets: capture every effect/Text Animator/animated Transform
  // property off a text layer the user already styled by hand (see
  // captureLayerStylePreset in host.jsx for the actual property-tree
  // walk), so the same setup can be stamped onto every caption layer a
  // transcription creates -- entrance animations included, each
  // re-anchored to its own layer's start.
  // ---------------------------------------------------------------

  var STYLE_PRESETS_KEY = "motionfilm-style-presets";

  function loadStylePresets() {
    try {
      var raw = window.localStorage.getItem(STYLE_PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (readError) {
      return [];
    }
  }

  function saveStylePresets(list) {
    try {
      window.localStorage.setItem(STYLE_PRESETS_KEY, JSON.stringify(list));
    } catch (writeError) {
      // Non-fatal -- just won't persist across reloads. A style preset's
      // captured keyframes/expressions can get sizeable, so this is the
      // one localStorage write in the panel most likely to ever hit a
      // quota ceiling -- failing quietly (instead of throwing up through
      // the click handler) keeps the rest of the panel usable either way.
    }
  }

  // ---------------------------------------------------------------
  // Import / Export -- lets a production team standardize a style
  // preset (or a whole library of them) as a shareable .json file:
  // build the look once on a reference project, export it, drop the
  // file on a shared drive / Slack / email, and every editor working
  // that client's videos imports the same file instead of rebuilding
  // the look by hand on their own machine.
  // ---------------------------------------------------------------

  function sanitizeFileNamePart(name) {
    // Windows forbids \ / : * ? " < > | in a filename -- swap each for
    // a space and collapse repeats so e.g. "Cliente: Loja X/Y" stays
    // a sane, readable filename instead of erroring out.
    var cleaned = String(name || "Style Preset").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return cleaned || "Style Preset";
  }

  function buildStylePresetExportEnvelope(entries) {
    var presets = [];
    for (var i = 0; i < entries.length; i += 1) {
      presets.push({ name: entries[i].name, preset: entries[i].preset });
    }
    return {
      motionFilmStylePresetsFile: true,
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      presets: presets
    };
  }

  // Writes a text file to disk, preferring the native CEP save dialog
  // (lets the editor pick exactly where -- a shared client folder, for
  // this use case) and falling back to a browser Blob download if
  // that API isn't available. Confirmed live in this CEP build:
  // window.cep.fs.showSaveDialogEx/writeFile both exist and work.
  function saveTextFileWithNativeDialog(title, defaultName, contents, onDone) {
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx && window.cep.fs.writeFile) {
        var choice = window.cep.fs.showSaveDialogEx(title, "", ["json"], defaultName);
        var chosen = choice && choice.data;
        if (Array.isArray(chosen)) {
          chosen = chosen[0];
        }
        if (!chosen) {
          onDone(false, null); // user cancelled the dialog -- not an error, stay quiet
          return;
        }
        if (!/\.json$/i.test(chosen)) {
          chosen += ".json";
        }
        var written = window.cep.fs.writeFile(chosen, contents);
        if (!written || written.err === 0) {
          onDone(true, chosen);
        } else {
          onDone(false, null, "Could not write the file (error " + written.err + ").");
        }
        return;
      }
    } catch (nativeError) {
      // Fall through to the Blob fallback below.
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
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
      onDone(true, defaultName + ".json");
    } catch (blobError) {
      onDone(false, null, "Export failed.");
    }
  }

  // Writes raw bytes (a Uint8Array) to a file the user picks. Used for
  // the Kit preset .zip bundle. Node fs, not cep.fs.writeFile (that one
  // is text/base64 only).
  function saveBinaryFileWithNativeDialog(title, defaultName, ext, bytes, onDone) {
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx) {
        var choice = window.cep.fs.showSaveDialogEx(title, "", [ext], defaultName);
        var chosen = choice && choice.data;
        if (Array.isArray(chosen)) {
          chosen = chosen[0];
        }
        if (!chosen) {
          onDone(false, null);
          return;
        }
        if (chosen.slice(-(ext.length + 1)).toLowerCase() !== "." + ext) {
          chosen += "." + ext;
        }
        nodeRequire("fs").writeFileSync(chosen, bytes);
        onDone(true, chosen);
        return;
      }
    } catch (nativeError) {
      onDone(false, null, "Export failed: " + nativeError);
      return;
    }
    onDone(false, null, "Export failed -- no file dialog available.");
  }

  // ---------------------------------------------------------------
  // Minimal STORE (uncompressed) ZIP -- write and read. No external
  // library is reachable (CSP allowlist), and a STORE zip is simple
  // enough to do by hand. Used to bundle a Kit preset's JSON + preview
  // + copied footage into one shareable file.
  // ---------------------------------------------------------------
  var mfCrcTable = null;
  function mfCrc32(bytes) {
    if (!mfCrcTable) {
      mfCrcTable = [];
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        mfCrcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ mfCrcTable[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function mfU8(str) { return new TextEncoder().encode(str); }
  function mfU8Decode(arr) { return new TextDecoder().decode(arr); }
  function mfLE(value, byteCount) {
    var a = new Uint8Array(byteCount);
    var v = value >>> 0;
    for (var i = 0; i < byteCount; i += 1) { a[i] = v & 0xFF; v = Math.floor(v / 256); }
    return a;
  }
  function mfConcat(chunks) {
    var len = 0, i;
    for (i = 0; i < chunks.length; i += 1) { len += chunks[i].length; }
    var out = new Uint8Array(len);
    var o = 0;
    for (i = 0; i < chunks.length; i += 1) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }
  // entries: [{ name, data(Uint8Array) }] -> Uint8Array
  function mfZipStore(entries) {
    var body = [];
    var central = [];
    var offset = 0;
    for (var e = 0; e < entries.length; e += 1) {
      var nameB = mfU8(entries[e].name);
      var data = entries[e].data;
      var crc = mfCrc32(data);
      var lfh = mfConcat([
        mfLE(0x04034b50, 4), mfLE(20, 2), mfLE(0x0800, 2), mfLE(0, 2),
        mfLE(0, 2), mfLE(0, 2), mfLE(crc, 4), mfLE(data.length, 4), mfLE(data.length, 4),
        mfLE(nameB.length, 2), mfLE(0, 2), nameB
      ]);
      body.push(lfh, data);
      central.push(mfConcat([
        mfLE(0x02014b50, 4), mfLE(20, 2), mfLE(20, 2), mfLE(0x0800, 2), mfLE(0, 2),
        mfLE(0, 2), mfLE(0, 2), mfLE(crc, 4), mfLE(data.length, 4), mfLE(data.length, 4),
        mfLE(nameB.length, 2), mfLE(0, 2), mfLE(0, 2), mfLE(0, 2), mfLE(0, 2),
        mfLE(0, 4), mfLE(offset, 4), nameB
      ]));
      offset += lfh.length + data.length;
    }
    var cd = mfConcat(central);
    var eocd = mfConcat([
      mfLE(0x06054b50, 4), mfLE(0, 2), mfLE(0, 2),
      mfLE(entries.length, 2), mfLE(entries.length, 2),
      mfLE(cd.length, 4), mfLE(offset, 4), mfLE(0, 2)
    ]);
    return mfConcat(body.concat([cd, eocd]));
  }
  // Uint8Array -> [{ name, data(Uint8Array) }]. STORE only.
  function mfZipRead(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    var i = bytes.length - 22;
    for (; i >= 0; i -= 1) {
      if (dv.getUint32(i, true) === 0x06054b50) { break; }
    }
    if (i < 0) { throw new Error("Not a zip file."); }
    var count = dv.getUint16(i + 10, true);
    var p = dv.getUint32(i + 16, true);
    var out = [];
    for (var n = 0; n < count; n += 1) {
      if (dv.getUint32(p, true) !== 0x02014b50) { throw new Error("Corrupt zip (central dir)."); }
      var comp = dv.getUint16(p + 10, true);
      var size = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = mfU8Decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (comp !== 0) { throw new Error("Compressed zip not supported."); }
      var lNameLen = dv.getUint16(lho + 26, true);
      var lExtraLen = dv.getUint16(lho + 28, true);
      var dataStart = lho + 30 + lNameLen + lExtraLen;
      out.push({ name: name, data: new Uint8Array(bytes.subarray(dataStart, dataStart + size)) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function exportStylePresetRow(preset) {
    var envelope = buildStylePresetExportEnvelope([preset]);
    var fileName = sanitizeFileNamePart(preset.name);
    saveTextFileWithNativeDialog("Export Style Preset", fileName, JSON.stringify(envelope, null, 2), function (ok, path, error) {
      if (ok) {
        setStatus("Exported “" + preset.name + "”.", "success");
      } else if (error) {
        setStatus(error, "error");
      }
    });
  }

  function exportAllStylePresets() {
    var presets = loadStylePresets();
    if (!presets.length) {
      setStatus("No style presets to export yet.", "error");
      return;
    }
    var envelope = buildStylePresetExportEnvelope(presets);
    var d = new Date();
    function two(n) {
      return n < 10 ? "0" + n : String(n);
    }
    var fileName = "Motion Film Style Presets " + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
    saveTextFileWithNativeDialog("Export All Style Presets", fileName, JSON.stringify(envelope, null, 2), function (ok, path, error) {
      if (ok) {
        setStatus("Exported " + presets.length + " style preset" + (presets.length === 1 ? "" : "s") + ".", "success");
      } else if (error) {
        setStatus(error, "error");
      }
    });
  }

  // Accepts either our own export envelope ({presets:[{name,preset}]})
  // or a bare single preset object ({name, preset}) -- lenient on
  // purpose, in case a file gets hand-edited or renamed down the line.
  function parseImportedPresetEntries(jsonText) {
    var data = JSON.parse(jsonText);
    if (data && Array.isArray(data.presets)) {
      return data.presets;
    }
    if (data && data.name && data.preset) {
      return [data];
    }
    if (Array.isArray(data)) {
      return data;
    }
    throw new Error("Not a Mótion Film style preset file.");
  }

  function uniqueStylePresetName(name, existingNames) {
    if (existingNames.indexOf(name) === -1) {
      return name;
    }
    var n = 2;
    while (existingNames.indexOf(name + " (" + n + ")") !== -1) {
      n += 1;
    }
    return name + " (" + n + ")";
  }

  function importStylePresetsFromFileList(fileList) {
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
      renderStylePresetsManageList();
      if (importedCount && !failedCount) {
        setStatus("Imported " + importedCount + " style preset" + (importedCount === 1 ? "" : "s") + ".", "success");
      } else if (importedCount && failedCount) {
        setStatus("Imported " + importedCount + " -- " + failedCount + " file" + (failedCount === 1 ? "" : "s") + " couldn't be read.", "success");
      } else {
        setStatus("Couldn't import -- not a valid style preset file.", "error");
      }
    }

    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var entries = parseImportedPresetEntries(String(reader.result));
          var presets = loadStylePresets();
          var existingNames = presets.map(function (p) {
            return p.name;
          });
          for (var e = 0; e < entries.length; e += 1) {
            var entry = entries[e];
            if (!entry || !entry.preset) {
              continue;
            }
            var name = uniqueStylePresetName(String(entry.name || "Imported preset"), existingNames);
            existingNames.push(name);
            presets.push({ id: "style-" + Date.now() + "-" + Math.floor(Math.random() * 10000), name: name, preset: entry.preset });
            importedCount += 1;
          }
          saveStylePresets(presets);
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

  function stylePresetLabel(id) {
    if (!id) {
      return "None";
    }
    var presets = loadStylePresets();
    for (var i = 0; i < presets.length; i += 1) {
      if (presets[i].id === id) {
        return presets[i].name;
      }
    }
    return "None";
  }

  function updateCaptionsStylePresetButton(settings) {
    var button = $("captions-style-preset-button");
    if (button) {
      button.textContent = stylePresetLabel(settings.stylePresetId);
    }
  }

  function openCaptionsStylePresetPicker(trigger) {
    var settings = loadCaptionsSettings();
    var presets = loadStylePresets();
    var options = [{ value: "", label: "None", removable: false }].concat(presets.map(function (preset) {
      return { value: preset.id, label: preset.name, removable: true };
    }));
    openOptionPicker(trigger, options, settings.stylePresetId || "", {
      onRemove: function (id) {
        var remaining = loadStylePresets().filter(function (preset) {
          return preset.id !== id;
        });
        saveStylePresets(remaining);
        if (settings.stylePresetId === id) {
          settings.stylePresetId = null;
          saveCaptionsSettings();
          updateCaptionsStylePresetButton(settings);
        }
        openCaptionsStylePresetPicker(trigger); // refresh the open list instead of closing it
      }
    }, function (value) {
      settings.stylePresetId = value || null;
      saveCaptionsSettings();
      updateCaptionsStylePresetButton(settings);
    });
  }

  // Small standalone popover with just a name field + Save button --
  // used for naming a new style preset right after it's captured.
  // Deliberately NOT window.prompt() -- see the lesson documented where
  // that call froze this entire panel's JS thread solid with no dialog
  // CDP could detect or dismiss.
  var namePopover = null;

  function buildNamePopover() {
    var root = document.createElement("div");
    root.className = "fp-popover";
    root.hidden = true;
    root.innerHTML = '<div class="option-picker-add option-picker-add--standalone">' +
      '<input type="text" class="option-picker-add-input" spellcheck="false" />' +
      '<button type="button" class="option-picker-add-button">Save</button>' +
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

  function openNamePopover(trigger, placeholder, onSave, defaultValue) {
    if (!namePopover) {
      namePopover = buildNamePopover();
    }
    namePopover.input.value = defaultValue || "";
    namePopover.input.placeholder = placeholder || "Name";
    namePopover.onSave = onSave;

    var rect = trigger.getBoundingClientRect();
    namePopover.root.hidden = false;
    var width = namePopover.root.offsetWidth || 220;
    var height = namePopover.root.offsetHeight || 50;
    var left = Math.min(rect.left, window.innerWidth - width - 8);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight) {
      top = Math.max(6, rect.top - height - 6);
    }
    namePopover.root.style.left = Math.max(6, left) + "px";
    namePopover.root.style.top = top + "px";
    namePopover.input.focus();
    if (defaultValue) {
      namePopover.input.select();
    }
  }

  function saveStylePresetFromSelection() {
    var button = $("captions-save-style-button");
    hostCall("captureLayerStylePreset", [], function (result) {
      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }
      openNamePopover(button, "Preset name", function (name) {
        var presets = loadStylePresets();
        var id = "style-" + Date.now();
        presets.push({ id: id, name: name, preset: result.preset });
        saveStylePresets(presets);
        var settings = loadCaptionsSettings();
        settings.stylePresetId = id;
        saveCaptionsSettings();
        updateCaptionsStylePresetButton(settings);
        setStatus("Saved style preset “" + name + "”.", "success");
      });
    });
  }

  // ---------------------------------------------------------------
  // Manage Style Presets modal -- a full list (unlike the compact
  // dropdown in Caption Settings) with rename-in-place and delete for
  // every saved preset.
  // ---------------------------------------------------------------

  function openStylePresetsManageModal() {
    var overlay = $("style-presets-manage-overlay");
    if (!overlay) {
      return;
    }
    renderStylePresetsManageList();
    overlay.hidden = false;
  }

  function closeStylePresetsManageModal() {
    var overlay = $("style-presets-manage-overlay");
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function renderStylePresetsManageList() {
    var list = $("style-presets-list");
    if (!list) {
      return;
    }
    var presets = loadStylePresets();
    list.innerHTML = "";
    if (!presets.length) {
      var empty = document.createElement("div");
      empty.className = "style-presets-empty";
      empty.textContent = "No style presets saved yet -- select a styled text layer in the Captions tab and click “Save Style Preset”.";
      list.appendChild(empty);
      return;
    }
    for (var i = 0; i < presets.length; i += 1) {
      list.appendChild(buildStylePresetRow(presets[i]));
    }
  }

  function buildStylePresetRow(preset) {
    var row = document.createElement("div");
    row.className = "style-preset-row";

    var nameEl = document.createElement("span");
    nameEl.className = "style-preset-row-name";
    nameEl.textContent = preset.name;

    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export";

    var editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";

    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "style-preset-row-delete";
    deleteButton.textContent = "Delete";

    row.appendChild(nameEl);
    row.appendChild(exportButton);
    row.appendChild(editButton);
    row.appendChild(deleteButton);

    exportButton.addEventListener("click", function () {
      exportStylePresetRow(preset);
    });
    editButton.addEventListener("click", function () {
      startEditingStylePresetRow(row, preset);
    });
    deleteButton.addEventListener("click", function () {
      var remaining = loadStylePresets().filter(function (p) {
        return p.id !== preset.id;
      });
      saveStylePresets(remaining);
      var settings = loadCaptionsSettings();
      if (settings.stylePresetId === preset.id) {
        settings.stylePresetId = null;
        saveCaptionsSettings();
        updateCaptionsStylePresetButton(settings);
      }
      renderStylePresetsManageList();
    });

    return row;
  }

  function startEditingStylePresetRow(row, preset) {
    row.innerHTML = "";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "style-preset-row-input";
    input.value = preset.name;
    input.spellcheck = false;

    var saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";

    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    row.appendChild(input);
    row.appendChild(saveButton);
    row.appendChild(cancelButton);

    function commit() {
      var name = input.value.trim();
      if (!name) {
        renderStylePresetsManageList();
        return;
      }
      var presets = loadStylePresets();
      for (var i = 0; i < presets.length; i += 1) {
        if (presets[i].id === preset.id) {
          presets[i].name = name;
          break;
        }
      }
      saveStylePresets(presets);
      renderStylePresetsManageList();
    }

    saveButton.addEventListener("click", commit);
    cancelButton.addEventListener("click", function () {
      renderStylePresetsManageList();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        commit();
      } else if (event.key === "Escape") {
        renderStylePresetsManageList();
      }
    });
    input.focus();
    input.select();
  }

  function openCaptionsSettingsModal() {
    var overlay = $("captions-settings-overlay");
    if (!overlay) {
      return;
    }
    refreshCaptionsModalFields();
    overlay.hidden = false;
  }

  function closeCaptionsSettingsModal() {
    var overlay = $("captions-settings-overlay");
    if (overlay) {
      overlay.hidden = true;
    }
    closeOptionPicker();
  }

  function setCaptionsRunStatus(text) {
    var el = $("captions-run-status");
    var textEl = $("captions-run-status-text");
    if (!el) {
      return;
    }
    el.hidden = !text;
    if (textEl) {
      textEl.textContent = text || "";
    }
  }

  function runTranscriptionPipeline(info, settings) {
    var fs = nodeRequire("fs");
    var p = captionsPaths();
    fs.mkdirSync(p.tempDir, { recursive: true });
    var runId = String(Date.now());

    return toShortPath(p.tempDir).then(function (tempDirShort) {
      var path = nodeRequire("path");
      var wavPath = path.join(tempDirShort, "audio-" + runId + ".wav");
      var jsonOutBase = path.join(tempDirShort, "transcript-" + runId);

      // -ss/-to as INPUT options (before -i) trim to exactly the stretch
      // of the source the layer shows on the timeline -- respects
      // trimming instead of always transcribing the whole underlying
      // file. Both are relative to the ORIGINAL file's own timeline (not
      // to each other), which is exactly the sourceInPoint/sourceOutPoint
      // pair host.jsx already computed from the layer's In/Out points.
      return runCommand(p.ffmpegExe, ["-nostdin", "-y", "-ss", String(info.sourceInPoint), "-to", String(info.sourceOutPoint), "-i", info.sourceFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath], { maxBuffer: 1024 * 1024 * 20, timeout: 10 * 60 * 1000 })
        .then(function () {
          setCaptionsRunStatus("Transcribing “" + info.layerName + "” (this can take a while on longer clips)…");
          return Promise.all([toShortPath(p.whisperExe), toShortPath(p.modelPath)]);
        })
        .then(function (shortPaths) {
          return runCommand(shortPaths[0], ["-m", shortPaths[1], "-f", wavPath, "-l", settings.language, "-ojf", "-of", jsonOutBase], { maxBuffer: 1024 * 1024 * 40, timeout: 30 * 60 * 1000 });
        })
        .then(function () {
          var whisperResult = JSON.parse(fs.readFileSync(jsonOutBase + ".json", "utf8"));
          var captions = buildCaptionsFromTranscript(whisperResult, settings);
          // The extracted clip's own time 0 IS info.layerInPoint (that's
          // exactly what -ss cut to), so caption times need no more math
          // than that single offset -- no need to also add layerStartTime
          // now that the clip no longer starts at the source file's time 0.
          var absoluteCaptions = captions.map(function (caption) {
            return { text: caption.text, start: info.layerInPoint + caption.start, end: info.layerInPoint + caption.end };
          });
          try {
            fs.unlinkSync(wavPath);
          } catch (cleanupWavError) {
            // Non-fatal.
          }
          try {
            fs.unlinkSync(jsonOutBase + ".json");
          } catch (cleanupJsonError) {
            // Non-fatal.
          }
          return absoluteCaptions;
        });
    });
  }

  function runTranscriptionForInfo(info) {
    var settings = loadCaptionsSettings();
    var button = $("captions-transcribe-button");
    if (button) {
      button.disabled = true;
    }
    setCaptionsRunStatus("Extracting audio from “" + info.layerName + "”…");
    var stylePresets = loadStylePresets();
    var stylePresetEntry = null;
    for (var i = 0; i < stylePresets.length; i += 1) {
      if (stylePresets[i].id === settings.stylePresetId) {
        stylePresetEntry = stylePresets[i];
        break;
      }
    }
    var stylePresetArg = stylePresetEntry ? JSON.stringify(stylePresetEntry.preset) : null;
    runTranscriptionPipeline(info, settings)
      .then(function (absoluteCaptions) {
        setCaptionsRunStatus("Creating caption layers…");
        hostCall("createCaptionLayers", [JSON.stringify(absoluteCaptions), stylePresetArg], function (result) {
          if (button) {
            button.disabled = false;
          }
          setCaptionsRunStatus("");
          if (!result.ok) {
            setStatus(result.error, "error");
            return;
          }
          setStatus("Created " + result.created + " caption layer" + (result.created === 1 ? "" : "s") + ".", "success");
        });
      })
      .catch(function (error) {
        if (button) {
          button.disabled = false;
        }
        setCaptionsRunStatus("");
        setStatus(String((error && error.message) || error), "error");
      });
  }

  // ---------------------------------------------------------------
  // Import SRT -- for captions someone else already timed/adjusted
  // (a client, another editor) and just needs dropped into the
  // project as-is. Deliberately bypasses the whole transcription
  // pipeline (no whisper/ffmpeg involved) and buildCaptionsFromTranscript's
  // char-limit re-grouping -- the file's own timing and line breaks are
  // exactly what the person who timed it wanted, so they're kept
  // verbatim. Only Style Preset (whatever's currently selected in
  // Caption Settings) gets applied on top, same as a transcription run.
  // Lands straight on createCaptionLayers with no host.jsx changes
  // needed -- it already accepts a plain {text, start, end} list and
  // already treats "\r" inside text as an explicit line break (see
  // buildCaptionsFromTranscript's "2 Lines" mode, the same convention
  // reused here).
  // ---------------------------------------------------------------

  function parseSrtTimestamp(raw) {
    var m = raw.match(/(\d+):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!m) {
      return null;
    }
    return (parseInt(m[1], 10) * 3600) + (parseInt(m[2], 10) * 60) + parseInt(m[3], 10) + (parseInt(m[4], 10) / 1000);
  }

  function parseSrt(fileText) {
    // Strip a BOM (common on Windows-authored .srt files) and normalize
    // line endings before splitting into cue blocks on blank lines.
    var normalized = String(fileText).replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var blocks = normalized.split(/\n\s*\n/);
    var cues = [];
    for (var i = 0; i < blocks.length; i += 1) {
      var lines = blocks[i].split("\n").filter(function (line) {
        return line.trim() !== "";
      });
      if (!lines.length) {
        continue;
      }
      var lineIndex = 0;
      // A bare numeric line is the cue's sequence number (standard SRT) --
      // skip it if present. WebVTT cue identifiers (also just a bare
      // line before the timestamp) get skipped the same way for free.
      if (/^\d+$/.test(lines[0].trim())) {
        lineIndex = 1;
      }
      var timeLine = lines[lineIndex];
      if (!timeLine) {
        continue;
      }
      var timeMatch = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-+>\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/);
      if (!timeMatch) {
        continue;
      }
      var start = parseSrtTimestamp(timeMatch[1]);
      var end = parseSrtTimestamp(timeMatch[2]);
      if (start === null || end === null || end <= start) {
        continue;
      }
      var textLines = lines.slice(lineIndex + 1).map(function (line) {
        // Strip formatting tags (<i>, <b>, <font ...>) and VTT-style
        // cue settings/position tags ({\an8}) -- we don't have a way to
        // represent them on an AE text layer, so showing the raw markup
        // would be worse than just dropping it.
        return line.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/^\s+|\s+$/g, "");
      }).filter(function (line) {
        return line !== "";
      });
      if (!textLines.length) {
        continue;
      }
      cues.push({ text: textLines.join("\r"), start: start, end: end });
    }
    return cues;
  }

  function importSrtFile(file) {
    var button = $("captions-import-srt-button");
    var reader = new FileReader();
    reader.onload = function () {
      var cues;
      try {
        cues = parseSrt(String(reader.result));
      } catch (parseError) {
        cues = [];
      }
      if (!cues.length) {
        setStatus("Couldn't find any valid subtitle cues in that file.", "error");
        return;
      }
      var settings = loadCaptionsSettings();
      var stylePresets = loadStylePresets();
      var stylePresetEntry = null;
      for (var i = 0; i < stylePresets.length; i += 1) {
        if (stylePresets[i].id === settings.stylePresetId) {
          stylePresetEntry = stylePresets[i];
          break;
        }
      }
      var stylePresetArg = stylePresetEntry ? JSON.stringify(stylePresetEntry.preset) : null;
      if (button) {
        button.disabled = true;
      }
      setCaptionsRunStatus("Importing " + cues.length + " subtitle" + (cues.length === 1 ? "" : "s") + "…");
      hostCall("createCaptionLayers", [JSON.stringify(cues), stylePresetArg], function (result) {
        if (button) {
          button.disabled = false;
        }
        setCaptionsRunStatus("");
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        var styleNote = stylePresetEntry ? " with “" + stylePresetEntry.name + "”" : "";
        setStatus("Imported " + result.created + " caption layer" + (result.created === 1 ? "" : "s") + " from SRT" + styleNote + ".", "success");
      });
    };
    reader.onerror = function () {
      setStatus("Couldn't read that file.", "error");
    };
    reader.readAsText(file);
  }

  var pendingCaptionsInfo = null;

  function initCaptionsTools() {
    refreshCaptionsSetupState();
    var setupButton = $("captions-setup-button");
    if (setupButton) {
      setupButton.addEventListener("click", function () {
        setupCaptionsTools();
      });
    }

    // Clicking "Transcribe" checks the selection first (so a bad
    // selection fails fast with a clear message) and only then opens the
    // settings modal -- confirming the layer is transcribable before
    // asking the user to configure how.
    var transcribeButton = $("captions-transcribe-button");
    if (transcribeButton) {
      transcribeButton.addEventListener("click", function () {
        hostCall("getSelectedLayerAudioInfo", [], function (info) {
          if (!info.ok) {
            setStatus(info.error, "error");
            return;
          }
          pendingCaptionsInfo = info;
          openCaptionsSettingsModal();
        });
      });
    }

    var importSrtButton = $("captions-import-srt-button");
    var importSrtInput = $("captions-import-srt-input");
    if (importSrtButton && importSrtInput) {
      importSrtButton.addEventListener("click", function () {
        importSrtInput.value = ""; // reset so importing the same file twice in a row still fires "change"
        importSrtInput.click();
      });
      importSrtInput.addEventListener("change", function () {
        if (importSrtInput.files && importSrtInput.files[0]) {
          importSrtFile(importSrtInput.files[0]);
        }
      });
    }

    var confirmButton = $("captions-settings-confirm");
    if (confirmButton) {
      confirmButton.addEventListener("click", function () {
        closeCaptionsSettingsModal();
        if (pendingCaptionsInfo) {
          runTranscriptionForInfo(pendingCaptionsInfo);
          pendingCaptionsInfo = null;
        }
      });
    }

    var closeButton = $("captions-settings-close");
    if (closeButton) {
      closeButton.addEventListener("click", function () {
        closeCaptionsSettingsModal();
        pendingCaptionsInfo = null;
      });
    }

    var overlay = $("captions-settings-overlay");
    if (overlay) {
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) {
          closeCaptionsSettingsModal();
          pendingCaptionsInfo = null;
        }
      });
    }

    var lengthSegmented = $("captions-length-segmented");
    if (lengthSegmented) {
      lengthSegmented.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest(".segmented-option") : null;
        if (!button) {
          return;
        }
        var settings = loadCaptionsSettings();
        settings.length = button.getAttribute("data-value");
        settings.presetId = "custom"; // no longer matches whichever preset was selected
        saveCaptionsSettings();
        renderCaptionsLengthSegmented(settings.length);
        updateCaptionsCharLimitField(settings);
        updateCaptionsPresetButton(settings);
      });
    }

    var charLimitInput = $("captions-charlimit-input");
    if (charLimitInput) {
      charLimitInput.addEventListener("change", function () {
        var value = parseInt(charLimitInput.value, 10);
        if (!value || value < 8) {
          value = 8;
        }
        if (value > 200) {
          value = 200;
        }
        charLimitInput.value = value;
        var settings = loadCaptionsSettings();
        settings.charLimit = value;
        settings.presetId = "custom";
        saveCaptionsSettings();
        updateCaptionsPresetButton(settings);
      });
    }

    var presetButton = $("captions-preset-button");
    if (presetButton) {
      presetButton.addEventListener("click", function (event) {
        // Without this, the click bubbles up to the document-level
        // "close every popover" listener (see closeOptionPicker call
        // site further up) and closes the picker in the very same
        // click that just opened it -- confirmed live.
        event.stopPropagation();
        openCaptionPresetPicker(presetButton);
      });
    }

    var languageButton = $("captions-language-button");
    if (languageButton) {
      languageButton.addEventListener("click", function (event) {
        event.stopPropagation();
        openCaptionsLanguagePicker(languageButton);
      });
    }

    var stylePresetButton = $("captions-style-preset-button");
    if (stylePresetButton) {
      stylePresetButton.addEventListener("click", function (event) {
        event.stopPropagation();
        openCaptionsStylePresetPicker(stylePresetButton);
      });
    }

    var saveStyleButton = $("captions-save-style-button");
    if (saveStyleButton) {
      saveStyleButton.addEventListener("click", function () {
        saveStylePresetFromSelection();
      });
    }

    var manageStylesButton = $("captions-manage-styles-button");
    if (manageStylesButton) {
      manageStylesButton.addEventListener("click", function () {
        openStylePresetsManageModal();
      });
    }

    // "Change Style" -- swaps the look of already-existing caption
    // layer(s) for a DIFFERENT saved Style Preset, without retyping the
    // text or re-transcribing the source video. Picking a preset here
    // clears whatever animation the selected layer(s) already have
    // (host-side, see clearLayerStyleAnimation) and applies the newly
    // chosen preset on top, same as a caption gets styled when it's
    // first generated.
    var changeStyleButton = $("captions-change-style-button");
    if (changeStyleButton) {
      changeStyleButton.addEventListener("click", function (event) {
        // Opens openChoicePicker synchronously -- same stopPropagation
        // reasoning as every other button here that does that (see the
        // Kit tab's Delete/Export buttons for the fullest write-up).
        event.stopPropagation();
        var presets = loadStylePresets();
        if (!presets.length) {
          setStatus("No Style Presets saved yet -- save one first.", "error");
          return;
        }
        var options = presets.map(function (preset) {
          return { value: preset.id, label: preset.name };
        });
        openChoicePicker(changeStyleButton, options, "", function (id) {
          var preset = presets.filter(function (p) {
            return p.id === id;
          })[0];
          if (!preset) {
            return;
          }
          hostCall("applyStylePresetToSelectedLayers", [JSON.stringify(preset.preset)], function (result) {
            if (!result.ok) {
              setStatus(result.error, "error");
              return;
            }
            var skippedNote = result.skipped ? " (" + result.skipped + " non-text layer" + (result.skipped === 1 ? "" : "s") + " skipped)" : "";
            setStatus("Changed style on " + result.changed + " layer" + (result.changed === 1 ? "" : "s") + " to “" + preset.name + "”" + skippedNote + ".", "success");
          });
        });
      });
    }

    var importStylesButton = $("style-presets-import-button");
    var importStylesInput = $("style-presets-import-input");
    if (importStylesButton && importStylesInput) {
      importStylesButton.addEventListener("click", function () {
        importStylesInput.value = ""; // reset so importing the same file twice in a row still fires "change"
        importStylesInput.click();
      });
      importStylesInput.addEventListener("change", function () {
        importStylePresetsFromFileList(importStylesInput.files);
      });
    }

    var exportAllStylesButton = $("style-presets-export-all-button");
    if (exportAllStylesButton) {
      exportAllStylesButton.addEventListener("click", function () {
        exportAllStylePresets();
      });
    }

    var manageStylesClose = $("style-presets-manage-close");
    if (manageStylesClose) {
      manageStylesClose.addEventListener("click", function () {
        closeStylePresetsManageModal();
      });
    }

    var manageStylesOverlay = $("style-presets-manage-overlay");
    if (manageStylesOverlay) {
      manageStylesOverlay.addEventListener("click", function (event) {
        if (event.target === manageStylesOverlay) {
          closeStylePresetsManageModal();
        }
      });
    }
  }

  // ---------------------------------------------------------------
  // Effects Manager tab: one row per distinct effect (grouped by its
  // real matchName, not a possibly hand-renamed display name) found
  // across EVERY currently selected layer -- union, not intersection,
  // per spec: an effect on just 1 of several selected layers still
  // gets shown. A row's checkbox click sets that effect's enabled
  // state across every instance of it in the current selection at
  // once (no more opening each layer's own Effect Controls one at a
  // time to turn the same effect off everywhere); the trash icon
  // removes it the same way. See getSelectedLayersEffects /
  // setEffectEnabledForSelection / setAllEffectsEnabledForSelection /
  // removeEffectForSelection in host.jsx for the AE-side half.
  // ---------------------------------------------------------------

  var effectsManagerState = { busy: false, signature: null };

  var EFFECTS_CHECK_ICON = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3.5 8.3 6.5 11.3 12.5 4.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var EFFECTS_MIXED_ICON = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 8h8" stroke-linecap="round"/></svg>';
  var EFFECTS_DELETE_ICON = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 6h11M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.6 9.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function setEffectRowCheckboxState(checkbox, state) {
    checkbox.classList.toggle("is-checked", state === "all");
    checkbox.classList.toggle("is-mixed", state === "mixed");
    checkbox.innerHTML = state === "all" ? EFFECTS_CHECK_ICON : state === "mixed" ? EFFECTS_MIXED_ICON : "";
  }

  function buildEffectsManagerRow(effect) {
    var row = document.createElement("div");
    row.className = "effects-manager-row";

    var checkbox = document.createElement("button");
    checkbox.type = "button";
    checkbox.className = "effects-row-checkbox";
    checkbox.setAttribute("aria-label", "Toggle " + effect.name + " on every selected layer that has it");
    setEffectRowCheckboxState(checkbox, effect.state);

    var name = document.createElement("span");
    name.className = "effects-row-name";
    name.textContent = effect.name;
    name.title = effect.name;

    var count = document.createElement("span");
    count.className = "effects-row-count";
    count.textContent = "(" + effect.count + ")";

    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "effects-row-delete";
    deleteButton.setAttribute("aria-label", "Remove " + effect.name + " from every selected layer");
    deleteButton.title = "Remove from every selected layer";
    deleteButton.innerHTML = EFFECTS_DELETE_ICON;

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(deleteButton);

    checkbox.addEventListener("click", function () {
      // Mixed or fully-off -> turn every instance of this effect on;
      // fully-on -> turn them all off. A click always lands on one
      // definite, unambiguous state rather than trying to toggle each
      // instance individually (which would just recreate the mixed
      // state it started from half the time).
      var turnOn = effect.state !== "all";
      setEffectRowCheckboxState(checkbox, turnOn ? "all" : "none"); // optimistic -- confirmed/corrected by the next poll either way
      hostCall("setEffectEnabledForSelection", [effect.matchName, turnOn], function (result) {
        if (!result.ok) {
          setStatus(result.error, "error");
        }
        refreshEffectsManager(true);
      });
    });

    deleteButton.addEventListener("click", function () {
      hostCall("removeEffectForSelection", [effect.matchName], function (result) {
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        setStatus("Removed “" + effect.name + "” from " + result.removed + " layer" + (result.removed === 1 ? "" : "s") + ".", "success");
        refreshEffectsManager(true);
      });
    });

    return row;
  }

  function effectsManagerSignature(effects) {
    var parts = [];
    for (var i = 0; i < effects.length; i += 1) {
      parts.push(effects[i].matchName + ":" + effects[i].count + ":" + effects[i].state);
    }
    return parts.join("|");
  }

  function refreshEffectsManager(force) {
    var page = $("page-effects");
    if (!page || page.hidden) {
      return; // not the visible tab -- skip the round trip entirely
    }
    if (effectsManagerState.busy && !force) {
      return;
    }
    hostCall("getSelectedLayersEffects", [], function (result) {
      if (!result.ok) {
        return;
      }
      var empty = $("effects-manager-empty");
      var content = $("effects-manager-content");
      if (!result.layerCount) {
        empty.hidden = false;
        content.hidden = true;
        effectsManagerState.signature = null;
        return;
      }
      empty.hidden = true;
      content.hidden = false;
      $("effects-manager-total").textContent = "TOTAL EFFECTS: " + result.totalInstances;

      var allOn = result.effects.length > 0;
      for (var i = 0; i < result.effects.length; i += 1) {
        if (result.effects[i].state !== "all") {
          allOn = false;
          break;
        }
      }
      $("effects-master-toggle").setAttribute("aria-checked", allOn ? "true" : "false");

      var signature = effectsManagerSignature(result.effects);
      if (signature === effectsManagerState.signature) {
        return; // nothing actually changed -- skip the rebuild (keeps hover/focus state intact between polls)
      }
      effectsManagerState.signature = signature;
      var list = $("effects-manager-list");
      list.innerHTML = "";
      for (var e = 0; e < result.effects.length; e += 1) {
        list.appendChild(buildEffectsManagerRow(result.effects[e]));
      }
    });
  }

  function initEffectsManagerTools() {
    var masterToggle = $("effects-master-toggle");
    if (masterToggle) {
      masterToggle.addEventListener("click", function () {
        var turnOn = masterToggle.getAttribute("aria-checked") !== "true";
        masterToggle.setAttribute("aria-checked", turnOn ? "true" : "false"); // optimistic
        hostCall("setAllEffectsEnabledForSelection", [turnOn], function (result) {
          if (!result.ok) {
            setStatus(result.error, "error");
          }
          effectsManagerState.signature = null; // force a full row rebuild -- every checkbox's state just changed
          refreshEffectsManager(true);
        });
      });
    }
  }

  function bindEvents() {
    els.canvas.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      velocity.dragging = true;
      // Remember the curve as it stands now so it can be shown dashed
      // for comparison while the new one is dragged out.
      var starting = temporalControlPoints();
      velocity.ghost = {
        inInfluence: starting.inInfluence,
        outInfluence: starting.outInfluence
      };
      updateVelocityFromPointer(canvasPoint(event));
      if (els.canvas.setPointerCapture) {
        els.canvas.setPointerCapture(event.pointerId);
      }
    });
    els.canvas.addEventListener("pointermove", function (event) {
      if (!velocity.dragging) {
        return;
      }
      updateVelocityFromPointer(canvasPoint(event));
    });
    els.canvas.addEventListener("pointerup", function () {
      if (!velocity.dragging) {
        return;
      }
      velocity.dragging = false;
      velocity.ghost = null;
      drawCurve();
      applyCurve();
    });
    els.canvas.addEventListener("pointercancel", function () {
      velocity.dragging = false;
      velocity.ghost = null;
      drawCurve();
    });

    els.inValue.addEventListener("input", function () {
      els.inSlider.value = clamp(parseFloat(els.inValue.value) || 0, 0, 100);
      drawCurve();
    });
    els.outValue.addEventListener("input", function () {
      els.outSlider.value = clamp(parseFloat(els.outValue.value) || 0, 0, 100);
      drawCurve();
    });
    els.inSlider.addEventListener("input", function () {
      els.inValue.value = els.inSlider.value;
      drawCurve();
    });
    els.outSlider.addEventListener("input", function () {
      els.outValue.value = els.outSlider.value;
      drawCurve();
    });
    els.applyCurve.addEventListener("click", applyCurve);

    // The sliders change the same curve, so they get the same dashed
    // comparison while being dragged.
    function bindSliderGhost(slider) {
      slider.addEventListener("pointerdown", function () {
        var starting = temporalControlPoints();
        velocity.ghost = {
          inInfluence: starting.inInfluence,
          outInfluence: starting.outInfluence
        };
      });
      function clearGhost() {
        if (velocity.ghost) {
          velocity.ghost = null;
          drawCurve();
        }
      }
      slider.addEventListener("pointerup", clearGhost);
      slider.addEventListener("pointercancel", clearGhost);
      slider.addEventListener("blur", clearGhost);
    }
    bindSliderGhost(els.inSlider);
    bindSliderGhost(els.outSlider);

    var anchorButtons = document.querySelectorAll(".anchor-dot");
    for (var anchorIndex = 0; anchorIndex < anchorButtons.length; anchorIndex += 1) {
      anchorButtons[anchorIndex].addEventListener("click", function (event) {
        var fx = parseFloat(this.getAttribute("data-fx"));
        var fy = parseFloat(this.getAttribute("data-fy"));
        applyAnchorPreset(fx, fy, event.shiftKey);
      });
    }

    var utilityButtons = document.querySelectorAll("[data-utility]");
    for (var utilityIndex = 0; utilityIndex < utilityButtons.length; utilityIndex += 1) {
      utilityButtons[utilityIndex].addEventListener("click", function () {
        runUtility(this.getAttribute("data-utility"));
      });
    }

    // Copy/Paste the easing curve of selected keyframes -- a separate,
    // in-memory clipboard from the graph editor's own curve (applyCurve
    // above): this one preserves each selected keyframe's own curve
    // instead of overwriting the whole selection with one uniform shape.
    var keyframeCurveClipboard = null;
    var copyKeyframeCurvesBtn = $("copy-keyframe-curves");
    var pasteKeyframeCurvesBtn = $("paste-keyframe-curves");
    copyKeyframeCurvesBtn.addEventListener("click", function () {
      hostCall("copySelectedKeyframeCurves", [], function (result) {
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        keyframeCurveClipboard = result.curves;
        pasteKeyframeCurvesBtn.disabled = false;
        setStatus("Copied " + result.count + " keyframe curve(s).", "success");
      });
    });
    pasteKeyframeCurvesBtn.addEventListener("click", function () {
      if (!keyframeCurveClipboard) {
        setStatus("Nothing copied yet.", "error");
        return;
      }
      hostCall("pasteSelectedKeyframeCurves", [JSON.stringify(keyframeCurveClipboard)], function (result) {
        if (!result.ok) {
          setStatus(result.error, "error");
          return;
        }
        var note = result.skipped ? " (" + result.skipped + " skipped)" : "";
        setStatus("Pasted curves onto " + result.changed + " keyframe(s)." + note, "success");
      });
    });

    els.transformReset.addEventListener("click", resetTransform);

    // Shift+click: null at the comp centre instead of the selection's
    // centre (handy for scaling several layers around the frame middle).
    els.createNull.addEventListener("click", function (event) {
      createLayer("createShapeNull", [{ compCentre: !!event.shiftKey }], "Null");
    });
    els.createAdjustment.addEventListener("click", function () {
      createLayer("createShapeAdjustment", [], "Adjustment layer");
    });
    els.createSolid.addEventListener("click", function () {
      // New solids are always black (user request 2026-10; it used to
      // take the panel accent).
      createLayer("createShapeSolid", [[0, 0, 0]], "Solid");
    });

    els.settingsToggle.addEventListener("click", function () {
      els.settings.hidden = !els.settings.hidden;
    });
    els.settingsClose.addEventListener("click", function () {
      els.settings.hidden = true;
    });
    window.addEventListener("resize", drawCurve);
  }

  function syncMotionSquares() {
    var curveEditor = $("curve-editor");
    var row = curveEditor ? curveEditor.parentElement : null;
    var anchorPanel = row ? row.querySelector(".anchor-panel") : null;
    if (!curveEditor || !row || !anchorPanel) {
      return;
    }
    // The anchor grid stays square while the curve editor takes the rest
    // of the row, so the curve gets roughly twice the width. Sizes are
    // computed here rather than left to CSS aspect-ratio, which older
    // CEP/Chromium builds handle poorly inside flex layouts.
    var isStacked = window.getComputedStyle(row).flexDirection === "column";
    var gap = parseFloat(window.getComputedStyle(row).columnGap) || 10;
    var anchorSide;
    if (isStacked) {
      anchorSide = Math.min(row.clientWidth, 150);
    } else {
      anchorSide = Math.floor((row.clientWidth - gap) / 3);
    }
    if (anchorSide <= 0) {
      return;
    }
    anchorPanel.style.width = anchorSide + "px";
    anchorPanel.style.height = anchorSide + "px";
    curveEditor.style.height = anchorSide + "px";
  }

  function init() {
    els.status = $("status");
    els.canvas = $("curve-canvas");
    els.inValue = $("in-value");
    els.outValue = $("out-value");
    els.inSlider = $("in-slider");
    els.outSlider = $("out-slider");
    els.applyCurve = $("apply-curve");
    els.settingsToggle = $("settings-toggle");
    els.settings = $("settings-popover");
    els.settingsClose = $("settings-close");
    els.resetSettings = $("reset-settings");
    els.transformRows = $("transform-rows");
    els.transformEmpty = $("transform-empty");
    els.transformReset = $("transform-reset");
    els.createNull = $("create-null");
    els.createAdjustment = $("create-adjustment");
    els.createSolid = $("create-solid");
    bindEvents();
    setupAppearance();
    initAuxLayers();
    initNullMarkerSize();
    initCollapsibleSections();
    initPageTabs();
    initKitTools();
    initKitSaveTools();
    initFooterResizer();
    initFooterTooltips();
    initIconsTools();
    initCaptionsTools();
    initEffectsManagerTools();
    syncMotionSquares();
    window.addEventListener("resize", syncMotionSquares);
    drawCurve();
    refreshTransform(true);
    window.setInterval(pollTick, 700);
    // Window focus is the signal for "is the user typing in AE's
    // viewport right now?" -- clicking into the Composition viewport to
    // edit a text layer takes keyboard focus AWAY from this CEP panel,
    // no matter where the mouse is. While the panel is blurred AND a
    // text layer is selected, pollTick makes zero host calls (see below).
    // Regaining focus, or the pointer entering the panel, means the user
    // is back here -- fire one full catch-up refresh.
    try { panelActive = document.hasFocus(); } catch (focusProbeError) {}
    window.addEventListener("focus", function () { panelActive = true; forceFullRefresh(); });
    window.addEventListener("blur", function () { panelActive = false; });
    document.addEventListener("mouseenter", forceFullRefresh);
  }

  // False while the user is working in another AE panel/viewport (e.g.
  // typing directly in a text layer). Drives whether pollTick runs at
  // all -- see its comment.
  var panelActive = true;

  var forceFullRefreshAt = 0;
  function forceFullRefresh() {
    // focus + mouseenter often both fire on the same "back to the
    // panel" gesture -- collapse those into one sweep.
    var now = Date.now();
    if (now - forceFullRefreshAt < 400) {
      return;
    }
    forceFullRefreshAt = now;
    refreshTransform(true);
    refreshEffectsManager(true);
  }

  // The 700ms poll. ANY evalScript that touches the selected text layer
  // while AE has an active in-viewport text edit can commit that edit and
  // drop the caret to the layer's start (confirmed live: it jumps within
  // the first couple of keystrokes). So while a text layer is the
  // selection (selectionIsText, from readLayerTransform) AND this panel
  // is blurred -- the user clicked away, almost certainly into that
  // layer's viewport edit -- make ZERO host calls at all. Regaining
  // focus / mouseenter fires a full catch-up refresh. Non-text
  // selections keep polling at full speed so their Transform values
  // track playback / the playhead live.
  function pollTick() {
    if (selectionIsText && !panelActive) {
      return;
    }
    refreshTransform();
    refreshEffectsManager();
  }

  document.addEventListener("DOMContentLoaded", init);
}());