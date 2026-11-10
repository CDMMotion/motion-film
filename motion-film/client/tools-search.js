/*
 * Mótion Film -- the search bar on top of the Tools tab.
 *
 * Finds a tool by its number ("6", "06") or by name: the words of its
 * kicker ("06 / GRID") plus the section's data-tool-keys (other names it
 * goes by, in English and Portuguese). Every word typed must match;
 * case and accents don't matter. Sections that don't match hide; the
 * ones that do open even if they were folded, and fold back as they
 * were once the search is cleared. Enter scrolls to the first match,
 * Esc clears.
 */
(function () {
  "use strict";

  var input = document.getElementById("tools-search");
  if (!input) { return; }
  var clear = document.getElementById("tools-search-clear");
  var empty = document.getElementById("tools-search-empty");
  var page = document.getElementById("page-effects");
  var sections = Array.prototype.slice.call(page.querySelectorAll("main > .section[data-section-id]"));

  function plain(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  var tools = sections.map(function (section) {
    var kicker = section.querySelector(".section-kicker");
    var text = kicker ? kicker.textContent : "";
    var num = /^\s*(\d+)/.exec(text);
    return {
      section: section,
      number: num ? parseInt(num[1], 10) : null,
      words: plain(text.replace(/^\s*\d+\s*\/\s*/, "") + " " + (section.getAttribute("data-tool-keys") || ""))
    };
  });

  function matches(tool, q) {
    var parts = q.split(/\s+/).filter(Boolean);
    return parts.every(function (part) {
      if (/^\d+$/.test(part)) { return tool.number === parseInt(part, 10); }
      return tool.words.indexOf(part) >= 0;
    });
  }

  // a folded section opens for the search without touching its saved state
  function open(section) {
    if (!section.classList.contains("is-collapsed")) { return; }
    section.classList.add("no-transition", "is-search-open");
    section.classList.remove("is-collapsed");
    var body = section.querySelector(".section-body");
    if (body) { body.style.maxHeight = "none"; }
    void section.offsetHeight;
    section.classList.remove("no-transition");
  }
  function restore(section) {
    if (!section.classList.contains("is-search-open")) { return; }
    section.classList.add("no-transition");
    section.classList.remove("is-search-open");
    section.classList.add("is-collapsed");
    var body = section.querySelector(".section-body");
    if (body) { body.style.maxHeight = "0px"; }
    void section.offsetHeight;
    section.classList.remove("no-transition");
  }

  var hits = [];
  function run() {
    var q = plain(input.value).trim();
    clear.hidden = !q;
    hits = [];
    tools.forEach(function (tool) {
      var hit = !q || matches(tool, q);
      tool.section.style.display = hit ? "" : "none";
      tool.section.classList.toggle("is-search-hit", !!q && hit);
      if (q && hit) { open(tool.section); hits.push(tool.section); } else { restore(tool.section); }
    });
    empty.hidden = !q || hits.length > 0;
  }

  input.addEventListener("input", run);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && hits.length) {
      e.preventDefault();
      hits[0].scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = "";
      run();
    }
  });
  clear.addEventListener("click", function () {
    input.value = "";
    run();
    input.focus();
  });
}());
