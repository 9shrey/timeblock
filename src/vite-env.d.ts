/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_DEV_SEED?: string;
  readonly VITE_E2E?: string;
  /** "1" in the public in-browser demo build (GitHub Pages). */
  readonly VITE_DEMO?: string;
}
