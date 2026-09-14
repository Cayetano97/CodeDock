//! CodeDock: menu-bar-only icon listing your
//! project folders and opening the chosen one in your terminal with opencode.
//!
//! macOS only in this first version. Opening depends on the chosen terminal
//! (see `terminal`): AppleScript for Ghostty / Terminal.app / iTerm2, URI
//! scheme for Warp and each tool CLI for Alacritty / Kitty / WezTerm.

mod commands;
mod config;
mod i18n;
mod projects;
mod terminal;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri_plugin_autostart::ManagerExt;

use projects::Project;

/// Shared state for the commands.
pub struct AppState {
    pub config: Mutex<config::Config>,
    pub config_path: PathBuf,
    /// Last list shown in the tray menu (to resolve clicks).
    pub last_projects: Mutex<Vec<Project>>,
    /// True when this process was started by the OS at login (LaunchAgent
    /// `--autostart`). The frontend reads it to suppress the update check
    /// until the first manual show.
    pub autostart_launch: bool,
}

/// Max projects in the menu-bar menu. The window has no limit; the menu is
/// capped so it stays usable.
const MAX_TRAY_PROJECTS: usize = 15;

/// Mid-tone accents for tray color dots, matching the frontend dark
/// `BASE_PALETTE` accents in `src/lib/model.ts` (same slot order). The tones
/// stay legible on light, dark, and highlighted-blue menu rows, so the dots
/// are never set as template images (they must keep their color).
const TRAY_DOT_ACCENTS: [(u8, u8, u8); 8] = [
    (0x7a, 0xa9, 0xff),
    (0x6f, 0xd3, 0xc6),
    (0x8b, 0xd4, 0x9b),
    (0xe8, 0xc3, 0x7e),
    (0xeb, 0xa0, 0x6a),
    (0xec, 0x93, 0xb8),
    (0xb3, 0xa1, 0xff),
    (0x82, 0xc2, 0xea),
];

/// Tray dot icon size in pixels. macOS renders menu images at 18pt, so 36px
/// is a sharp @2x asset on Retina displays with padding around the dot.
const TRAY_DOT_SIZE: u32 = 36;

/// Stable palette index for a base folder (FNV-1a over UTF-16 code units).
/// Mirrors `baseColorIndex()` in `src/lib/model.ts`: the same base always
/// maps to the same slot, so tray dots match the window colors without
/// passing hex values from the frontend.
fn base_color_index(base: &str) -> usize {
    let mut hash: u32 = 2166136261;
    for unit in base.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16777619);
    }
    (hash as usize) % TRAY_DOT_ACCENTS.len()
}

/// Builds the RGBA buffer for one tray dot: a solid anti-aliased circle
/// centered on a transparent background. Fully opaque core with a short
/// feathered edge keeps the dot crisp on Retina and readable over the
/// blue selection highlight.
fn tray_dot_rgba(accent: (u8, u8, u8)) -> Vec<u8> {
    let size = TRAY_DOT_SIZE as usize;
    let center = TRAY_DOT_SIZE as f32 / 2.0 - 0.5;
    // ~11px radius at 36px: a ~5.5pt dot with generous transparent padding.
    let radius = TRAY_DOT_SIZE as f32 * 0.305;
    let feather = 1.5;
    let mut out = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let d = (dx * dx + dy * dy).sqrt();
            let coverage =
                1.0 - ((d - (radius - feather)) / (2.0 * feather)).clamp(0.0, 1.0);
            let alpha = (coverage * 255.0).round() as u8;
            out.extend_from_slice(&[accent.0, accent.1, accent.2, alpha]);
        }
    }
    out
}

/// Generates the 8 cached dot `Image`s (one per palette slot) for a menu
/// rebuild. Runtime generation avoids binary bloat from PNG assets.
fn tray_dot_images() -> Vec<Image<'static>> {
    TRAY_DOT_ACCENTS
        .iter()
        .map(|&accent| Image::new_owned(tray_dot_rgba(accent), TRAY_DOT_SIZE, TRAY_DOT_SIZE))
        .collect()
}

/// macOS: LaunchAgent plist (`~/Library/LaunchAgents`) instead of an
/// AppleScript login item. The plist passes CLI args through
/// `ProgramArguments`, so a login launch carries `--autostart` and `setup()`
/// can keep the window hidden. AppleScript login items only honor
/// `--hidden`/`--minimized` and pass no custom args, which made login
/// launches indistinguishable from manual ones.
#[cfg(target_os = "macos")]
fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new()
        .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
        .args(["--autostart"])
        .build()
}

