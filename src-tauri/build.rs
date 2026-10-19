fn main() {
    // `npm run e2e:build` sets VITE_E2E=1; lib.rs reads it with option_env!.
    println!("cargo:rerun-if-env-changed=VITE_E2E");
    tauri_build::build()
}
