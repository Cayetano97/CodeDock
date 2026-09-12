//! UI language for tray menu and user-facing backend errors.
//!
//! The stored setting is `"auto"` (follow the system language), `"en"`
//! (English) or `"es"` (Spanish). `"auto"` is the default for fresh installs
//! and for configs without a language key; an explicit `"en"`/`"es"` choice
//! (set from the window) always wins and is never overridden. The effective
//! language resolves `"auto"` via the OS locale and falls back to `"en"` so a
//! hand-edited config or an unsupported system locale can never break the UI.
//! Matching is prefix-based so `es-ES`, `es_MX`, `en-US` and similar locale
//! tags resolve to their base language.

/// Stored default: follow the system language (`"auto"`).
pub fn default_language() -> String {
    "auto".to_string()
}

/// Normalizes the stored language setting from config or UI: trims,
/// lowercases and maps missing/empty/`auto`/`system`/`default` -> `"auto"`,
/// `es*` -> `"es"`, everything else explicit -> `"en"` (fallback).
pub fn normalize_language_setting(raw: Option<&str>) -> String {
    let id = raw.unwrap_or_default().trim().to_lowercase();
    if id.is_empty() || id == "auto" || id == "system" || id == "default" {
        return "auto".to_string();
    }
    match normalize_language(Some(id.as_str())).as_str() {
        "es" => "es".to_string(),
        _ => "en".to_string(),
    }
}

/// System language from the OS locale (`es` or `en`, fallback English when
/// the locale is missing or unsupported).
pub fn system_language() -> String {
    sys_locale::get_locale()
        .map(|tag| normalize_language(Some(tag.as_str())))
        .unwrap_or_else(|| "en".to_string())
}

/// Effective language for a stored setting: explicit `"en"`/`"es"` wins,
/// `"auto"` (or anything normalizing to it) follows the system with an
/// English fallback.
pub fn effective_language(stored: &str) -> String {
    if normalize_language_setting(Some(stored)) == "auto" {
        system_language()
    } else {
        normalize_language(Some(stored))
    }
}

/// True when `lang` (stored setting or effective tag) selects Spanish after
/// resolving `"auto"` via the system locale.
pub fn is_spanish(lang: &str) -> bool {
    effective_language(lang) == "es"
}

/// Normalizes a language tag from config or UI: trims, lowercases and maps
/// `es*` -> `"es"`, `en*` -> `"en"`, everything else -> `"en"` (fallback).
pub fn normalize_language(raw: Option<&str>) -> String {
    let id = raw.unwrap_or_default().trim().to_lowercase();
    // Accept locale tags such as `es-ES`, `es_MX` or `en-US`.
    let base: String = id
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    match base.as_str() {
        "es" => "es".to_string(),
        "en" => "en".to_string(),
        _ => {
            // Also accept the full tag prefix (`es-...` was already reduced to
            // `es` above, but keep a starts_with guard for separators).
            // Unknown tags fall back to English (never to "auto": this is the
            // effective tag normalizer, not the stored-setting one).
            if id.starts_with("es") {
                "es".to_string()
            } else if id.starts_with("en") {
                "en".to_string()
            } else {
                "en".to_string()
            }
        }
    }
}

// --- Tray menu -------------------------------------------------------------

/// "Show CodeDock" tray item.
pub fn tray_show(lang: &str) -> String {
    if is_spanish(lang) {
        "Mostrar CodeDock".to_string()
    } else {
        "Show CodeDock".to_string()
    }
}

/// "Reload projects" tray item.
pub fn tray_reload(lang: &str) -> String {
    if is_spanish(lang) {
        "Recargar proyectos".to_string()
    } else {
        "Reload projects".to_string()
    }
}

/// "Quit CodeDock" tray item.
pub fn tray_quit(lang: &str) -> String {
    if is_spanish(lang) {
        "Salir de CodeDock".to_string()
    } else {
        "Quit CodeDock".to_string()
    }
}

/// Disabled placeholder when there are no projects yet.
pub fn tray_empty(lang: &str) -> String {
    if is_spanish(lang) {
        "Sin proyectos: abre CodeDock y añade una carpeta base".to_string()
    } else {
        "No projects: open CodeDock and add a base folder".to_string()
    }
}

