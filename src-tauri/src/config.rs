//! CodeDock config: `codedock.config.json` with tolerant parsing.
//!
//! A missing file or invalid JSON falls back to defaults. Individually
//! invalid entries are dropped without breaking the rest, like QuickSpot.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::i18n::{default_language, normalize_language_setting};
use crate::terminal::{default_terminal, normalize_terminal};

/// How projects are ordered in the window and the tray menu:
/// - `"name"`: global alphabetical by project name (historic behavior).
/// - `"base"`: grouped by base folder (alphabetical) then by name.
/// Unknown or missing values fall back to `"name"` to break nothing.
pub fn default_sort_mode() -> String {
    "name".to_string()
}
/// Normalizes the sort mode from config or UI: lowercases, accepts
/// English/Spanish aliases for the by-base view; anything else is `"name"`.
pub fn normalize_sort_mode(raw: Option<&str>) -> String {
    let id = raw.unwrap_or_default().trim().to_lowercase();
    match id.as_str() {
        "base" | "folder" | "folders" | "carpeta" | "carpetas" | "base_folder"
        | "by_base" | "por_carpeta" | "por_carpetas" => "base".to_string(),
        _ => default_sort_mode(),
    }
}

/// Default theme setting: `"auto"` follows the OS color scheme.
pub fn default_theme() -> String {
    "auto".to_string()
}

/// The 8 selectable theme ids (the curated picker list, `auto` excluded).
pub fn theme_ids() -> [&'static str; 8] {
    [
        "codedock-dark",
        "abyss-blue",
        "ember-dusk",
        "kelp-night",
        "orchid-haze",
        "codedock-light",
        "harbor-mist",
        "parchment",
    ]
}

/// Normalizes the theme setting from config or UI: `"auto"` (plus the
/// `system`/`default` aliases and missing/empty values) follows the OS
/// scheme; any of the 8 locked ids is kept; anything else (unknown or
/// legacy values like `"neon-hacker"`) falls back to `"auto"`.
pub fn normalize_theme(raw: Option<&str>) -> String {
    let id = raw.unwrap_or_default().trim().to_lowercase();
    if id.is_empty() || id == "auto" || id == "system" || id == "default" {
        return default_theme();
    }
    if theme_ids().contains(&id.as_str()) {
        return id;
    }
    default_theme()
}

/// Persisted config (camelCase on disk, like QuickSpot).
#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub base_dirs: Vec<String>,
    #[serde(default)]
    pub disabled_projects: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opencode_bin: Option<String>,
    #[serde(default = "default_terminal")]
    pub terminal: String,
    #[serde(default = "default_sort_mode")]
    pub sort_mode: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String,
}

impl Config {
    pub fn with_defaults() -> Self {
        Config {
            base_dirs: default_base_dirs(),
            disabled_projects: Vec::new(),
            opencode_bin: None,
            terminal: default_terminal(),
            sort_mode: default_sort_mode(),
            language: default_language(),
            theme: default_theme(),
        }
    }
}

/// Useful first run: if `~/Documents/Programs` exists it is suggested as a
/// base folder. Otherwise start empty and the UI asks to add one.
fn default_base_dirs() -> Vec<String> {
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join("Documents").join("Programs");
        if candidate.is_dir() {
            return vec![candidate.to_string_lossy().into_owned()];
        }
    }
    Vec::new()
}

/// Normalizes a base folder: trims and drops trailing `/` (except root `/`),
/// so `/a` and `/a/` do not count as different bases.
pub fn normalize_base_dir(dir: &str) -> String {
    let trimmed = dir.trim();
    if trimmed.len() > 1 {
        let stripped = trimmed.trim_end_matches('/');
        if !stripped.is_empty() {
            return stripped.to_string();
        }
    }
    trimmed.to_string()
}

