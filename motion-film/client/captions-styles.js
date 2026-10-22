// Mótion Film -- Captions: the Reels and Viral styles (a big highlighted
// word with small words around it). Used by captions.js for the cards
// and sent to host.jsx (createCaptionSet) as the look of every piece.
//
// A style has roles -- base (small words), accent (the highlight), and
// optionally lead (the first word above, in its own font) and tail (the
// words below) -- each with:
//   family / style / font  font family + style (preview) and PostScript
//                          name (AE); the bundled fonts are in /fonts
//   size, maxSize          px for a 1080 short side (the highlight is
//                          scaled to `fit` of the width, up to maxSize)
//   rel                    size as a fraction of the highlight's
//   fill, gradient {top, bottom, diag}, stroke {color, width},
//   shadow {opacity, distance, softness}, outerGlow [{color, opacity,
//   softness}] (soft halos), glow {radius, intensity}, sweep (a thin
//   still light edge), tracking, opacity
// and layout: small (small words' size vs the highlight), lay.pre /
// lay.post {align left|right|center, inset, cap (letters per line)},
// gaps (between lines, in highlight sizes), fit, block "left" (a left
// aligned block), centered, period (the highlight ends with "."),
// preCase, underline (a hand-drawn line under the highlight), palette
// (accent colors used in turn), anim (the style's own animation).
(function (root) {
  "use strict";

  var SOFT = { opacity: 45, distance: 3, softness: 16 };
  var INTER = { family: "Inter", style: "Bold", font: "Inter-Bold" };
  var INTER_XB = { family: "Inter", style: "ExtraBold", font: "Inter-ExtraBold" };
  var INTER_BLACK = { family: "Inter", style: "Black", font: "Inter-Black" };

  function role(face, extra) {
    var r = {};
    var k;
    for (k in face) { r[k] = face[k]; }
    for (k in extra) { r[k] = extra[k]; }
    return r;
  }
  var LEAN = { pre: { align: "left", inset: 0.05, cap: 16 }, post: { align: "right", inset: 0.05, cap: 16 } };

  var STYLES = [
    // ---------------------------------------------------------------- Reels
    {
      id: "spotlight", name: "Spotlight", group: "reels", sample: ["if you are", "tired", "of starting"], small: 0.31, lay: LEAN, anim: "rise",
      base: role(INTER, { size: 68, fill: "#ffffff", tracking: -25, shadow: { opacity: 35, distance: 4, softness: 9 } }),
      accent: role(INTER_XB, { size: 225, maxSize: 230, fill: "#3d7bff", gradient: { top: "#86afff", bottom: "#2457ff" }, sweep: true, tracking: -55, shadow: { opacity: 35, distance: 4, softness: 11 } })
    },
    {
      id: "fullstop", name: "Full stop", group: "reels", sample: ["be more", "consistent."], period: true, small: 0.36, lay: { pre: { align: "left", inset: 0.03, cap: 16 }, post: { align: "right", inset: 0.04, cap: 16 } }, gaps: { preemph: 0.01 }, anim: "fromRight",
      base: role(INTER, { size: 60, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role(INTER_XB, { size: 168, maxSize: 170, fill: "#ffd21a", gradient: { top: "#fff07a", bottom: "#ffbf00" }, tracking: -60, shadow: SOFT })
    },
    {
      id: "below", name: "Below", group: "reels", sample: ["it is built", "through", "habits"], small: 0.33, lay: LEAN, anim: "slideWords",
      base: role(INTER, { size: 60, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role(INTER_XB, { size: 185, maxSize: 190, fill: "#ff7a1a", gradient: { top: "#ffb36b", bottom: "#ff5500" }, sweep: true, tracking: -55, shadow: SOFT })
    },
    {
      id: "serif", name: "Serif", group: "reels", sample: ["it all starts with", "discipline"], small: 0.29, lay: LEAN, gaps: { preemph: 0.02 }, anim: "zoomBlur",
      base: role(INTER, { size: 60, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role({ family: "Playfair Display", style: "Black Italic", font: "PlayfairDisplay-BlackItalic" }, { size: 205, maxSize: 210, fill: "#ff5fa2", gradient: { top: "#ffa3c9", bottom: "#ff3d8b" }, tracking: -20, shadow: SOFT })
    },
    {
      id: "keynote", name: "Keynote", group: "reels", sample: ["THREE YEARS LATER", "freedom"], preCase: "upper", small: 0.22, lay: { pre: { align: "center", cap: 24 }, post: { align: "center", cap: 18 } }, gaps: { preemph: 0.11 }, anim: "lettersSpread",
      base: role(INTER, { size: 38, fill: "#ffffff", tracking: 320, opacity: 85, shadow: SOFT }),
      tail: role(INTER, { size: 60, rel: 0.35, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role(INTER, { size: 175, maxSize: 175, fill: "#39d5ff", gradient: { top: "#9cf0ff", bottom: "#16b4ff" }, sweep: true, tracking: -50, shadow: SOFT })
    },
    {
      id: "underline", name: "Underline", group: "reels", sample: ["the only thing that", "matters", "is starting"], underline: true, small: 0.35, lay: { pre: { align: "left", inset: 0.04, cap: 18 }, post: { align: "right", inset: 0.04, cap: 16 } }, gaps: { emphpost: 0.24 }, anim: "bounce",
      base: role(INTER, { size: 60, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role(INTER_XB, { size: 175, maxSize: 175, fill: "#ff2b3d", gradient: { top: "#ff6b78", bottom: "#e0001b" }, tracking: -55, shadow: SOFT })
    },
    {
      id: "side", name: "Side", group: "reels", sample: ["what", "nobody", "tells you"], block: "left", small: 0.35, lay: { pre: { align: "left", cap: 16 }, post: { align: "left", cap: 16 } }, gaps: { prepre: 0.04, postpost: 0.04 }, fit: 0.8, anim: "fromLeft",
      base: role(INTER, { size: 60, fill: "#ffffff", tracking: -25, shadow: SOFT }),
      accent: role(INTER_XB, { size: 175, maxSize: 175, fill: "#b6ff3b", gradient: { top: "#e2ff9e", bottom: "#8ee600" }, tracking: -55, shadow: SOFT })
    },
    {
      id: "number", name: "Number", group: "reels", sample: ["I made", "30k", "a month"], small: 0.27, lay: { pre: { align: "left", inset: 0.03, cap: 16 }, post: { align: "right", inset: -0.04, cap: 16 } }, gaps: { emphpost: -0.06 }, anim: "lettersRight",
      base: role(INTER, { size: 65, fill: "#ffffff", tracking: -30, shadow: SOFT }),
      tail: role({ family: "Great Vibes", style: "Regular", font: "GreatVibes-Regular" }, { size: 140, rel: 0.58, fill: "#ffffff", tracking: 0, outerGlow: [{ color: "#ffffff", opacity: 40, softness: 11 }], shadow: SOFT }),
      accent: role(INTER_XB, { size: 240, maxSize: 240, fill: "#ffcf4a", gradient: { top: "#ffe9a3", bottom: "#ffae00" }, sweep: true, tracking: -60, shadow: SOFT })
    },
    {
      id: "classy", name: "Classy", group: "reels", sample: ["a", "smart", "move."], small: 0.5, maxPre: 2, maxPost: 2, maxWords: 4, lay: { pre: { align: "center", cap: 12 }, post: { align: "center", cap: 12 } }, gaps: { preemph: 0.1, emphpost: 0.1 }, fit: 0.8, anim: "scale",
      base: role(INTER, { size: 180, fill: "#ffffff", gradient: { top: "#ffffff", bottom: "#e3e8e3" }, tracking: -40, outerGlow: [{ color: "#9bea95", opacity: 28, softness: 18 }] }),
      accent: role({ family: "Libre Caslon Text", style: "Italic", font: "LibreCaslonText-Italic" }, { size: 180, maxSize: 180, fill: "#7bcd74", gradient: { top: "#a2ec9c", bottom: "#6ac263" }, stroke: { color: "#7bcd74", width: 1.9 }, tracking: 0, outerGlow: [{ color: "#5fdc5f", opacity: 55, softness: 24 }] })
    },
    {
      id: "script", name: "Script", group: "reels", sample: ["Kitchen and bath", "remodelers,", ""], centered: true, small: 0.62, lay: { lead: { align: "center" }, pre: { align: "center", cap: 8 }, post: { align: "center", cap: 14 } }, gaps: { prepre: 0.1, preemph: -0.05 }, fit: 0.92, anim: "dropBlur",
      lead: role({ family: "Great Vibes", style: "Regular", font: "GreatVibes-Regular" }, { size: 173, rel: 0.63, fill: "#c570d2", gradient: { top: "#b24cf0", bottom: "#f1c4f8", diag: true }, tracking: 0, outerGlow: [{ color: "#c25cff", opacity: 95, softness: 10 }, { color: "#b040ff", opacity: 60, softness: 38 }] }),
      base: role(INTER, { size: 170, fill: "#ffffff", gradient: { top: "#ffffff", bottom: "#ece4f0" }, tracking: -40, outerGlow: [{ color: "#c070ff", opacity: 40, softness: 22 }] }),
      accent: role({ family: "Great Vibes", style: "Regular", font: "GreatVibes-Regular" }, { size: 275, maxSize: 275, fill: "#c570d2", gradient: { top: "#b24cf0", bottom: "#f1c4f8", diag: true }, tracking: 0, outerGlow: [{ color: "#c25cff", opacity: 95, softness: 14 }, { color: "#b040ff", opacity: 60, softness: 56 }] })
    },
    // ---------------------------------------------------------------- Viral
    {
      id: "mint", name: "Mint", group: "viral", sample: ["those who have", "discipline", "always win"], small: 0.5, lay: { pre: { align: "left", inset: 0.14, cap: 20 }, post: { align: "center", cap: 20 } }, gaps: { preemph: -0.04, emphpost: -0.02 }, fit: 0.8, anim: "smooth",
      base: role(INTER, { size: 90, fill: "#ffffff", tracking: -35, shadow: { opacity: 50, distance: 0, softness: 22 } }),
      accent: role(INTER_BLACK, { size: 200, maxSize: 330, fill: "#3fe3b0", gradient: { top: "#a8ffe4", bottom: "#22c995" }, sweep: true, tracking: -60, shadow: { opacity: 60, distance: 0, softness: 34 } }),
      palette: [{}, { fill: "#ff2b2b", gradient: { top: "#ff3d3d", bottom: "#d0000f" } }, {}, { fill: "#8fe8ff", gradient: { top: "#f2fdff", bottom: "#62d4ff" } }]
    },
    {
      id: "blueserif", name: "Blue serif", group: "viral", sample: ["I made these", "animations", "fast"], small: 0.52, lay: { pre: { align: "left", inset: 0.08, cap: 20 }, post: { align: "right", inset: 0.04, cap: 20 } }, gaps: { preemph: -0.1 }, fit: 0.78, anim: "lettersSpin",
      base: role(INTER_XB, { size: 96, fill: "#ffffff", tracking: -40, shadow: { opacity: 50, distance: 0, softness: 22 } }),
      accent: role({ family: "Playfair Display", style: "ExtraBold Italic", font: "PlayfairDisplay-ExtraBoldItalic" }, { size: 210, maxSize: 350, fill: "#2f8bff", gradient: { top: "#5ea8ff", bottom: "#2f74ff" }, glow: { radius: 12, intensity: 0.22 }, outerGlow: [{ color: "#1f6bff", opacity: 60, softness: 30 }], tracking: -30 })
    },
    {
      id: "fire", name: "Fire", group: "viral", sample: ["my business made", "30k", ""], small: 0.5, lay: { pre: { align: "left", inset: 0, cap: 20 }, post: { align: "right", inset: 0, cap: 20 } }, gaps: { preemph: 0.04 }, fit: 0.76, anim: "zoomBlur",
      base: role(INTER_XB, { size: 92, fill: "#ffffff", tracking: -45, shadow: { opacity: 50, distance: 0, softness: 22 } }),
      accent: role(INTER_BLACK, { size: 190, maxSize: 300, fill: "#ff9a12", gradient: { top: "#ffd41a", bottom: "#ff4a00" }, glow: { radius: 16, intensity: 0.45 }, outerGlow: [{ color: "#c81800", opacity: 80, softness: 150 }], tracking: -45 })
    }
  ];

  // Every font the styles use, with the bundled file (client/../fonts).
  var FONT_FILES = {
    "Inter-Medium": "Inter-Medium.ttf", "Inter-SemiBold": "Inter-SemiBold.ttf", "Inter-Bold": "Inter-Bold.ttf",
    "Inter-ExtraBold": "Inter-ExtraBold.ttf", "Inter-Black": "Inter-Black.ttf",
    "Montserrat-ExtraBold": "Montserrat-ExtraBold.ttf", "Montserrat-Black": "Montserrat-Black.ttf", "Montserrat-BlackItalic": "Montserrat-BlackItalic.ttf",
    "PlayfairDisplay-ExtraBoldItalic": "PlayfairDisplay-ExtraBoldItalic.ttf", "PlayfairDisplay-BlackItalic": "PlayfairDisplay-BlackItalic.ttf",
    "GreatVibes-Regular": "GreatVibes-Regular.ttf", "InstrumentSerif-Regular": "InstrumentSerif-Regular.ttf",
    "InstrumentSerif-Italic": "InstrumentSerif-Italic.ttf", "LibreCaslonText-Italic": "LibreCaslonText-Italic.ttf",
    "DancingScript-Bold": "DancingScript-Bold.ttf"
  };
  var FONT_FULL_NAMES = {
    "Inter-Medium": "Inter Medium", "Inter-SemiBold": "Inter SemiBold", "Inter-Bold": "Inter Bold", "Inter-ExtraBold": "Inter ExtraBold",
    "Inter-Black": "Inter Black", "Montserrat-ExtraBold": "Montserrat ExtraBold", "Montserrat-Black": "Montserrat Black",
    "Montserrat-BlackItalic": "Montserrat Black Italic", "PlayfairDisplay-ExtraBoldItalic": "Playfair Display ExtraBold Italic",
    "PlayfairDisplay-BlackItalic": "Playfair Display Black Italic", "GreatVibes-Regular": "Great Vibes Regular",
    "InstrumentSerif-Regular": "Instrument Serif Regular", "InstrumentSerif-Italic": "Instrument Serif Italic",
    "LibreCaslonText-Italic": "Libre Caslon Text Italic", "DancingScript-Bold": "Dancing Script Bold"
  };

  function byId(id) {
    for (var i = 0; i < STYLES.length; i += 1) {
      if (STYLES[i].id === id) { return STYLES[i]; }
    }
    return null;
  }

  var ROLES = ["lead", "base", "tail", "accent"];

  root.MFCaptionStyles = { STYLES: STYLES, ROLES: ROLES, byId: byId, FONT_FILES: FONT_FILES, FONT_FULL_NAMES: FONT_FULL_NAMES };
}(window));
