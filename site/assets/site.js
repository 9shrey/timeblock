// Download page: highlight the visitor's OS and fill in links from the latest GitHub release.
// Without JavaScript, or if the API call fails, every link points at the releases page.
(function () {
  "use strict";

  var REPO = "9shrey/timeblock";

  // Matched in order; the first match decides the label. Updater artifacts (.sig, .tar.gz) are ignored.
  var FORMATS = [
    { os: "linux", test: /\.rpm$/i, fmt: ".rpm", desc: "Fedora, RHEL, openSUSE" },
    { os: "linux", test: /\.deb$/i, fmt: ".deb", desc: "Debian, Ubuntu" },
    { os: "linux", test: /\.AppImage$/i, fmt: ".AppImage", desc: "Any distribution" },
    { os: "mac", test: /\.dmg$/i, fmt: ".dmg", desc: "Disk image" },
    { os: "windows", test: /-setup\.exe$/i, fmt: ".exe", desc: "Installer" },
    { os: "windows", test: /\.msi$/i, fmt: ".msi", desc: "Windows Installer package" },
  ];

  var DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>';

  function detectOS() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "").toLowerCase();
    var ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad/.test(ua)) return "web";
    if (p.indexOf("win") === 0 || ua.indexOf("windows") !== -1) return "windows";
    if (p.indexOf("mac") === 0 || ua.indexOf("mac os") !== -1) return "mac";
    if (p.indexOf("linux") !== -1 || ua.indexOf("linux") !== -1) return "linux";
    return null;
  }

  function formatSize(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return iso.slice(0, 10);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(os) {
    if (!os) return;
    var card = document.querySelector('.platform[data-os="' + os + '"]');
    if (!card) return;
    card.classList.add("is-current");
    card.querySelector(".badge").hidden = false;
    card.parentNode.insertBefore(card, card.parentNode.firstChild);
  }

  function render(release) {
    var byOs = { linux: [], mac: [], windows: [] };
    (release.assets || []).forEach(function (a) {
      for (var i = 0; i < FORMATS.length; i++) {
        if (FORMATS[i].test.test(a.name)) {
          byOs[FORMATS[i].os].push({ f: FORMATS[i], order: i, a: a });
          break;
        }
      }
    });

    Object.keys(byOs).forEach(function (os) {
      var items = byOs[os];
      if (!items.length) return; // keep the fallback links
      items.sort(function (x, y) { return x.order - y.order; });
      var list = document.querySelector('[data-assets="' + os + '"]');
      list.innerHTML = items
        .map(function (it) {
          return (
            '<li><a class="asset" href="' + escapeHtml(it.a.browser_download_url) + '" title="' + escapeHtml(it.a.name) + '">' +
            DOWNLOAD_ICON +
            '<span class="label"><span class="fmt">' + it.f.fmt + "</span>" +
            '<span class="desc">' + it.f.desc + "</span></span>" +
            '<span class="size">' + formatSize(it.a.size) + "</span></a></li>"
          );
        })
        .join("");
    });

    var meta = document.getElementById("release-meta");
    meta.innerHTML =
      "Latest version <strong>" + escapeHtml(release.tag_name) + "</strong>, released " +
      escapeHtml(formatDate(release.published_at)) + ' · <a href="' + escapeHtml(release.html_url) + '">Release notes</a>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    highlight(detectOS());

    if (!window.fetch) return;
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(render)
      .catch(function () {
        // No published release yet, rate-limited, or offline: the static links stay.
      });
  });
})();
