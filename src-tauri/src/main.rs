// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    nvidia_workaround();
    timeblock_lib::run()
}

/// WebKitGTK's DMA-BUF renderer fails on the proprietary NVIDIA driver
/// ("Failed to create GBM buffer", blank window). Disable it only when the
/// NVIDIA kernel module is loaded and the user hasn't set the variable.
#[cfg(target_os = "linux")]
fn nvidia_workaround() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VAR).is_none() && std::path::Path::new("/sys/module/nvidia").exists() {
        // SAFETY: called at the top of main, before any other threads exist.
        unsafe { std::env::set_var(VAR, "1") };
    }
}