#[cfg(not(target_os = "macos"))]
fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new().build()
}

/// CLI markers identifying a login/autostart launch. `--autostart` is what the
/// LaunchAgent plist passes; `--minimized`/`--hidden` are accepted as aliases
/// for robustness (older entries, manual testing).
fn is_autostart_arg(arg: &str) -> bool {
    matches!(arg, "--autostart" | "--minimized" | "--hidden")
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        // Never maximized: a maximized state discards the centered rect on
        // macOS, so restore a stale one before centering.
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        }
        let _ = win.center();
        let _ = win.set_focus();
    }
}

/// Removes a legacy AppleScript login item left by versions that used
/// `MacosLauncher::AppleScript`, so enabling autostart never yields duplicate
/// entries. The old item is named after the `.app` bundle (`CodeDock`); the
/// LaunchAgent plist uses the package name instead. When the legacy item is
/// found and no LaunchAgent entry exists yet, the LaunchAgent entry is
/// enabled first to preserve the user's choice. Best-effort: failures are
/// ignored.
#[cfg(target_os = "macos")]
fn migrate_legacy_applescript_login_item(app: &AppHandle) {
    const LEGACY_NAME: &str = "CodeDock";
    let has_legacy = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get the name of every login item",
        ])
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                String::from_utf8(out.stdout).ok()
            } else {
                None
            }
        })
        .map(|names| names.split(',').any(|name| name.trim() == LEGACY_NAME))
        .unwrap_or(false);
    if !has_legacy {
        return;
    }
    if let Ok(enabled) = app.autolaunch().is_enabled() {
        if !enabled {
            let _ = app.autolaunch().enable();
        }
    }
    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!("tell application \"System Events\" to delete login item \"{LEGACY_NAME}\""),
        ])
        .output();
}

/// Rebuilds the tray menu with the current projects, ordered by the stored
/// `sortMode` to match the window, and labeled in the stored language.
pub(crate) fn refresh_tray(app: &AppHandle) {
    let (base_dirs, sort_mode, language) = {
        let state = app.state::<AppState>();
        let config = state.config.lock().unwrap();
        (
            config.base_dirs.clone(),
            config.sort_mode.clone(),
            config.language.clone(),
        )
    };
    let mut found = projects::list_projects(&base_dirs, &language);
    projects::sort_projects(&mut found, &sort_mode);
    {
        let state = app.state::<AppState>();
        *state.last_projects.lock().unwrap() = found.clone();
    }

    let tray = app.tray_by_id("codedock-tray");
    let Some(tray) = tray else { return };

    let build = || -> tauri::Result<()> {
        let show = MenuItem::with_id(app, "show", i18n::tray_show(&language), true, None::<&str>)?;
        let reload = MenuItem::with_id(app, "reload", i18n::tray_reload(&language), true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", i18n::tray_quit(&language), true, None::<&str>)?;
        let menu = Menu::new(app)?;
        menu.append(&show)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        if found.is_empty() {
            let empty = MenuItem::with_id(
                app,
                "empty",
                i18n::tray_empty(&language),
                false,
                None::<&str>,
            )?;
            menu.append(&empty)?;
        } else {
            // One cached dot per palette slot; rows share the image matching
            // their base folder so the tray mirrors the window colors.
            let dots = tray_dot_images();
            for (i, p) in found.iter().take(MAX_TRAY_PROJECTS).enumerate() {
                let item = IconMenuItem::with_id(
                    app,
                    format!("open-{i}"),
                    p.name.clone(),
                    true,
                    Some(dots[base_color_index(&p.base)].clone()),
                    None::<&str>,
                )?;
                menu.append(&item)?;
            }
            if found.len() > MAX_TRAY_PROJECTS {
                let more = MenuItem::with_id(
                    app,
                    "more",
                    i18n::tray_more(&language, found.len() - MAX_TRAY_PROJECTS),
                    false,
                    None::<&str>,
                )?;
                menu.append(&more)?;
            }
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&reload)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&quit)?;
        tray.set_menu(Some(menu))?;
        Ok(())
    };

    if let Err(e) = build() {
        eprintln!("{}", i18n::err_tray_build(&language, &e.to_string()));
    }
}

