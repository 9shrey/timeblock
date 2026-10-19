import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// No custom domain for now (nothing purchased, and the free *.github.io-via-new-org
// route needs a human to actually create that org). This deploys to the repo's existing
// GitHub Pages project URL, taking over the slot the app demo build previously used.
export default defineConfig({
  site: "https://9shrey.github.io",
  base: "/timeblock",
  integrations: [sitemap()],
});
