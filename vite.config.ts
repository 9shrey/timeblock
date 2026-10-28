/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import process from "node:process";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

/** The web app build: syncs with an account (VITE_SYNC_URL), served from /timeblock/app/. */
const webApp = !!process.env.VITE_SYNC_URL && process.env.VITE_DEMO !== "1";

/** Links the PWA manifest in the web app build only (desktop and demo don't install). */
const pwaHead: Plugin = {
  name: "timeblock-pwa-head",
  transformIndexHtml: () =>
    webApp
      ? [
          { tag: "link", attrs: { rel: "manifest", href: "manifest.webmanifest" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "icon", href: "app-icon.svg", type: "image/svg+xml" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "apple-touch-icon", href: "icon-192.png" }, injectTo: "head" },
          { tag: "meta", attrs: { name: "theme-color", content: "#ffffff" }, injectTo: "head" },
        ]
      : [],
};

// https://vite.dev/config/
// GitHub Pages serves the site from /<repo>/ and the in-browser demo from /<repo>/demo/,
// so the Pages workflow builds the demo with VITE_DEMO=1 to get paths right. The Tauri
// build keeps the default root base. VITE_BASE overrides (the web app uses /timeblock/app/).
export default defineConfig(() => ({
  base: process.env.VITE_BASE ?? (process.env.VITE_DEMO === "1" ? "/timeblock/demo/" : "/"),
  plugins: [react(), tailwindcss(), pwaHead],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG ? ("oxc" as const) : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
}));
