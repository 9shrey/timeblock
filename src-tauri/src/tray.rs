//! Tray icon: Today's next block, Start timer, Confirm rest of day, Show/Hide, Quit.
//! The menu text for "next block" is domain logic (what's the next unskipped plan block?),
//! which lives in the webview; the Rust side just holds the menu item and lets the frontend
//! update its text. Start timer / Confirm rest of day need the same domain logic, so clicking
//! them emits an event the webview acts on, rather than doing anything here.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub struct TrayState {
    pub close_to_tray: AtomicBool,
    next_block_item: MenuItem<Wry>,
}

impl TrayState {
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Builds the tray icon and menu, and stores `TrayState` for the commands below. Skipped for
/// e2e builds, same reasoning as single-instance and window-state: a test run shouldn't depend
/// on (or leave behind) a real system tray.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let next_block_item = MenuItem::with_id(
        app,
        "next-block",
        "No upcoming block today",
        false,
        None::<&str>,
    )?;
    let start_timer = MenuItem::with_id(app, "start-timer", "Start timer", true, None::<&str>)?;
    let confirm_rest = MenuItem::with_id(
        app,
        "confirm-rest",
        "Confirm rest of day",
        true,
        None::<&str>,
    )?;
    let show_hide = MenuItem::with_id(app, "show-hide", "Show/Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &next_block_item,
            &sep1,
            &start_timer,
            &confirm_rest,
            &show_hide,
            &sep2,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "start-timer" => {
                let _ = app.emit("tray-action", "startTimer");
            }
            "confirm-rest" => {
                let _ = app.emit("tray-action", "confirmRestOfDay");
            }
            "show-hide" => toggle_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayState {
        close_to_tray: AtomicBool::new(false),
        next_block_item,
    });
    Ok(())
}

#[tauri::command]
pub fn set_tray_next_block(
    state: tauri::State<'_, TrayState>,
    label: Option<String>,
) -> Result<(), String> {
    state
        .next_block_item
        .set_text(label.unwrap_or_else(|| "No upcoming block today".into()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_close_to_tray(state: tauri::State<'_, TrayState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}