/// Cleans the folder list: trims, drops trailing `/`, removes empty and
/// duplicated entries regardless of arrival order.
pub fn sanitize_base_dirs(dirs: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(dirs.len());
    for d in dirs {
        let normalized = normalize_base_dir(&d);
        if normalized.is_empty() || out.contains(&normalized) {
            continue;
        }
        out.push(normalized);
    }
    out
}

/// Normalizes a project path for the disabled list: trims and drops trailing
/// `/` (except root `/`), so `/a/Demo` and `/a/Demo/` count as the same
/// project. Same rule as `normalize_base_dir`.
pub fn normalize_project_path(path: &str) -> String {
    normalize_base_dir(path)
}

/// Cleans the disabled-project list: trims, drops trailing `/`, removes empty
/// and duplicated entries regardless of arrival order. Stale entries (projects
/// that no longer exist) are kept: they are harmless and avoid re-enabling a
/// temporarily missing folder on the next scan.
pub fn sanitize_disabled_projects(paths: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        let normalized = normalize_project_path(&p);
        if normalized.is_empty() || out.contains(&normalized) {
            continue;
        }
        out.push(normalized);
    }
    out
}

fn sanitize_opencode_bin(value: Option<String>) -> Option<String> {
    match value {
        Some(v) => {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => None,
    }
}

/// Parses the config text. Broken JSON or a non-object shape returns `Err`
/// and the caller falls back to defaults.
pub fn parse_config(text: &str) -> Result<Config, String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let obj = root.as_object().ok_or_else(|| "config must be an object".to_string())?;

    let mut base_dirs = Vec::new();
    if let Some(list) = obj.get("baseDirs").and_then(|v| v.as_array()) {
        for item in list {
            if let Some(s) = item.as_str() {
                if !s.trim().is_empty() {
                    base_dirs.push(s.trim().to_string());
                }
            }
        }
    }
    // Compat: also accept `base_dirs` for hand-edited snake_case files.
    if base_dirs.is_empty() {
        if let Some(list) = obj.get("base_dirs").and_then(|v| v.as_array()) {
            for item in list {
                if let Some(s) = item.as_str() {
                    if !s.trim().is_empty() {
                        base_dirs.push(s.trim().to_string());
                    }
                }
            }
        }
    }

    let opencode_bin = obj
        .get("opencodeBin")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("opencode_bin").and_then(|v| v.as_str()))
        .map(str::to_string);

    // `terminal` is the same in camelCase and snake_case; unknown or missing
    // values fall back to Ghostty so opening never breaks.
    let terminal = normalize_terminal(
        obj.get("terminal")
            .and_then(|v| v.as_str()),
    );

    // `sortMode` / `sort_mode`: "name" (default) or "base" (grouped by
    // folder). Unknown values fall back to "name" for old lists.
    let sort_mode = normalize_sort_mode(
        obj.get("sortMode")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("sort_mode").and_then(|v| v.as_str())),
    );

    // `language`: stored setting `"auto"` (follow the system, the default
    // when the key is missing), `"en"` or `"es"` (manual choice from the
    // window, always kept). Unknown explicit values fall back to `"en"`.
    // Also accepts `locale` as a hand-edited alias.
    let language = normalize_language_setting(
        obj.get("language")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("locale").and_then(|v| v.as_str())),
    );

    // `theme`: stored setting `"auto"` (follow the OS color scheme, the
    // default when the key is missing) or one of the 8 curated ids.
    // Unknown or legacy values fall back to `"auto"`.
    let theme = normalize_theme(obj.get("theme").and_then(|v| v.as_str()));

    // `disabledProjects` / `disabled_projects`: absolute project paths hidden
    // from the window list and the tray menu. Missing -> empty (everything
    // visible, historic behavior); invalid entries are dropped.
    let mut disabled_projects = Vec::new();
    let disabled_raw = obj
        .get("disabledProjects")
        .and_then(|v| v.as_array())
        .or_else(|| obj.get("disabled_projects").and_then(|v| v.as_array()));
    if let Some(list) = disabled_raw {
        for item in list {
            if let Some(s) = item.as_str() {
                if !s.trim().is_empty() {
                    disabled_projects.push(s.trim().to_string());
                }
            }
        }
    }

    Ok(Config {
        base_dirs: sanitize_base_dirs(base_dirs),
        disabled_projects: sanitize_disabled_projects(disabled_projects),
        opencode_bin: sanitize_opencode_bin(opencode_bin),
        terminal,
        sort_mode,
        language,
        theme,
    })
}

