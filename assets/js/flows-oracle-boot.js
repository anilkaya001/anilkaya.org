(function () {
  "use strict";
  addEventListener("load", function () {
    var U = window.FlowsUI;
    if (U && typeof U.defer === "function" && document.getElementById("fxOracle")) U.defer("oracle");
  }, { once: true });
}());