fn open_from_tray(app: &AppHandle, index: usize) {
    let (path, opencode, terminal, language) = {
        let state = app.state::<AppState>();
        let found = state.last_projects.lock().unwrap();
        let Some(p) = found.get(index).cloned() else {
            return;
        };
        let config = state.config.lock().unwrap();
        (
            p.path,
            config.opencode_bin.clone(),
            config.terminal.clone(),
            config.language.clone(),
        )
    };
    if let Err(e) = projects::open_project(&path, opencode.as_deref(), Some(terminal.as_str()), &language)
    {
        eprintln!("[codedock] open_project: {e}");
        let _ = app.emit("open-error", e);
        show_main(app);
    }
}

fn reload_from_tray(app: &AppHandle) {
    let found = {
        let state = app.state::<AppState>();
        let config = state.config.lock().unwrap();
        let mut found = projects::list_projects(&config.base_dirs, &config.language);
        projects::sort_projects(&mut found, &config.sort_mode);
        found
    };
    {
        let state = app.state::<AppState>();
        *state.last_projects.lock().unwrap() = found.clone();
    }
    refresh_tray(app);
    let _ = app.emit("projects-changed", found);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // Initial menu before the first scan; refresh_tray() right after setup
    // replaces it with the project list in the stored language.
    let language = {
        let state = app.state::<AppState>();
        let guard = state.config.lock().unwrap();
        guard.language.clone()
    };
    let show = MenuItem::with_id(app, "show", i18n::tray_show(&language), true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", i18n::tray_reload(&language), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", i18n::tray_quit(&language), true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("codedock-tray")
        .tooltip("CodeDock")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(n) = id.strip_prefix("open-") {
                if let Ok(i) = n.parse::<usize>() {
                    open_from_tray(app, i);
                    return;
                }
            }
            match id {
                "show" => show_main(app),
                "reload" => reload_from_tray(app),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch carrying the autostart marker is a login launch
            // racing the running instance: stay in the tray, do not steal focus.
            if args.iter().any(|a| is_autostart_arg(a)) {
                return;
            }
            show_main(app);
        }))
        .plugin(autostart_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Always menu-bar only: no Dock icon, no Cmd+Tab entry.
            // In the installed .app this is covered by `LSUIElement`
            // (Info.plist); this policy covers `tauri dev`, which runs
            // without Info.plist.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let config_path = config_dir.join("codedock.config.json");
            let config = config::load_from(&config_path);
            let autostart_launch = std::env::args().skip(1).any(|a| is_autostart_arg(&a));
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                last_projects: Mutex::new(Vec::new()),
                autostart_launch,
            });

            // Tray first: the app is never left without a visible entry point,
            // including login launches where the window stays hidden.
            build_tray(app.handle())?;
            refresh_tray(app.handle());

            #[cfg(target_os = "macos")]
            migrate_legacy_applescript_login_item(app.handle());

            if autostart_launch {
                // Login launch: tray only. No show, no center, no focus steal.
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            } else {
                // Manual launch: normal windowed, centered, focused.
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to the tray; it does not quit the app.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::was_autostart_launch,
            commands::list_projects,
            commands::list_terminals,
            commands::save_config,
            commands::open_project,
            commands::refresh,
            commands::quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_color_index_matches_frontend_palette() {
        // Expected slots computed with `baseColorIndex()` in src/lib/model.ts.
        assert_eq!(base_color_index("/Users/you/Programs"), 6);
        assert_eq!(base_color_index("/a"), 5);
        assert_eq!(base_color_index("/b"), 4);
        assert_eq!(base_color_index("Programs"), 0);
        assert_eq!(base_color_index("/Users/cayetano/Documents/Programs"), 4);
        // Same base is stable; palette has 8 slots.
        assert_eq!(base_color_index("/a"), base_color_index("/a"));
        assert!(base_color_index("anything") < TRAY_DOT_ACCENTS.len());
    }

    #[test]
    fn tray_dot_rgba_is_padded_transparent_with_opaque_core() {
        let rgba = tray_dot_rgba((0x7a, 0xa9, 0xff));
        let size = TRAY_DOT_SIZE as usize;
        assert_eq!(rgba.len(), size * size * 4);
        // Corners stay fully transparent (padding around the dot).
        assert_eq!(rgba[3], 0);
        // Center pixel is the opaque accent color.
        let cx = size / 2;
        let off = (cx * size + cx) * 4;
        assert_eq!(&rgba[off..off + 4], &[0x7a, 0xa9, 0xff, 0xff]);
    }
}