/// Reads and parses once. Missing or invalid file -> defaults.
pub fn load_from(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(text) => parse_config(&text).unwrap_or_else(|_| Config::with_defaults()),
        Err(_) => Config::with_defaults(),
    }
}

/// Writes the config as pretty JSON (omits `opencodeBin` when `None`).
pub fn save_to(path: &Path, config: &Config) -> Result<(), String> {
    let clean = Config {
        base_dirs: sanitize_base_dirs(config.base_dirs.clone()),
        disabled_projects: sanitize_disabled_projects(config.disabled_projects.clone()),
        opencode_bin: sanitize_opencode_bin(config.opencode_bin.clone()),
        terminal: normalize_terminal(Some(config.terminal.as_str())),
        sort_mode: normalize_sort_mode(Some(config.sort_mode.as_str())),
        language: normalize_language_setting(Some(config.language.as_str())),
        theme: normalize_theme(Some(config.theme.as_str())),
    };
    let text = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempfile(content: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut path = std::env::temp_dir();
        path.push(format!("codedock-test-{}-{}.json", std::process::id(), n));
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn missing_file_gives_defaults() {
        let config = load_from(Path::new("/codedock-__no_such_file__.json"));
        assert_eq!(config.opencode_bin, None);
        assert_eq!(config.language, "auto");
    }

    #[test]
    fn malformed_json_falls_back_to_defaults() {
        let path = tempfile("{ broken");
        assert_eq!(load_from(&path), Config::with_defaults());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn valid_config_is_parsed() {
        let path = tempfile(
            r#"{"baseDirs":["/a","/b"],"opencodeBin":"/usr/local/bin/opencode","terminal":"iterm2","language":"es"}"#,
        );
        let config = load_from(&path);
        assert_eq!(config.base_dirs, vec!["/a".to_string(), "/b".to_string()]);
        assert_eq!(
            config.opencode_bin.as_deref(),
            Some("/usr/local/bin/opencode")
        );
        assert_eq!(config.terminal, "iterm2");
        assert_eq!(config.language, "es");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unknown_keys_are_ignored() {
        // Forward/backward compat: unknown keys (e.g. from older or newer
        // configs) are ignored and never written back.
        let config = parse_config(
            r#"{"baseDirs":["/a"],"showInDock":true,"show_in_dock":true}"#,
        )
        .unwrap();
        assert_eq!(config.base_dirs, vec!["/a".to_string()]);
    }

    #[test]
    fn blank_entries_are_dropped_and_dupes_removed() {
        let config = parse_config(
            r#"{"baseDirs":["/a","  ","/a","/b"],"opencodeBin":"  "}"#,
        )
        .unwrap();
        assert_eq!(config.base_dirs, vec!["/a".to_string(), "/b".to_string()]);
        assert_eq!(config.opencode_bin, None);
    }

    #[test]
    fn trailing_slashes_are_normalized_and_deduped() {
        assert_eq!(normalize_base_dir("/a/"), "/a");
        assert_eq!(normalize_base_dir("/a///"), "/a");
        assert_eq!(normalize_base_dir("  /a/b/  "), "/a/b");
        assert_eq!(normalize_base_dir("/"), "/");
        let config = parse_config(r#"{"baseDirs":["/a","/a/","/a///","/b/"]}"#).unwrap();
        assert_eq!(config.base_dirs, vec!["/a".to_string(), "/b".to_string()]);
        assert_eq!(
            sanitize_base_dirs(vec!["/x/".to_string(), "/x".to_string()]),
            vec!["/x".to_string()]
        );
    }

    #[test]
    fn non_array_config_falls_back_to_defaults() {
        let path = tempfile(r#"[1,2,3]"#);
        assert_eq!(load_from(&path), Config::with_defaults());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_and_load_round_trip() {
        let mut path = std::env::temp_dir();
        path.push(format!("codedock-save-{}.json", std::process::id()));
        let original = Config {
            base_dirs: vec!["/a".to_string(), "/b".to_string()],
            disabled_projects: vec!["/a/Old".to_string()],
            opencode_bin: Some("/x/opencode".to_string()),
            terminal: "wezterm".to_string(),
            sort_mode: "base".to_string(),
            language: "es".to_string(),
            theme: "parchment".to_string(),
        };
        save_to(&path, &original).unwrap();
        assert_eq!(load_from(&path), original);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn none_opencode_bin_is_omitted_on_save() {
        let mut path = std::env::temp_dir();
        path.push(format!("codedock-save-none-{}.json", std::process::id()));
        let config = Config {
            base_dirs: vec!["/a".to_string()],
            disabled_projects: Vec::new(),
            opencode_bin: None,
            terminal: "ghostty".to_string(),
            sort_mode: "name".to_string(),
            language: "en".to_string(),
            theme: default_theme(),
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("opencodeBin"));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn terminal_missing_unknown_or_aliased_resolves() {
        // Missing or unknown values fall back to Ghostty so opening never
        // breaks; aliases and case are normalized.
        let config = parse_config(r#"{"baseDirs":["/a"]}"#).unwrap();
        assert_eq!(config.terminal, "ghostty");
        let config = parse_config(r#"{"baseDirs":["/a"],"terminal":"hyper"}"#).unwrap();
        assert_eq!(config.terminal, "ghostty");
        let config = parse_config(r#"{"terminal":"iTerm"}"#).unwrap();
        assert_eq!(config.terminal, "iterm2");
    }

    #[test]
    fn sort_mode_missing_alias_or_unknown() {
        // Missing values keep the historic `"name"` order; English/Spanish
        // aliases select the by-base view; anything else falls back to `"name"`.
        let config = parse_config(r#"{"baseDirs":["/a"]}"#).unwrap();
        assert_eq!(config.sort_mode, "name");
        let config = parse_config(r#"{"sortMode":"base"}"#).unwrap();
        assert_eq!(config.sort_mode, "base");
        let config = parse_config(r#"{"sortMode":"  Carpetas "}"#).unwrap();
        assert_eq!(config.sort_mode, "base");
        let config = parse_config(r#"{"sort_mode":"folder"}"#).unwrap();
        assert_eq!(config.sort_mode, "base");
        let config = parse_config(r#"{"sortMode":"hyper"}"#).unwrap();
        assert_eq!(config.sort_mode, "name");
    }

    #[test]
    fn language_missing_auto_manual_or_unknown() {
        // Missing keys follow the system (`"auto"`); explicit tags resolve
        // with an English fallback for unsupported locales.
        let config = parse_config(r#"{"baseDirs":["/a"]}"#).unwrap();
        assert_eq!(config.language, "auto");
        let config = parse_config(r#"{"language":"auto"}"#).unwrap();
        assert_eq!(config.language, "auto");
        let config = parse_config(r#"{"language":"system"}"#).unwrap();
        assert_eq!(config.language, "auto");
        let config = parse_config(r#"{"language":"es"}"#).unwrap();
        assert_eq!(config.language, "es");
        let config = parse_config(r#"{"language":"es-ES"}"#).unwrap();
        assert_eq!(config.language, "es");
        let config = parse_config(r#"{"locale":"es"}"#).unwrap();
        assert_eq!(config.language, "es");
        let config = parse_config(r#"{"language":"en-US"}"#).unwrap();
        assert_eq!(config.language, "en");
        let config = parse_config(r#"{"language":"fr"}"#).unwrap();
        assert_eq!(config.language, "en");
    }

    #[test]
    fn theme_missing_locked_or_unknown() {
        // Missing keys follow the OS scheme (`"auto"`); the 8 curated ids
        // are kept; legacy or unknown values fall back to `"auto"`.
        assert_eq!(default_theme(), "auto");
        let config = parse_config(r#"{"baseDirs":["/a"]}"#).unwrap();
        assert_eq!(config.theme, "auto");
        for id in [
            "auto",
            "codedock-dark",
            "abyss-blue",
            "ember-dusk",
            "kelp-night",
            "orchid-haze",
            "codedock-light",
            "harbor-mist",
            "parchment",
        ] {
            let text = format!(r#"{{"theme":"{id}"}}"#);
            assert_eq!(parse_config(&text).unwrap().theme, id);
        }
        // Aliases and case are normalized.
        let config = parse_config(r#"{"theme":"System"}"#).unwrap();
        assert_eq!(config.theme, "auto");
        let config = parse_config(r#"{"theme":"  Parchment "}"#).unwrap();
        assert_eq!(config.theme, "parchment");
        let config = parse_config(r#"{"theme":"neon-hacker"}"#).unwrap();
        assert_eq!(config.theme, "auto");
        let config = parse_config(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(config.theme, "auto");
    }

    #[test]
    fn save_sanitizes_every_field_in_one_round_trip() {
        // `save_to` normalizes all fields at once: one dirty config proves
        // every fallback without a temp file per field.
        let mut path = std::env::temp_dir();
        path.push(format!("codedock-save-clean-{}.json", std::process::id()));
        let config = Config {
            base_dirs: vec!["/a/".to_string(), "/a".to_string()],
            disabled_projects: vec!["/a/Old/".to_string(), "/a/Old".to_string(), "  ".to_string()],
            opencode_bin: Some("  ".to_string()),
            terminal: "hyper".to_string(),
            sort_mode: "CARPETA".to_string(),
            language: "FR".to_string(),
            theme: "NEON-HACKER".to_string(),
        };
        save_to(&path, &config).unwrap();
        let back = load_from(&path);
        assert_eq!(back.base_dirs, vec!["/a".to_string()]);
        assert_eq!(back.disabled_projects, vec!["/a/Old".to_string()]);
        assert_eq!(back.opencode_bin, None);
        assert_eq!(back.terminal, "ghostty");
        assert_eq!(back.sort_mode, "base");
        assert_eq!(back.language, "en");
        assert_eq!(back.theme, "auto");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn disabled_projects_missing_means_everything_visible() {
        let config = parse_config(r#"{"baseDirs":["/a"]}"#).unwrap();
        assert!(config.disabled_projects.is_empty());
    }

    #[test]
    fn disabled_projects_are_sanitized_and_snake_case_compat() {
        let config = parse_config(
            r#"{"baseDirs":["/a"],"disabledProjects":["/a/Old/","/a/Old","  ","/b/Demo"]}"#,
        )
        .unwrap();
        assert_eq!(
            config.disabled_projects,
            vec!["/a/Old".to_string(), "/b/Demo".to_string()]
        );
        let compat = parse_config(r#"{"disabled_projects":["/x/Y/"]}"#).unwrap();
        assert_eq!(compat.disabled_projects, vec!["/x/Y".to_string()]);
        // Non-string entries are dropped without breaking the rest.
        let mixed = parse_config(r#"{"disabledProjects":["/a/Ok",42,null]}"#).unwrap();
        assert_eq!(mixed.disabled_projects, vec!["/a/Ok".to_string()]);
        assert_eq!(normalize_project_path("/a/Demo/"), "/a/Demo");
    }
}
