import { isTauri } from "@tauri-apps/api/core";

/**
 * The web app build (VITE_SYNC_URL set, not the demo) is account-only: it shows a sign-in
 * screen until you sign in, and signing out wipes this browser's copy of the data.
 */
export const ACCOUNT_REQUIRED = !!import.meta.env.VITE_SYNC_URL && import.meta.env.VITE_DEMO !== "1" && !isTauri();
