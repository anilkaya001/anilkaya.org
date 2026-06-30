/* Sets the current year into #y (footer copyright). */
(() => {
  "use strict";
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();
})();
