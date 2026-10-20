/*
 * Mótion Film -- Scale Comp (aba Tools, caixa "03 / SCALE COMP").
 *
 * A janela do script nativo do AE "File > Scripts > Scale Composition.jsx"
 * dentro do painel, com o mesmo comportamento: escolhe Scale Factor, Comp
 * Width ou Comp Height; trocar a opção mostra o valor equivalente; um
 * valor que deixaria a comp fora de 1..30000 px é recusado e volta ao
 * anterior; Scale aplica e volta o fator pra 1. O trabalho em si é o
 * scaleActiveComp do host.jsx (mesmos passos do script).
 */
(function () {
  "use strict";

  var factor = 1.0;
  var mode = "scale";
  var comp = null; // { name, width, height } da comp ativa

  function $(id) { return document.getElementById(id); }

  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") {
      window.MF.setStatus(message, type);
    }
  }

  function call(name, args, callback) {
    if (!window.__adobe_cep__) {
      callback({ ok: false, error: "This panel must run inside After Effects." });
      return;
    }
    var parts = [];
    for (var i = 0; i < args.length; i += 1) { parts.push(JSON.stringify(args[i])); }
    window.__adobe_cep__.evalScript(name + "(" + parts.join(",") + ")", function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
      callback(res);
    });
  }

  function formatFactor(f) {
    var s = String(Math.round(f * 100000) / 100000);
    return s.indexOf(".") === -1 ? s + ".0" : s;
  }

  // Texto do campo pra opção atual (igual aos botões do script).
  function valueForMode() {
    if (mode === "scale" || !comp) { return formatFactor(factor); }
    return String(Math.floor((mode === "width" ? comp.width : comp.height) * factor));
  }

  function factorFromText(text) {
    var value = Number(String(text).replace(",", "."));
    if (String(text).replace(/\s/g, "") === "" || isNaN(value)) { return { error: text + " is not a number. Please enter a number." }; }
    var f = mode === "scale" ? value : value / (mode === "width" ? comp.width : comp.height);
    var w = Math.floor(comp.width * f);
    var h = Math.floor(comp.height * f);
    if (!(f > 0) || w < 1 || w > 30000 || h < 1 || h > 30000) {
      return { error: "Value will make height or width out of range 1 to 30000." };
    }
    return { factor: f, w: w, h: h };
  }

  function updatePreview() {
    var out = $("sc-result");
    if (!comp) { out.textContent = ""; out.classList.remove("is-error"); return; }
    var r = factorFromText($("sc-value").value);
    if (r.error) {
      out.textContent = "out of range";
      out.classList.add("is-error");
      return;
    }
    out.classList.remove("is-error");
    out.textContent = "→ " + r.w + " × " + r.h + (mode === "scale" ? "" : "  (" + formatFactor(r.factor) + "×)");
  }

  // Confirma o texto digitado (como o onChange do script): válido vira o
  // fator novo; inválido avisa e volta ao valor anterior.
  function commitInput() {
    if (!comp) { return false; }
    var r = factorFromText($("sc-value").value);
    if (r.error) {
      status(r.error + " Reverting to previous value.", "error");
      $("sc-value").value = valueForMode();
      updatePreview();
      return false;
    }
    factor = r.factor;
    return true;
  }

  function renderComp() {
    $("sc-comp-name").textContent = comp ? comp.name : "Open a composition";
    $("sc-comp-size").textContent = comp ? comp.width + " × " + comp.height : "";
    $("sc-apply").disabled = !comp;
    updatePreview();
  }

  function refresh() {
    var page = $("page-effects");
    if (!page || page.hidden) { return; }
    call("scaleCompInfo", [], function (res) {
      if (!res || !res.ok) { return; }
      var changed = !comp || !res.comp || comp.name !== res.comp || comp.width !== res.width || comp.height !== res.height;
      comp = res.comp ? { name: res.comp, width: res.width, height: res.height } : null;
      if (changed && document.activeElement !== $("sc-value")) {
        $("sc-value").value = valueForMode();
      }
      renderComp();
    });
  }

  function setMode(next) {
    if (comp) { commitInput(); }
    mode = next;
    var opts = document.querySelectorAll("#sc-mode .segmented-option");
    for (var i = 0; i < opts.length; i += 1) {
      opts[i].classList.toggle("is-active", opts[i].getAttribute("data-value") === mode);
    }
    $("sc-value").value = valueForMode();
    updatePreview();
  }

  function apply() {
    if (!comp) {
      status("Please select or open a composition first.", "error");
      return;
    }
    if (!commitInput()) { return; }
    var button = $("sc-apply");
    button.disabled = true;
    call("scaleActiveComp", [factor], function (res) {
      button.disabled = false;
      if (!res.ok) {
        status(res.error, "error");
        refresh();
        return;
      }
      status("Scaled “" + res.comp + "” " + res.from[0] + " × " + res.from[1] + " → " + res.width + " × " + res.height + ".", "success");
      // Volta o fator pra 1 pro próximo uso, como o script.
      factor = 1.0;
      comp = { name: res.comp, width: res.width, height: res.height };
      $("sc-value").value = valueForMode();
      renderComp();
    });
  }

  function init() {
    if (!$("sc-value")) { return; }
    var opts = document.querySelectorAll("#sc-mode .segmented-option");
    for (var i = 0; i < opts.length; i += 1) {
      opts[i].addEventListener("click", function () { setMode(this.getAttribute("data-value")); });
    }
    var input = $("sc-value");
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", commitInput);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { apply(); }
    });
    $("sc-apply").addEventListener("click", apply);

    var page = $("page-effects");
    if (page && window.MutationObserver) {
      new MutationObserver(function () { if (!page.hidden) { refresh(); } })
        .observe(page, { attributes: true, attributeFilter: ["hidden"] });
    }
    var last = 0;
    function ping() {
      var now = Date.now();
      if (now - last < 400) { return; }
      last = now;
      refresh();
    }
    window.addEventListener("focus", ping);
    document.addEventListener("mouseenter", ping);
    var section = document.querySelector('[data-section-id="scale-comp"]');
    if (section) { section.addEventListener("pointerenter", ping); }
    renderComp();
    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);
}());