/// Disabled overflow row when the tray menu is capped (`…and N more`).
pub fn tray_more(lang: &str, remaining: usize) -> String {
    if is_spanish(lang) {
        format!("…y {remaining} más en la ventana")
    } else {
        format!("…and {remaining} more in the window")
    }
}

// --- Terminal / open errors --------------------------------------------------

/// `osascript` binary could not be launched.
pub fn err_osascript_spawn(lang: &str, detail: &str) -> String {
    if is_spanish(lang) {
        format!("No se pudo lanzar osascript: {detail}")
    } else {
        format!("Could not launch osascript: {detail}")
    }
}

/// The target app did not answer the open AppleScript.
pub fn err_app_no_response(lang: &str, app_name: &str) -> String {
    if is_spanish(lang) {
        format!("{app_name} no respondió al script de apertura.")
    } else {
        format!("{app_name} did not respond to the open script.")
    }
}

/// The target app answered the AppleScript with an error.
pub fn err_app_error(lang: &str, app_name: &str, stderr: &str) -> String {
    if is_spanish(lang) {
        format!("{app_name} devolvió un error: {stderr}")
    } else {
        format!("{app_name} returned an error: {stderr}")
    }
}

/// Internal argv builder produced an empty command.
pub fn err_empty_command(lang: &str, app_name: &str) -> String {
    if is_spanish(lang) {
        format!("No se pudo abrir {app_name}: comando vacío.")
    } else {
        format!("Could not open {app_name}: empty command.")
    }
}

/// A detached GUI process could not be spawned.
pub fn err_open_app(lang: &str, app_name: &str, detail: &str) -> String {
    if is_spanish(lang) {
        format!("No se pudo abrir {app_name}: {detail}")
    } else {
        format!("Could not open {app_name}: {detail}")
    }
}

/// WezTerm CLI binary was not found.
pub fn err_wezterm_missing(lang: &str) -> String {
    if is_spanish(lang) {
        "No se encontró el binario de WezTerm (ni en el PATH ni en /Applications).".to_string()
    } else {
        "WezTerm binary not found (neither in PATH nor in /Applications).".to_string()
    }
}

/// Alacritty CLI binary was not found.
pub fn err_alacritty_missing(lang: &str) -> String {
    if is_spanish(lang) {
        "No se encontró el binario de Alacritty (ni en el PATH ni en /Applications).".to_string()
    } else {
        "Alacritty binary not found (neither in PATH nor in /Applications).".to_string()
    }
}

/// Kitty CLI binary was not found.
pub fn err_kitty_missing(lang: &str) -> String {
    if is_spanish(lang) {
        "No se encontró el binario de Kitty (ni en el PATH ni en /Applications).".to_string()
    } else {
        "Kitty binary not found (neither in PATH nor in /Applications).".to_string()
    }
}

/// Warp did not react to the folder URL.
pub fn err_warp_no_response(lang: &str) -> String {
    if is_spanish(lang) {
        "Warp no respondió al abrir la carpeta.".to_string()
    } else {
        "Warp did not respond when opening the folder.".to_string()
    }
}

/// Warp answered with an error.
pub fn err_warp_error(lang: &str, stderr: &str) -> String {
    if is_spanish(lang) {
        format!("Warp devolvió un error: {stderr}")
    } else {
        format!("Warp returned an error: {stderr}")
    }
}

/// Warp `open` itself failed.
pub fn err_warp_open(lang: &str, detail: &str) -> String {
    if is_spanish(lang) {
        format!("No se pudo abrir Warp: {detail}")
    } else {
        format!("Could not open Warp: {detail}")
    }
}

/// Selected terminal is not installed.
pub fn err_terminal_not_installed(lang: &str, display_name: &str) -> String {
    if is_spanish(lang) {
        format!("{display_name} no está instalado (ni en /Applications ni en el PATH).")
    } else {
        format!("{display_name} is not installed (neither in /Applications nor in PATH).")
    }
}

// --- Projects / opencode errors ----------------------------------------------

/// A base folder could not be read (logged to stderr, scan continues).
pub fn err_base_unreadable(lang: &str, base: &str) -> String {
    if is_spanish(lang) {
        format!("[codedock] no se pudo leer la carpeta base: {base}")
    } else {
        format!("[codedock] could not read base folder: {base}")
    }
}

