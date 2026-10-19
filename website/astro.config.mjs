import { defineConfig } from "astro/config";

// Deployment path is not decided yet (see the website plan's open questions: custom
// domain vs. staying under 9shrey.github.io/timeblock, and whether this site takes over
// the repo's GitHub Pages root or lives alongside the existing app demo). Defaults to
// root; override with SITE_BASE at build time once that's settled.
export default defineConfig({
  site: "https://9shrey.github.io",
  base: process.env.SITE_BASE ?? "/timeblock-site",
});
