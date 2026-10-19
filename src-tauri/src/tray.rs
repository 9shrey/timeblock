//! Tray icon: today's next block (a disabled label, kept current by the frontend),
//! Start timer and Confirm rest of day (emitted as events the frontend acts on, since
//! the running-block/confirm logic lives in the TS domain layer), Show/Hide and Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

/// Tauri events the frontend subscribes to from `src/platform/tauri.ts`.
pub const EVENT_START_TIMER: &str = "tray://start-timer";
pub const EVENT_CONFIRM_REST_OF_DAY: &str = "tray://confirm-rest-of-day";

/// Kept in app state (rather than re-fetched from the tray's menu, which `TrayIcon`
/// doesn't expose a getter for) so `set_next_block_label` can update it later.
struct NextBlockMenuItem(MenuItem<Wry>);

fn no_block_label() -> String {
    "No upcoming block today".into()
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let next_block = MenuItem::with_id(app, "next-block", no_block_label(), false, None::<&str>)?;
    app.manage(NextBlockMenuItem(next_block.clone()));
    let start_timer = MenuItem::with_id(app, "start-timer", "Start timer", true, None::<&str>)?;
    let confirm_rest = MenuItem::with_id(
        app,
        "confirm-rest-of-day",
        "Confirm rest of day",
        true,
        None::<&str>,
    )?;
    let show_hide = MenuItem::with_id(app, "show-hide", "Show/Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &next_block,
            &PredefinedMenuItem::separator(app)?,
            &start_timer,
            &confirm_rest,
            &PredefinedMenuItem::separator(app)?,
            &show_hide,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Timeblock");
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "start-timer" => {
                let _ = app.emit(EVENT_START_TIMER, ());
            }
            "confirm-rest-of-day" => {
                let _ = app.emit(EVENT_CONFIRM_REST_OF_DAY, ());
            }
            "show-hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(true);
                    if visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Updates the "next block" label. `None` resets it to the no-upcoming-block placeholder.
pub fn set_next_block_label(app: &AppHandle, title: Option<&str>) -> Result<(), String> {
    let item = app.state::<NextBlockMenuItem>();
    let label = match title {
        Some(t) if !t.is_empty() => format!("Next: {t}"),
        _ => no_block_label(),
    };
    item.0.set_text(label).map_err(|e| e.to_string())
}
