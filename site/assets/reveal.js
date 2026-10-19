// Fades in .reveal / .reveal-stagger elements as they enter the viewport.
(function () {
  "use strict";

  var targets = document.querySelectorAll(".reveal, .reveal-stagger");
  if (!targets.length) return;

  if (!window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targets.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  targets.forEach(function (el) { observer.observe(el); });
})();
