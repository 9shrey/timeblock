/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import process from "node:process";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// GitHub Pages serves the site from /<repo>/, so the Pages workflow builds with
// GITHUB_PAGES=1 to get paths right. The Tauri build keeps the default root base.
export default defineConfig(() => ({
  base: process.env.GITHUB_PAGES ? "/timeblock/" : "/",
  plugins: [react(), tailwindcss()],
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
