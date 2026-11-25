/*
 * Mótion Film -- the built-in gradients of Packs › Gradients
 * (client/gradients.js). Our own palettes.
 *
 * Each one: [name, stops]. Stops are "#hex" spaced evenly, or "#hex@40"
 * to pin one at 40 %. Any number of stops.
 */
(function () {
  "use strict";

  var GROUPS = [
    { id: "sunset", name: "Sunset", list: [
      ["Golden Hour", "#ffcf71 #ff9a5a #f2627a #8b3d8f"],
      ["Dusk", "#fbd786 #f7797d #c6426e #3b1f5e"],
      ["Tropic", "#ffe259 #ffa751 #ff5e62 #b0306a"],
      ["Afterglow", "#ffd3a5 #fd6585 #8e44ad #2c2a4a"],
      ["Desert", "#f8e1b4 #e9a66a #c7603f #6e2f2a"],
      ["Mango", "#ffe000 #ffb100 #ff7b00 #ff3d00"],
      ["Sunrise Sea", "#fceabb #f8b500 #f56b5c #6b5b95 #2b4c7e"],
      ["Flamingo", "#ffd1dc #ff8fab #fb6f92 #c9184a"],
      ["Ember", "#2b0f0e #7a1f12 #d9480f #ffb347 #fff1c1"]
    ] },
    { id: "gold", name: "Gold", list: [
      ["Bullion", "#7a5418 #c99a3a@25 #f5e3a3@50 #c49237@75 #6b4612"],
      ["Champagne", "#e8d3a7 #fff4dc@35 #d4b47c@65 #a07f45"],
      ["Old Gold", "#4d3410 #9c7330 #e0c070 #9c7330 #4d3410"],
      ["Rose Gold", "#8c5a4a #e0a990@30 #fbe2d5@50 #d39a85@70 #7d4c3e"],
      ["Brass", "#5c4a1c #b59a45 #f0dc8c #b59a45 #5c4a1c"],
      ["Honey", "#fff3b0 #ffd166 #f4a261 #b5651d"],
      ["Royal", "#2c1654 #6b3fa0 #d4af37@60 #fff1b8"],
      ["Copper", "#3d1f12 #a0522d #e8965a@50 #a0522d #3d1f12"]
    ] },
    { id: "silver", name: "Silver", list: [
      ["Chrome", "#4a4f55 #d9dde2@25 #8a9097@45 #ffffff@60 #6a7077@80 #c5cad0"],
      ["Platinum", "#9ea4aa #f4f6f8@40 #c8ccd1@60 #7d838a"],
      ["Steel", "#2f3640 #8795a1 #dfe6ec #8795a1 #2f3640"],
      ["Pearl", "#f5f0ea #ffffff@30 #e4dcd4@55 #fbf8f4@80 #d8cfc6"],
      ["Gunmetal", "#141618 #3d4349 #7c858d@50 #3d4349 #141618"],
      ["Mercury", "#cfd8dc #ffffff@20 #90a4ae@50 #eceff1@80 #b0bec5"],
      ["Ice Metal", "#a7c0cd #eaf6ff@35 #8fa9b8@60 #dfeffa"],
      ["Graphite", "#202124 #5f6368 #bdc1c6 #5f6368"]
    ] },
    { id: "pastel", name: "Pastel", list: [
      ["Cotton Candy", "#ffc8dd #ffafcc #bde0fe #a2d2ff"],
      ["Sorbet", "#ffd6a5 #fdffb6 #caffbf #9bf6ff"],
      ["Lavender Milk", "#e0c3fc #c8b6ff #b8c0ff #bbd0ff"],
      ["Peach Fuzz", "#ffe5d9 #ffcad4 #f4acb7 #d8a7b1"],
      ["Mint Cream", "#d8f3dc #b7e4c7 #95d5b2 #c7f9cc"],
      ["Dreamy", "#fbc2eb #a6c1ee #c2e9fb"],
      ["Soft Sky", "#e0f7fa #b2ebf2 #d1c4e9 #f8bbd0"],
      ["Macaron", "#f7d6e0 #f2b5d4 #eff7f6 #b2f7ef #7bdff2"],
      ["Butter", "#fff9db #ffec99 #ffd8a8 #ffc9c9"]
    ] },
    { id: "chroma", name: "Chroma", list: [
      ["Spectrum", "#ff0040 #ff8a00 #ffe600 #2bd94c #00b3ff #6a3bff #ff00c8"],
      ["Prism", "#f72585 #7209b7 #3a0ca3 #4361ee #4cc9f0"],
      ["Rainbow", "#ff3b30 #ff9500 #ffd60a #34c759 #0a84ff #5e5ce6"],
      ["Holo", "#ff9ad5 #b28dff #8ee6ff #a5ffb5 #fff59d #ff9ad5"],
      ["Iridescent", "#7afcff #c8a2ff #ff9ff3 #feff9c #7afcff"],
      ["Candy Pop", "#ff006e #fb5607 #ffbe0b #8338ec #3a86ff"],
      ["Aurora", "#00f5a0 #00d9f5 #7b61ff #f72585"],
      ["Oil Slick", "#1b1b3a #693668 #a74482 #f84aa7 #ff3562 #2ec4b6 #1b1b3a"]
    ] },
    { id: "heatmap", name: "Heatmap", list: [
      ["Thermal", "#000004 #3b0f70 #8c2981 #de4968 #fe9f6d #fcfdbf"],
      ["Inferno", "#000004 #420a68 #932667 #dd513a #fca50a #fcffa4"],
      ["Magma", "#000004 #1c1044 #4f127b #812581 #b5367a #e55064 #fb8761 #fec287 #fcfdbf"],
      ["Viridis", "#440154 #3b528b #21918c #5ec962 #fde725"],
      ["Plasma", "#0d0887 #6a00a8 #b12a90 #e16462 #fca636 #f0f921"],
      ["Night Vision", "#000000 #003b00 #00a000 #9bff9b #ffffff"],
      ["Jet", "#00007f #0000ff #00ffff #ffff00 #ff0000 #7f0000"],
      ["Lava", "#120000 #5c0000 #c21807 #ff6a00 #ffd000"]
    ] },
    { id: "retro", name: "Retro", list: [
      ["Synthwave", "#2b1055 #7597de@40 #ff6ec7@70 #ffcf5c"],
      ["Outrun", "#0f0c29 #302b63 #ff2e97 #ffd319"],
      ["70s", "#3d2b1f #a0522d #e07a2e #f2b134 #f7dc6f"],
      ["Polaroid", "#f2e8cf #e9c46a #f4a261 #e76f51 #6d597a"],
      ["Vapor", "#ff71ce #b967ff #01cdfe #05ffa1 #fffb96"],
      ["Arcade", "#120458 #7a04eb #ff00a0 #fe75fe"],
      ["Faded Film", "#264653 #2a9d8f #e9c46a #f4a261 #e76f51"],
      ["Diner", "#0a9396 #94d2bd #e9d8a6 #ee9b00 #ca6702 #ae2012"]
    ] },
    { id: "neon", name: "Neon", list: [
      ["Electric", "#00f0ff #3d5afe #d500f9"],
      ["Cyber", "#0aff9d #00b3ff #7b2dff"],
      ["Laser", "#ff0080 #ff8c00 #fff200"],
      ["Club", "#12c2e9 #c471ed #f64f59"],
      ["Toxic", "#d4fc79 #96e6a1 #00f260 #0575e6"],
      ["Hot Pink", "#ff0099 #ff5ec4 #ffb3e6"],
      ["Ultraviolet", "#14002b #5b00ff #c300ff #ff4dff"],
      ["Mótion", "#00f011 #00d4ff #8a2be2"]
    ] },
    { id: "ocean", name: "Ocean", list: [
      ["Deep Sea", "#000428 #004e92 #00a8cc"],
      ["Lagoon", "#43e97b #38f9d7 #00c6ff"],
      ["Reef", "#00b4db #0083b0 #023e8a #03045e"],
      ["Glacier", "#e0f7ff #a8e6ff #4fc3f7 #0277bd"],
      ["Tide", "#caf0f8 #90e0ef #00b4d8 #0077b6 #03045e"],
      ["Abyss", "#010b13 #05445e #189ab4 #75e6da"],
      ["Caribbean", "#f9f871 #a8e6cf #1fab89 #0f4c75"],
      ["Storm", "#1e3c72 #2a5298 #6dd5ed #cfdef3"]
    ] },
    { id: "nature", name: "Nature", list: [
      ["Forest", "#0b3d20 #1e6f3d #4caf50 #a5d6a7"],
      ["Moss", "#344e41 #3a5a40 #588157 #a3b18a #dad7cd"],
      ["Autumn", "#5f0f40 #9a031e #e36414 #fb8b24 #f9c74f"],
      ["Spring", "#f9f7d9 #c5e99b #8fbc5c #5e9c3a"],
      ["Earth", "#3e2723 #6d4c41 #a1887f #d7ccc8"],
      ["Sakura", "#fff0f3 #ffccd5 #ff8fa3 #c9184a"],
      ["Lavender Field", "#e7c6ff #c8b6ff #9381ff #4a3f8c #2b3a1e"],
      ["Citrus", "#fdffb6 #fdd85d #fdc500 #9bc53d #5bba6f"]
    ] },
    { id: "duotone", name: "Duotone", list: [
      ["Blue Orange", "#0d47a1 #ff8f00"],
      ["Purple Lime", "#4a148c #c6ff00"],
      ["Teal Coral", "#006d77 #ff7f6e"],
      ["Navy Gold", "#0b1d51 #f2c14e"],
      ["Pink Mint", "#ff4d8d #6bffb8"],
      ["Black Red", "#0a0a0a #e10600"],
      ["Indigo Peach", "#2e1065 #ffb38a"],
      ["Green Yellow", "#004d40 #ffee58"]
    ] },
    { id: "mono", name: "Mono", list: [
      ["Black to White", "#000000 #ffffff"],
      ["White to Black", "#ffffff #000000"],
      ["Charcoal", "#1c1c1c #3a3a3a #6b6b6b"],
      ["Soft Gray", "#f5f5f5 #d6d6d6 #a8a8a8"],
      ["Vignette", "#ffffff #ffffff@45 #000000"],
      ["Fog", "#ffffff #e9ecef #ced4da #868e96"],
      ["Ink", "#000000 #1a1a1a@60 #4d4d4d"],
      ["Spotlight", "#ffffff #9e9e9e@30 #212121@70 #000000"]
    ] }
  ];

  // "#ff0000 #00ff00@40 #0000ff" -> [{ p: 0, c: "#ff0000" }, ...]
  function parseStops(text) {
    var parts = String(text).trim().split(/\s+/);
    var stops = parts.map(function (s, i) {
      var m = /^(#[0-9a-fA-F]{6})(?:@(\d+(?:\.\d+)?))?$/.exec(s);
      return { c: m ? m[1].toLowerCase() : "#000000", p: m && m[2] !== undefined ? Number(m[2]) / 100 : (parts.length > 1 ? i / (parts.length - 1) : 0) };
    });
    return stops;
  }

  var list = [];
  var byId = {};
  GROUPS.forEach(function (g) {
    g.items = g.list.map(function (row, i) {
      var item = { id: g.id + "-" + i, name: row[0], group: g.id, stops: parseStops(row[1]) };
      list.push(item);
      byId[item.id] = item;
      return item;
    });
  });

  window.MFGradientsCatalog = { groups: GROUPS, list: list, byId: byId, parseStops: parseStops };
}());
