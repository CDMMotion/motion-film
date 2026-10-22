// Mótion Film -- Captions: layout of a Reels / Viral caption (small words
// above, the big highlighted word, small words below). Plain ES3 on
// purpose: the panel runs it for the style previews and host.jsx loads
// the same file ($.evalFile) to place the real layers, so a card shows
// exactly the arrangement the comp gets.
//
//   MFCaptionsLayout.rows(words, P)      which words go in which line, and
//                                        in which role (base / accent /
//                                        lead / tail)
//   MFCaptionsLayout.layout(rows, P, W, H, k)
//                                        sizes and places measured lines
//
// A word: { text, accent }. P = the style (see client/captions-styles.js).
// Sizes are px at a 1080 short side, k scales them to the comp.
(function (root) {
  var L = {};

  function textOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      out.push(list[i].text);
    }
    return out.join(" ");
  }

  function lengthOf(list, a, b) {
    var n = 0;
    for (var i = a; i < b; i += 1) {
      n += list[i].text.length + (i > a ? 1 : 0);
    }
    return n;
  }

  // As few lines as hold `cap` letters each, cut where the longest line
  // is shortest (even lines, no lonely word at the end).
  function wrap(list, cap) {
    var total = lengthOf(list, 0, list.length);
    if (total <= cap || list.length < 2) {
      return [list];
    }
    var count = Math.min(list.length, Math.ceil(total / cap));
    var n = list.length;
    var best = [];
    var from = [];
    var q, i, j;
    for (q = 0; q <= count; q += 1) {
      best.push([]);
      from.push([]);
      for (i = 0; i <= n; i += 1) {
        best[q].push(1e9);
        from[q].push(0);
      }
    }
    best[0][0] = 0;
    for (q = 1; q <= count; q += 1) {
      for (i = 1; i <= n; i += 1) {
        for (j = q - 1; j < i; j += 1) {
          var v = Math.max(best[q - 1][j], lengthOf(list, j, i));
          if (v < best[q][i]) {
            best[q][i] = v;
            from[q][i] = j;
          }
        }
      }
    }
    var lines = [];
    var end = n;
    for (q = count; q >= 1; q -= 1) {
      lines.unshift(list.slice(from[q][end], end));
      end = from[q][end];
    }
    return lines;
  }

  function spec(P, part) {
    return (P.lay && P.lay[part]) || {};
  }

  // rows: [{ part: "pre" | "emph" | "post", role, words, text, align,
  // inset }] -- one text layer each.
  L.rows = function (words, P) {
    var a = -1;
    var b = -1;
    var i;
    for (i = 0; i < words.length; i += 1) {
      if (words[i].accent) {
        if (a < 0) { a = i; }
        b = i;
      }
    }
    if (a < 0) {
      a = b = words.length - 1;
    }
    var rows = [];
    function add(list, role, part, s) {
      if (!list.length) { return; }
      var lines = wrap(list, s.cap || 16);
      for (var r = 0; r < lines.length; r += 1) {
        rows.push({ part: part, role: role, words: lines[r], text: textOf(lines[r]), align: s.align || "center", inset: s.inset === undefined ? 0.1 : s.inset });
      }
    }
    var pre = words.slice(0, a);
    if (P.lead && pre.length) {
      var ls = spec(P, "lead");
      rows.push({ part: "pre", role: "lead", words: [pre[0]], text: pre[0].text, align: ls.align || "center", inset: ls.inset === undefined ? 0.1 : ls.inset });
      pre = pre.slice(1);
    }
    add(pre, "base", "pre", spec(P, "pre"));
    var emph = words.slice(a, b + 1);
    var emphText = textOf(emph);
    if (emph.length > 1 && emphText.length > 14) {
      add(emph, "accent", "emph", { cap: Math.ceil(emphText.length / 2) + 1, align: "center" });
    } else {
      rows.push({ part: "emph", role: "accent", words: emph, text: emphText, align: "center", inset: 0 });
    }
    add(words.slice(b + 1), P.tail ? "tail" : "base", "post", spec(P, "post"));
    return rows;
  };

  var GAPS = { prepre: 0.05, preemph: 0.035, emphemph: 0.02, emphpost: 0.06, postpost: 0.05 };

  // rows[i].rect = ink box of its text at scale 1 ({ left, top, width,
  // height }, layer space, baseline at y 0), rows[i].size = its role's
  // font size in px (already x k). W = width the block may use, H = comp
  // height. Sets on every row: s (scale), x / y (where the ink box's
  // center goes, relative to the caption's center) and returns
  // { rows, accentSize, top, bottom } (block edges, same space).
  L.layout = function (rows, P, W, H, k) {
    var i, r;
    var fit = P.fit || 0.86;
    var E = 0;
    var accentSize = 0;
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      if (r.part !== "emph") { continue; }
      var role = P[r.role] || {};
      var maxScale = (role.maxSize || role.size * 1.4) / role.size;
      r.s = Math.min(fit * W / Math.max(1, r.rect.width), maxScale);
      E = Math.max(E, r.rect.width * r.s);
      accentSize = Math.max(accentSize, r.size * r.s);
    }
    if (!accentSize) {
      accentSize = 100 * k;
    }
    // the small words follow the highlight's size, never wider than the
    // block around it
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      if (r.part === "emph") { continue; }
      var rel = (P[r.role] && P[r.role].rel) || P.small || 0.34;
      r.s = Math.min(rel, 0.7) * accentSize / Math.max(1, r.size);
      var limit = Math.min(W, Math.max(E * 1.15, 0.5 * W));
      if (r.rect.width * r.s > limit) {
        r.s = limit / r.rect.width;
      }
    }
    if (!E) {
      for (i = 0; i < rows.length; i += 1) { E = Math.max(E, rows[i].rect.width * rows[i].s); }
    }
    // 1) stacked by their ink, a gap (in highlight sizes) between lines
    var gaps = P.gaps || {};
    var y = 0;
    var emphTop = null;
    var emphBottom = null;
    var blockW = 0;
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      r.w = r.rect.width * r.s;
      r.h = r.rect.height * r.s;
      blockW = Math.max(blockW, r.w);
      if (i > 0) {
        var key = rows[i - 1].part + r.part;
        var g = gaps[key] !== undefined ? gaps[key] : GAPS[key];
        y += (g === undefined ? 0.05 : g) * accentSize;
      }
      r.top = y;
      y += r.h;
      if (r.part === "emph") {
        if (emphTop === null) { emphTop = r.top; }
        emphBottom = r.top + r.h;
      }
    }
    var bottom = y;
    var center = P.centered || emphTop === null ? bottom / 2 : (emphTop + emphBottom) / 2;
    // 2) across: the highlight centered; words above lean left, words
    //    below lean right (sticking out on their side when wider)
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      var left;
      var inset = (r.inset || 0) * E;
      if (P.block === "left") {
        left = -blockW / 2;
      } else if (r.align === "left") {
        left = Math.min(-E / 2 + inset, Math.max(E / 2 - r.w, -r.w / 2 - 0.06 * E));
      } else if (r.align === "right") {
        left = Math.max(E / 2 - inset - r.w, Math.min(-E / 2, -r.w / 2 + 0.06 * E));
      } else {
        left = -r.w / 2;
      }
      r.left = left;
      r.x = left + r.w / 2;
      r.y = r.top - center + r.h / 2;
    }
    return { rows: rows, accentSize: accentSize, top: -center, bottom: bottom - center, width: E };
  };

  L.wrap = wrap;
  root.MFCaptionsLayout = L;
}(typeof window !== "undefined" ? window : $.global));
