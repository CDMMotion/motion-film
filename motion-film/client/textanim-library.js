// Mótion Film -- Text Animation: the preset library.
//
// Every preset is one Text Animator with a Range Selector: the animator's
// properties hold the HIDDEN look of each character / word / line (faded,
// scaled down, pushed away...) and the selector sweeps across the text, so
// each unit goes from that look to the normal text one after the other.
// The same preset works as an entrance (In) or an exit (Out); host
// textanim.jsx builds it, textanim.js previews it with the same math.
//
// The library is generated here (nothing is downloaded): a set of named
// families -- each a look crossed with units, order, direction and
// strength -- plus "Remix", seeded random mixes of the same ingredients.
// The generator is deterministic, so a preset keeps its number and id
// between sessions (favorites are stored by id).
//
// A preset:
//   id, n (1-based number), name, cat (family id), tags (sub label)
//   unit    "c" characters (spaces skipped) | "w" words | "l" lines
//   rnd     0 = in reading order, otherwise the Random Seed
//   shape   "ramp" (smooth per-unit transition) | "square" (pops on)
//   spread  width of the selector ramp, % of the text: small = one unit
//           after the other, large = many units moving together
//   eh, el  selector Ease High / Ease Low
//   d3      needs per-character 3D (X/Y rotation, Z position)
//   v       the hidden look; values are for a 100 px font (host and
//           preview scale distances by the real font size):
//           o opacity, s [x,y] scale %, p [x,y,z] position, r rotation,
//           rx / ry X / Y rotation, sk skew, ska skew axis, tr tracking,
//           b [x,y] blur, ap [x,y,z] anchor point
(function (root) {
  "use strict";

  var UNITS = [["c", "Chars"], ["w", "Words"], ["l", "Lines"]];
  var ORDERS = [[0, ""], [1, "Random"]];
  var SPREAD = { c: 55, w: 70, l: 85 };

  var CATS = [
    { id: "fade", name: "Fade" },
    { id: "slide", name: "Slide" },
    { id: "pop", name: "Pop" },
    { id: "zoom", name: "Zoom" },
    { id: "blur", name: "Blur" },
    { id: "spin", name: "Spin" },
    { id: "flip", name: "Flip 3D" },
    { id: "tumble", name: "Tumble 3D" },
    { id: "depth", name: "Depth 3D" },
    { id: "skew", name: "Skew" },
    { id: "track", name: "Tracking" },
    { id: "drop", name: "Drop" },
    { id: "swing", name: "Swing" },
    { id: "stretch", name: "Stretch" },
    { id: "turn", name: "Rise & Turn" },
    { id: "scatter", name: "Scatter" },
    { id: "type", name: "Typewriter" },
    { id: "glitch", name: "Glitch" },
    { id: "remix", name: "Remix" }
  ];

  var list = [];
  var byId = {};

  function round(v) { return Math.round(v * 10) / 10; }

  // Adds one preset per unit x order for a look. `look` is
  // { key, name, tags, v, shape, spread, eh, el, d3, units, orders }.
  function add(cat, look) {
    var units = look.units || UNITS;
    var orders = look.orders || ORDERS;
    for (var u = 0; u < units.length; u += 1) {
      for (var o = 0; o < orders.length; o += 1) {
        var unit = units[u][0];
        var seed = orders[o][0] ? 7 + list.length % 23 : 0;
        var tags = [units[u][1]];
        if (orders[o][1]) { tags.push(orders[o][1]); }
        if (look.tags) { tags = tags.concat(look.tags); }
        var p = {
          id: cat + "-" + look.key + "-" + unit + (seed ? "r" : ""),
          n: list.length + 1,
          name: look.name,
          cat: cat,
          tags: tags.join(" · "),
          unit: unit,
          rnd: seed,
          shape: look.shape || "ramp",
          spread: look.spread ? look.spread[unit] || look.spread.c : (seed ? SPREAD[unit] - 10 : SPREAD[unit]),
          eh: look.eh || 0,
          el: look.el || 0,
          d3: !!look.d3,
          v: look.v
        };
        if (byId[p.id]) { continue; }
        byId[p.id] = p;
        list.push(p);
      }
    }
  }

  function each(items, fn) { for (var i = 0; i < items.length; i += 1) { fn(items[i], i); } }

  var STR3 = [[0.5, "Soft", "1"], [1, "", "2"], [2, "Strong", "3"]];
  var STR2 = [[0.6, "Soft", "1"], [1.6, "Strong", "3"]];
  function strTags(s, extra) {
    var t = [];
    if (s[1]) { t.push(s[1]); }
    return extra ? t.concat(extra) : t;
  }

  // ------------------------------------------------------------- Fade
  each([
    ["plain", "Fade", { o: 0 }],
    ["rise", "Fade Up", { o: 0, p: [0, 22, 0] }],
    ["fall", "Fade Down", { o: 0, p: [0, -22, 0] }],
    ["shrink", "Fade In Small", { o: 0, s: [82, 82] }],
    ["grow", "Fade In Big", { o: 0, s: [118, 118] }]
  ], function (f) {
    add("fade", { key: f[0], name: f[1], v: f[2] });
  });

  // ------------------------------------------------------------- Slide
  var DIRS = [["up", "Slide Up", [0, 1]], ["down", "Slide Down", [0, -1]], ["left", "Slide Left", [1, 0]], ["right", "Slide Right", [-1, 0]]];
  each(DIRS, function (d) {
    each(STR3, function (s) {
      var dist = 90 * s[0];
      each([["", null], ["b", "Blur"]], function (st) {
        var v = { o: 0, p: [round(d[2][0] * dist), round(d[2][1] * dist), 0] };
        if (st[0]) { v.b = d[2][0] ? [round(14 * s[0] + 4), 0] : [0, round(14 * s[0] + 4)]; }
        add("slide", { key: d[0] + s[2] + st[0], name: d[1], tags: strTags(s, st[1] ? [st[1]] : null), v: v });
      });
    });
  });

  // ------------------------------------------------------------- Pop
  each([["mid", "Center", [0, -35, 0]], ["base", "Baseline", [0, 0, 0]], ["top", "Top", [0, -75, 0]]], function (a) {
    each([["0", "Pop", [0, 0]], ["50", "Pop Soft", [50, 50]]], function (sc) {
      add("pop", { key: a[0] + sc[0], name: sc[1], tags: [a[1]], v: { o: 0, s: sc[2], ap: a[2] } });
    });
  });

  // ------------------------------------------------------------- Zoom
  each([["1", 170, "Soft"], ["2", 280, ""], ["3", 480, "Strong"]], function (z) {
    each([["", null], ["b", "Blur"]], function (st) {
      var v = { o: 0, s: [z[1], z[1]], ap: [0, -35, 0] };
      if (st[0]) { v.b = [18, 18]; }
      var tags = z[2] ? [z[2]] : [];
      if (st[1]) { tags.push(st[1]); }
      add("zoom", { key: z[0] + st[0], name: "Zoom Out", tags: tags, v: v });
    });
  });

  // ------------------------------------------------------------- Blur
  each([["all", "Blur In", [1, 1]], ["h", "Streak", [2.2, 0]], ["v", "Rain", [0, 2.2]]], function (b) {
    each(STR2, function (s) {
      each([["", null], ["t", "Spread"]], function (st) {
        var amount = 14 * s[0];
        var v = { o: 0, b: [round(amount * b[2][0]), round(amount * b[2][1])] };
        if (st[0]) { v.tr = round(70 * s[0]); }
        add("blur", { key: b[0] + s[2] + st[0], name: b[1], tags: strTags(s, st[1] ? [st[1]] : null), v: v });
      });
    });
  });

  // ------------------------------------------------------------- Spin
  each([[1, "cw", "Clockwise"], [-1, "ccw", "Counter"]], function (d) {
    each([[90, "90"], [180, "180"], [360, "360"]], function (a) {
      each([["s", "Spin", { s: [0, 0] }], ["f", "Spin Fade", { o: 0 }]], function (st) {
        var v = { r: -d[0] * a[0], ap: [0, -35, 0] };
        for (var k in st[2]) { v[k] = st[2][k]; }
        add("spin", { key: d[1] + a[1] + st[0], name: st[1], tags: [d[2], a[1] + "°"], v: v });
      });
    });
  });

  // ------------------------------------------------------------- Flip 3D
  each([["x", "Flip X", "rx"], ["y", "Flip Y", "ry"]], function (ax) {
    each([[1, "a", "Forward"], [-1, "b", "Back"]], function (d) {
      each([["c", "Center", [0, -35, 0]], ["e", "Hinge", ax[0] === "x" ? [0, -75, 0] : [-28, -35, 0]]], function (h) {
        var v = { o: 0, ap: h[2] };
        v[ax[2]] = d[0] * 90;
        add("flip", { key: ax[0] + d[1] + h[0], name: ax[1], tags: [d[2], h[1]], d3: true, v: v });
      });
    });
  });

  // ------------------------------------------------------------- Tumble 3D
  each([
    ["xy", "Tumble", { rx: 75, ry: -60 }],
    ["xz", "Roll", { rx: -90, r: 40 }],
    ["yz", "Twist", { ry: 110, r: -30 }],
    ["all", "Chaos", { rx: 120, ry: 80, r: 60 }]
  ], function (t) {
    each(STR2, function (s) {
      var v = { o: 0, ap: [0, -35, 0], p: [0, 0, round(-160 * s[0])] };
      for (var k in t[2]) { v[k] = round(t[2][k] * Math.min(1.3, s[0])); }
      add("tumble", { key: t[0] + s[2], name: t[1], tags: strTags(s), d3: true, v: v });
    });
  });

  // ------------------------------------------------------------- Depth 3D
  each([[-1, "near", "Fly In"], [1, "far", "Emerge"]], function (d) {
    each(STR3, function (s) {
      each([["", null], ["b", "Blur"]], function (st) {
        var v = { o: 0, p: [0, 0, round(d[0] * 420 * s[0])] };
        if (st[0]) { v.b = [12, 12]; }
        add("depth", { key: d[1] + s[2] + st[0], name: d[2], tags: strTags(s, st[1] ? [st[1]] : null), d3: true, v: v });
      });
    });
  });

  // ------------------------------------------------------------- Skew
  each([[1, "r", "Right"], [-1, "l", "Left"]], function (d) {
    each([[25, "1", "Soft"], [50, "2", ""], [70, "3", "Strong"]], function (a) {
      each([["h", 0, "Slant"], ["v", 90, "Shear"]], function (ax) {
        var v = { o: 0, sk: d[0] * a[0], ska: ax[1], p: [round(d[0] * -a[0] * 1.6), 0, 0] };
        var tags = [d[2]];
        if (a[2]) { tags.push(a[2]); }
        add("skew", { key: ax[0] + d[1] + a[1], name: ax[2], tags: tags, v: v });
      });
    });
  });

  // ------------------------------------------------------------- Tracking
  each([["out", "Expand", 1], ["in", "Collapse", -1]], function (d) {
    each(STR2, function (s) {
      each([["", null], ["b", "Blur"]], function (st) {
        var v = { o: 0, tr: d[2] > 0 ? round(160 * s[0]) : round(-45 * s[0]) };
        if (st[0]) { v.b = [10, 4]; }
        add("track", { key: d[0] + s[2] + st[0], name: d[1], tags: strTags(s, st[1] ? [st[1]] : null), v: v });
      });
    });
  });

  // ------------------------------------------------------------- Drop
  each(STR3, function (s) {
    each([["", 0, null], ["l", -22, "Tilt Left"], ["r", 22, "Tilt Right"]], function (t) {
      var v = { o: 0, p: [0, round(-150 * s[0]), 0] };
      if (t[1]) { v.r = t[1]; }
      add("drop", { key: s[2] + t[0], name: "Drop", tags: strTags(s, t[2] ? [t[2]] : null), v: v });
    });
  });

  // ------------------------------------------------------------- Swing
  each([["t", "Hang", [0, -95, 0]], ["b", "Stand", [0, 10, 0]]], function (pv) {
    each([[50, "1"], [100, "2"]], function (a) {
      each([[1, "r", "Right"], [-1, "l", "Left"]], function (d) {
        add("swing", { key: pv[0] + a[1] + d[1], name: pv[1], tags: [d[2], a[0] + "°"], v: { o: 0, ap: pv[2], r: d[0] * a[0] } });
      });
    });
  });

  // ------------------------------------------------------------- Stretch
  each([
    ["w", "Squeeze", [0, 100]],
    ["h", "Flatten", [100, 0]],
    ["tall", "Tall", [25, 320]],
    ["wide", "Wide", [320, 25]]
  ], function (t) {
    each([["", null], ["b", "Blur"]], function (st) {
      var v = { o: 0, s: t[2], ap: [0, -35, 0] };
      if (st[0]) { v.b = t[2][0] > t[2][1] ? [20, 0] : [0, 20]; }
      add("stretch", { key: t[0] + st[0], name: t[1], tags: st[1] ? [st[1]] : [], v: v });
    });
  });

  // ------------------------------------------------------------- Rise & Turn
  each(STR2, function (s) {
    each([[1, "r", "Right"], [-1, "l", "Left"]], function (d) {
      add("turn", { key: s[2] + d[1], name: "Rise & Turn", tags: strTags(s, [d[2]]), v: { o: 0, p: [0, round(70 * s[0]), 0], r: d[0] * round(18 * s[0]), ap: [0, -35, 0] } });
    });
  });

  // ------------------------------------------------------------- Scatter
  each([["ne", [1, -1]], ["nw", [-1, -1]], ["se", [1, 1]], ["sw", [-1, 1]]], function (dg) {
    each(STR2, function (s) {
      var d = 160 * s[0];
      add("scatter", {
        key: dg[0] + s[2], name: "Scatter", tags: strTags(s, [dg[0].toUpperCase()]),
        orders: [[1, "Random"]],
        v: { o: 0, p: [round(dg[1][0] * d), round(dg[1][1] * d * 0.7), 0], r: dg[1][0] * 35, s: [60, 60] }
      });
    });
  });

  // ------------------------------------------------------------- Typewriter
  each([
    ["plain", "Typewriter", { o: 0 }],
    ["pop", "Type Pop", { o: 0, s: [140, 140], ap: [0, -35, 0] }],
    ["drop", "Type Drop", { o: 0, p: [0, -18, 0] }]
  ], function (t) {
    add("type", { key: t[0], name: t[1], shape: "square", spread: { c: 100, w: 100, l: 100 }, v: t[2] });
  });

  // ------------------------------------------------------------- Glitch
  each([
    ["skew", "Glitch Skew", { o: 0, sk: 45, ska: 0, p: [30, 0, 0] }],
    ["shift", "Glitch Shift", { o: 0, p: [-60, 8, 0], tr: 60 }],
    ["blur", "Glitch Blur", { o: 0, b: [40, 0], s: [130, 100] }],
    ["flash", "Glitch Flash", { o: 0, s: [100, 160], sk: -30, ska: 90 }]
  ], function (g) {
    add("glitch", { key: g[0], name: g[1], shape: "square", spread: { c: 30, w: 35, l: 45 }, orders: [[1, "Random"]], v: g[2] });
  });

  var CURATED = list.length;

  // ------------------------------------------------------------- Remix
  // Seeded random mixes of the ingredients above, until the library has
  // TOTAL presets. Each mix always ends hidden (faded or scaled to ~0).
  var TOTAL = 2100;
  var seed = 20261021;
  function rand() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function between(lo, hi) { return lo + rand() * (hi - lo); }
  function sign() { return rand() < 0.5 ? -1 : 1; }
  function pick(items) { return items[Math.floor(rand() * items.length)]; }

  var INGREDIENTS = [
    ["Scale", function (v) { var k = rand() < 0.6 ? round(between(0, 45)) : round(between(150, 340)); v.s = rand() < 0.75 ? [k, k] : (rand() < 0.5 ? [k, 100] : [100, k]); }],
    ["Move", function (v) { var a = rand() * Math.PI * 2; var d = between(40, 260); v.p = [round(Math.cos(a) * d), round(Math.sin(a) * d), 0]; }],
    ["Spin", function (v) { v.r = round(sign() * between(20, 200)); }],
    ["Flip", function (v) { v.rx = round(sign() * between(40, 110)); }],
    ["Turn", function (v) { v.ry = round(sign() * between(40, 120)); }],
    ["Skew", function (v) { v.sk = round(sign() * between(15, 65)); v.ska = round(between(0, 90)); }],
    ["Track", function (v) { v.tr = rand() < 0.7 ? round(between(30, 220)) : round(between(-60, -20)); }],
    ["Blur", function (v) { var b = between(5, 30); v.b = rand() < 0.6 ? [round(b), round(b)] : (rand() < 0.5 ? [round(b * 1.6), 0] : [0, round(b * 1.6)]); }],
    ["Pivot", function (v) { v.ap = [round(between(-50, 50)), round(between(-130, 40)), 0]; }],
    ["Depth", function (v) { v.p = v.p || [0, 0, 0]; v.p[2] = round(sign() * between(150, 500)); }]
  ];

  var remixN = 0;
  while (list.length < TOTAL) {
    var v = {};
    var used = [];
    var count = 2 + Math.floor(rand() * 3);
    var guard = 0;
    while (used.length < count && guard < 20) {
      guard += 1;
      var ing = pick(INGREDIENTS);
      if (used.indexOf(ing[0]) >= 0) { continue; }
      used.push(ing[0]);
      ing[1](v);
    }
    var hidden = (v.s && (v.s[0] <= 12 || v.s[1] <= 12));
    if (!hidden || rand() < 0.65) { v.o = 0; }
    if (v.s && !v.ap) { v.ap = [0, -35, 0]; }
    var d3 = !!(v.rx || v.ry || (v.p && v.p[2]));
    var r = rand();
    var unit = r < 0.5 ? "c" : (r < 0.8 ? "w" : "l");
    var random = rand() < 0.25;
    remixN += 1;
    var p = {
      id: "remix-" + remixN,
      n: list.length + 1,
      name: "Remix " + remixN,
      cat: "remix",
      tags: [unit === "c" ? "Chars" : unit === "w" ? "Words" : "Lines"].concat(random ? ["Random"] : []).concat(used).join(" · "),
      unit: unit,
      rnd: random ? 3 + remixN % 31 : 0,
      shape: "ramp",
      spread: Math.round(between(35, 95)),
      eh: rand() < 0.3 ? Math.round(between(-40, 60)) : 0,
      el: rand() < 0.3 ? Math.round(between(-40, 60)) : 0,
      d3: d3,
      v: v
    };
    byId[p.id] = p;
    list.push(p);
  }

  // ------------------------------------------------------------- Combos
  // Ready In + Out pairs.
  var COMBOS = [
    ["Clean", "fade-rise-w", "fade-fall-w"],
    ["Cinema", "blur-all1t-c", "blur-all1t-c"],
    ["Headline", "slide-up2-l", "slide-up2-l"],
    ["Bounce", "pop-base0-c", "pop-base0-c"],
    ["Elegant", "track-in1b-c", "fade-plain-c"],
    ["Punch", "zoom-2b-w", "zoom-1-w"],
    ["Flipbook", "flip-xae-c", "flip-xbe-c"],
    ["Typewriter", "type-plain-c", "fade-plain-w"],
    ["Fly", "depth-near2b-c", "depth-far2b-c"],
    ["Glitch", "glitch-skew-cr", "glitch-shift-cr"],
    ["Swing", "swing-t1r-c", "swing-t1l-c"],
    ["Streak", "blur-h3-c", "slide-left2b-w"]
  ].filter(function (c) { return byId[c[1]] && byId[c[2]]; }).map(function (c) {
    return { name: c[0], inId: c[1], outId: c[2] };
  });

  root.MFTextAnimLib = {
    cats: CATS,
    presets: list,
    byId: byId,
    combos: COMBOS,
    curated: CURATED
  };
}(this));
