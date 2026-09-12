//! IPC commands exposed to the webview.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config::{self, Config};
use crate::i18n::normalize_language_setting;use crate::projects::{self, Project};
use crate::terminal::{self, TerminalInfo};
use crate::AppState;

/// What the webview receives on boot and after every save.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub base_dirs: Vec<String>,
    pub opencode_bin: Option<String>,
    pub terminal: String,
    pub sort_mode: String,
    pub language: String,
    pub theme: String,
}

impl From<&Config> for ConfigPayload {
    fn from(c: &Config) -> Self {
        ConfigPayload {
            base_dirs: c.base_dirs.clone(),
            opencode_bin: c.opencode_bin.clone(),
            terminal: c.terminal.clone(),
            sort_mode: c.sort_mode.clone(),
            language: c.language.clone(),
            theme: c.theme.clone(),
        }
    }
}

/// Current config.
#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigPayload {
    ConfigPayload::from(&*state.config.lock().unwrap())
}

/// Current projects (hot scan of the base folders), ordered by the stored
/// `sortMode` (`name` or `base`).
#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Vec<Project> {
    let config = state.config.lock().unwrap();
    let mut found = projects::list_projects(&config.base_dirs, &config.language);
    projects::sort_projects(&mut found, &config.sort_mode);
    found
}

/// Saves bases + settings, refreshes the tray menu and notifies the webview.
///
/// Emits `projects-changed` with the freshly scanned list so the window
/// refreshes as soon as a base is added, without a second
/// `invoke("list_projects")` from the frontend (`Emitter::emit` pattern from
/// the current Tauri v2 docs).
#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    base_dirs: Vec<String>,
    opencode_bin: Option<String>,
    terminal: Option<String>,
    sort_mode: Option<String>,
    language: Option<String>,
    theme: Option<String>,
) -> Result<ConfigPayload, String> {
    let config = Config {
        base_dirs: config::sanitize_base_dirs(base_dirs),
        opencode_bin: opencode_bin
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        terminal: terminal::normalize_terminal(terminal.as_deref()),
        sort_mode: config::normalize_sort_mode(sort_mode.as_deref()),
        language: normalize_language_setting(language.as_deref()),
        theme: config::normalize_theme(theme.as_deref()),
    };
    config::save_to(&state.config_path, &config)?;
    {
        let mut current = state.config.lock().unwrap();
        *current = config.clone();
    }
    crate::refresh_tray(&app);
    let mut found = projects::list_projects(&config.base_dirs, &config.language);
    projects::sort_projects(&mut found, &config.sort_mode);
    let _ = app.emit("projects-changed", &found);
    Ok(ConfigPayload::from(&config))
}

/// Opens the project in the configured terminal with opencode inside.
#[tauri::command]
pub fn open_project(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let (opencode, terminal, language) = {
        let config = state.config.lock().unwrap();
        (
            config.opencode_bin.clone(),
            config.terminal.clone(),
            config.language.clone(),
        )
    };
    projects::open_project(&path, opencode.as_deref(), Some(terminal.as_str()), &language)
}

/// Supported terminals and whether they are installed (for the UI picker).
#[tauri::command]
pub fn list_terminals() -> Vec<TerminalInfo> {
    terminal::detect_terminals()
}

/// Rescans, rebuilds the tray menu, notifies the webview and returns the fresh
/// list (ordered by the stored `sortMode`).
#[tauri::command]
pub fn refresh(app: AppHandle, state: State<'_, AppState>) -> Vec<Project> {
    let config = state.config.lock().unwrap();
    let mut found = projects::list_projects(&config.base_dirs, &config.language);
    projects::sort_projects(&mut found, &config.sort_mode);
    drop(config);
    crate::refresh_tray(&app);
    let _ = app.emit("projects-changed", &found);
    found
}

/// Quit from the window.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
