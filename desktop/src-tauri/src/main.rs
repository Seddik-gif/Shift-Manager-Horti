// Horti Magici – Windows desktop shell for the admins.
//
// It is deliberately thin: a native window that opens the hosted web app, a tray icon, start-with-Windows,
// a single-instance lock, and a "back up now" button. All scheduling logic stays in the web app, so the
// installed program almost never needs updating. The hosted page gets NO access to this shell (see capabilities/).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod config;

use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const KEYRING_SERVICE: &str = "it.hortimagici.desktop";
const KEYRING_USER: &str = "database-url";
/// Lets the web app recognise the desktop shell (it shows non-admins a "use the phone app" notice).
const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0 HortiDesktop/",
    env!("CARGO_PKG_VERSION")
);

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("config.json"))
}

fn default_backup_dir(app: &AppHandle) -> PathBuf {
    app.path().document_dir().unwrap_or_else(|_| std::env::temp_dir()).join("HortiMagici").join("backups")
}

fn secret_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn has_secret() -> bool {
    secret_entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

#[derive(Serialize)]
struct ConfigView {
    app_url: String,
    backup_dir: String,
    default_backup_dir: String,
    keep: usize,
    tools_dir: String,
    has_db_secret: bool,
    autostart: bool,
}

#[tauri::command]
fn get_config(app: AppHandle) -> Result<ConfigView, String> {
    let cfg = config::load(&config_path(&app)?);
    Ok(ConfigView {
        app_url: cfg.app_url,
        backup_dir: cfg.backup_dir,
        default_backup_dir: default_backup_dir(&app).to_string_lossy().to_string(),
        keep: cfg.keep,
        tools_dir: cfg.tools_dir,
        has_db_secret: has_secret(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
    })
}

#[tauri::command]
fn save_config(app: AppHandle, app_url: String, backup_dir: String, keep: usize, tools_dir: String) -> Result<(), String> {
    let cfg = config::Config {
        app_url: if app_url.trim().is_empty() { String::new() } else { config::validate_app_url(&app_url)? },
        backup_dir: backup_dir.trim().to_string(),
        keep: config::validate_keep(keep)?,
        tools_dir: tools_dir.trim().to_string(),
    };
    config::save(&config_path(&app)?, &cfg)
}

/// Is the server reachable? A plain TCP connection to its port: no HTTP client needed, and no data is sent.
#[tauri::command]
async fn reachable(url: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(u) = url::Url::parse(&url) else { return false };
        let (Some(host), Some(port)) = (u.host_str().map(str::to_string), u.port_or_known_default()) else { return false };
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|mut addrs| addrs.any(|a| TcpStream::connect_timeout(&a, Duration::from_secs(4)).is_ok()))
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Saves the database address in the Windows Credential Manager. It is never written to config.json and is
/// never sent back to the page; the page only learns whether one exists.
#[tauri::command]
fn set_db_secret(secret: String) -> Result<(), String> {
    backup::split_url(secret.trim())?; // validates the shape (postgresql://…)
    secret_entry()?.set_password(secret.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_db_secret() -> Result<(), String> {
    match secret_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn run_backup(app: AppHandle) -> Result<backup::BackupResult, String> {
    let cfg = config::load(&config_path(&app)?);
    let secret = secret_entry()?.get_password().map_err(|_| "No database address is saved yet. Add it first.".to_string())?;
    let dir = if cfg.backup_dir.is_empty() { default_backup_dir(&app) } else { PathBuf::from(&cfg.backup_dir) };
    let tools = cfg.tools_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        backup::run_backup(&secret, &dir, cfg.keep, if tools.is_empty() { None } else { Some(tools.as_str()) })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show(&app, "settings");
}

/// After the address changed: send the main window back to the loading page, which reconnects to the new address.
#[tauri::command]
fn reload_main(app: AppHandle) -> Result<(), String> {
    let settings = app.get_webview_window("settings").ok_or("settings window missing")?;
    let mut url = settings.url().map_err(|e| e.to_string())?;
    url.set_path("/index.html");
    app.get_webview_window("main").ok_or("main window missing")?.navigate(url).map_err(|e| e.to_string())
}

fn show(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    let minimized = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        // a second launch just brings the running window forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app, "main")))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .invoke_handler(tauri::generate_handler![
            get_config, save_config, reachable, set_db_secret, clear_db_secret, run_backup, set_autostart, open_settings, reload_main
        ])
        // closing a window hides it: the tray keeps the program (and its backup button) available
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Horti Magici")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .user_agent(USER_AGENT)
                .visible(!minimized)
                .build()?;
            WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
                .title("Horti Magici – Impostazioni")
                .inner_size(580.0, 800.0)
                .visible(false)
                .build()?;

            let open = MenuItem::with_id(app, "open", "Apri Horti Magici", true, None::<&str>)?;
            let backup_now = MenuItem::with_id(app, "backup", "Esegui backup ora", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Impostazioni…", true, None::<&str>)?;
            let autostart = CheckMenuItem::with_id(app, "autostart", "Avvia con Windows", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &backup_now, &settings, &autostart, &PredefinedMenuItem::separator(app)?, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Horti Magici")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show(app, "main"),
                    "settings" => show(app, "settings"),
                    "backup" => {
                        show(app, "settings");
                        let _ = app.emit_to("settings", "run-backup", ());
                    }
                    "autostart" => {
                        let on = app.autolaunch().is_enabled().unwrap_or(false);
                        let _ = if on { app.autolaunch().disable() } else { app.autolaunch().enable() };
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle(), "main");
                    }
                });
            if let Some(icon) = handle.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Horti Magici could not start");
}
