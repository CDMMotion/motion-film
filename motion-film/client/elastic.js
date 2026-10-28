/*
 * Mótion Film -- Tools › 04 / ELASTIC: Position / Scale / Rotation /
 * Select, straight from the panel (host/elastic.jsx, loaded with
 * $.evalFile). The same four are in the Wheel (wheel-runner.js), whose
 * shortcut and settings this section shows / opens.
 */
(function () {
  "use strict";

  var hostLoaded = false;

  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }
  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }

  function callHost(name, arg, callback) {
    function run() {
      window.__adobe_cep__.evalScript(name + "(" + JSON.stringify(arg) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (hostLoaded) { run(); return; }
    var path = extensionDir() + "/host/elastic.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof mfElastic", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Elastic script in After Effects." }); }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-elastic]"), function (b) {
    b.addEventListener("click", function () {
      if (!window.__adobe_cep__) { return; }
      b.disabled = true;
      callHost("mfElastic", b.getAttribute("data-elastic"), function (res) {
        b.disabled = false;
        status(res.ok ? res.message + "." : res.error, res.ok ? "success" : "error");
      });
    });
  });
}());