/// The configured opencode override points nowhere.
pub fn err_opencode_override_missing(lang: &str, expanded: &str) -> String {
    if is_spanish(lang) {
        format!("No existe el binario de opencode: {expanded}")
    } else {
        format!("opencode binary does not exist: {expanded}")
    }
}

/// No opencode binary was found anywhere.
pub fn err_opencode_not_found(lang: &str) -> String {
    if is_spanish(lang) {
        "No se encontró opencode. Instálalo o pon su ruta en Ajustes.".to_string()
    } else {
        "opencode not found. Install it or set its path in Settings.".to_string()
    }
}

/// The project folder is gone.
pub fn err_project_missing(lang: &str, path: &str) -> String {
    if is_spanish(lang) {
        format!("La carpeta ya no existe: {path}")
    } else {
        format!("Folder no longer exists: {path}")
    }
}

/// The tray menu could not be rebuilt (logged to stderr).
pub fn err_tray_build(lang: &str, detail: &str) -> String {
    if is_spanish(lang) {
        format!("[codedock] no se pudo construir el menú del tray: {detail}")
    } else {
        format!("[codedock] could not build tray menu: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_is_english() {
        assert_eq!(normalize_language(None), "en");
        assert_eq!(normalize_language(Some("")), "en");
        assert_eq!(normalize_language(Some("  ")), "en");
        assert_eq!(normalize_language(Some("fr")), "en");
        assert_eq!(normalize_language(Some("de-DE")), "en");
    }

    #[test]
    fn accepts_english_and_spanish_tags() {
        assert_eq!(normalize_language(Some("en")), "en");
        assert_eq!(normalize_language(Some("EN-us")), "en");
        assert_eq!(normalize_language(Some("es")), "es");
        assert_eq!(normalize_language(Some("es-ES")), "es");
        assert_eq!(normalize_language(Some("  Español ")), "es");
    }

    #[test]
    fn stored_setting_defaults_to_auto_and_keeps_manual_choice() {
        assert_eq!(default_language(), "auto");
        assert_eq!(normalize_language_setting(None), "auto");
        assert_eq!(normalize_language_setting(Some("")), "auto");
        assert_eq!(normalize_language_setting(Some("auto")), "auto");
        assert_eq!(normalize_language_setting(Some("system")), "auto");
        assert_eq!(normalize_language_setting(Some("es-ES")), "es");
        assert_eq!(normalize_language_setting(Some("en-US")), "en");
        // Unknown explicit values fall back to English, not to auto.
        assert_eq!(normalize_language_setting(Some("fr")), "en");
    }

    #[test]
    fn effective_language_prefers_manual_and_falls_back_to_english() {
        assert_eq!(effective_language("en"), "en");
        assert_eq!(effective_language("es"), "es");
        assert_eq!(effective_language("es-ES"), "es");
        assert_eq!(effective_language("fr"), "en");
        // `auto` follows the OS locale: always a supported tag.
        let system = effective_language("auto");
        assert!(system == "en" || system == "es");
        let missing = effective_language("");
        assert!(missing == "en" || missing == "es");
    }

    #[test]
    fn tray_labels_cover_both_languages() {
        assert_eq!(tray_show("en"), "Show CodeDock");
        assert_eq!(tray_show("es"), "Mostrar CodeDock");
        assert_eq!(tray_reload("en"), "Reload projects");
        assert_eq!(tray_reload("es"), "Recargar proyectos");
        assert_eq!(tray_quit("en"), "Quit CodeDock");
        assert_eq!(tray_quit("es"), "Salir de CodeDock");
        assert!(tray_empty("en").contains("No projects"));
        assert!(tray_empty("es").contains("Sin proyectos"));
        assert!(tray_more("en", 3).contains("3"));
        assert!(tray_more("es", 3).contains("3"));
    }

    #[test]
    fn errors_cover_both_languages() {
        assert!(err_opencode_not_found("en").contains("opencode not found"));
        assert!(err_opencode_not_found("es").contains("No se encontró opencode"));
        assert!(err_project_missing("en", "/x").contains("no longer exists"));
        assert!(err_project_missing("es", "/x").contains("ya no existe"));
    }
}
