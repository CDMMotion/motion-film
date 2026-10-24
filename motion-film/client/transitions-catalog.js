// Mótion Film -- Kit › Transitions: the catalog (what each card shows).
// The effects themselves are built by host/transitions.jsx (same ids).
//
//   group   the square it lives in (GROUPS)
//   slot    "cut" centered on the point, "in" starts at it, "out" ends at it
//   dirs    directions offered (none = no direction row)
//   cover   (groups) the effect whose preview is the group's square
// Previews: client/assets/transitions/<id>.mp4 + .jpg, rendered by
// dev/transitions-lab.jsx at the group's default duration and the first
// direction.
(function (root) {
  "use strict";

  var GROUPS = [
    { id: "principal", name: "Principal", hint: "Whip, zoom, spin, flash", frames: 14, cover: "whip" },
    { id: "glitch", name: "Glitch", hint: "Digital errors and RGB", frames: 14, cover: "prism" },
    { id: "filmburn", name: "Film Burn", hint: "Light, fire and leaks", frames: 24, cover: "burnsweep" },
    { id: "camera", name: "Camera", hint: "Moves in and out of a scene", frames: 20, cover: "cam_spin_out" },
    { id: "blur", name: "Blur", hint: "Blur accents at a moment", frames: 14, cover: "blur_long" },
    { id: "shake", name: "Shake", hint: "Shakes and impacts", frames: 18, cover: "shake_impact" }
  ];

  var LRUD = ["right", "left", "up", "down"];
  var LR = ["right", "left"];

  var LIST = [
    { id: "whip", name: "Whip", desc: "Fast pan", group: "principal", dirs: LRUD },
    { id: "zoomin", name: "Zoom In", desc: "Rush into the cut", group: "principal" },
    { id: "zoomout", name: "Zoom Out", desc: "Pull back through it", group: "principal" },
    { id: "slide", name: "Slide", desc: "Film strip slide", group: "principal", dirs: LRUD },
    { id: "spin", name: "Spin", desc: "Short turn", group: "principal", dirs: LR },
    { id: "spinzoom", name: "Spin Zoom", desc: "Turn and zoom", group: "principal", dirs: LR },
    { id: "warpspin", name: "Warp Spin", desc: "Turn with a lens warp", group: "principal", dirs: LR },
    { id: "blur", name: "Blur", desc: "Soft blur cross", group: "principal" },
    { id: "flash", name: "Flash", desc: "Burst of light", group: "principal" },
    { id: "stretch", name: "Stretch", desc: "Stretches through", group: "principal", dirs: ["right", "down"] },

    { id: "glitch", name: "Glitch", desc: "Digital tear", group: "glitch" },
    { id: "flicker", name: "Flicker", desc: "Strobes at the cut", group: "glitch" },
    { id: "smear", name: "Smear", desc: "Stretch and wobble", group: "glitch" },
    { id: "prism", name: "Prism", desc: "Rainbow streak", group: "glitch" },
    { id: "rgbburn", name: "RGB Burn", desc: "RGB light burst", group: "glitch" },
    { id: "blocks", name: "Blocks", desc: "Pixels and blocks", group: "glitch" },
    { id: "vhs", name: "VHS", desc: "Faulty tape", group: "glitch" },
    { id: "diagonal", name: "Diagonal", desc: "Diagonal streak", group: "glitch", dirs: LR },
    { id: "jitter", name: "Jitter", desc: "Camera jitter", group: "glitch" },

    { id: "burnsweep", name: "Burn Sweep", desc: "Burn crossing over", group: "filmburn", dirs: LRUD },
    { id: "edgeburn", name: "Edge Burn", desc: "Burns from the edges", group: "filmburn" },
    { id: "lightleak", name: "Light Leak", desc: "Diagonal leak", group: "filmburn", dirs: LR },
    { id: "hotcore", name: "Hot Core", desc: "Opens from the center", group: "filmburn" },
    { id: "flickerburn", name: "Flicker Burn", desc: "Flickering projector", group: "filmburn" },
    { id: "redleak", name: "Red Leak", desc: "Red light leak", group: "filmburn", dirs: LR },
    { id: "rollburn", name: "Rolling Burn", desc: "Rolling bands", group: "filmburn", dirs: ["down", "up"] },
    { id: "burnspots", name: "Burn Spots", desc: "Spots of light", group: "filmburn" },
    { id: "lightstreak", name: "Light Streak", desc: "Streak of light", group: "filmburn", dirs: LR },
    { id: "filmgate", name: "Film Gate", desc: "Melting film", group: "filmburn" },

    { id: "cam_dive_in", name: "Dive In", desc: "Arrives from up close", group: "camera", slot: "in" },
    { id: "cam_pull_in", name: "Pull In", desc: "Grows into place", group: "camera", slot: "in" },
    { id: "cam_corner_in", name: "Corner In", desc: "Comes from a corner", group: "camera", slot: "in" },
    { id: "cam_top_in", name: "Drop In", desc: "Comes down from the top", group: "camera", slot: "in" },
    { id: "cam_spin_in", name: "Spin In", desc: "Arrives spinning", group: "camera", slot: "in", dirs: LR },
    { id: "cam_dive_out", name: "Dive Out", desc: "Dives into the center", group: "camera", slot: "out" },
    { id: "cam_corner_out", name: "Corner Out", desc: "Dives into a corner", group: "camera", slot: "out" },
    { id: "cam_pull_out", name: "Pull Out", desc: "Shrinks away", group: "camera", slot: "out" },
    { id: "cam_sink_out", name: "Sink Out", desc: "Drops out the bottom", group: "camera", slot: "out" },
    { id: "cam_spin_out", name: "Spin Out", desc: "Leaves spinning", group: "camera", slot: "out", dirs: LR },

    { id: "blur_quick", name: "Quick Blur", desc: "Up and gone fast", group: "blur" },
    { id: "blur_long", name: "Long Blur", desc: "Fades slowly", group: "blur" },
    { id: "blur_bounce", name: "Bounce Blur", desc: "Bounces at the peak", group: "blur" },
    { id: "blur_soft", name: "Soft Blur", desc: "A gentle peak", group: "blur" },
    { id: "blur_horizontal", name: "Horizontal Blur", desc: "Sideways only", group: "blur" },
    { id: "blur_punch", name: "Punch Blur", desc: "Short and strong", group: "blur" },

    { id: "shake_classic", name: "Shake", desc: "Shake with motion blur", group: "shake" },
    { id: "shake_zoom", name: "Shake Zoom", desc: "Shake with scale", group: "shake" },
    { id: "shake_rgb", name: "Shake RGB", desc: "With RGB split", group: "shake" },
    { id: "shake_medium", name: "Shake Medium", desc: "Lasts longer", group: "shake" },
    { id: "shake_impact", name: "Impact", desc: "Hard hit", group: "shake" },
    { id: "shake_horizontal", name: "Shake Horizontal", desc: "Side to side", group: "shake" },
    { id: "shake_vertical", name: "Shake Vertical", desc: "Up and down", group: "shake" },
    { id: "shake_tremor", name: "Tremor", desc: "Light tremble", group: "shake" },
    { id: "shake_pulse", name: "Pulse", desc: "Pulses in scale", group: "shake" },
    { id: "shake_slow", name: "Slow Shake", desc: "Slower shake", group: "shake" }
  ];

  var BY = {};
  LIST.forEach(function (t) { t.slot = t.slot || "cut"; BY[t.id] = t; });

  root.MFTransitionsCatalog = { groups: GROUPS, list: LIST, byId: BY };
}(this));
