//! Supported terminals: detection and project opening (macOS).
//!
//! There is no common API to "open this folder and run this command", so
//! each terminal needs its own mechanism:
//!
//! - Ghostty / Terminal.app / iTerm2: AppleScript via `osascript`.
//!   Ghostty exposes `new surface configuration` (see
//!   <https://ghostty.org/docs/features/applescript>); Terminal.app uses
//!   `do script`; iTerm2 uses `create window/tab …` + `write text` (see
//!   <https://iterm2.com/documentation-scripting.html>).
//! - Warp: URI scheme `warp://action/new_tab?path=…` (see
//!   <https://docs.warp.dev/terminal/more-features/uri-scheme/>). It can
//!   only open a folder, NOT run a command — that is a Warp limitation
//!   (warpdotdev/Warp#5859), so with Warp the user runs opencode by hand.
//! - Alacritty / Kitty / WezTerm: their own CLI binaries
//!   (`--working-directory … -e …`, `--directory …`, `start/spawn --cwd …`).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use crate::i18n::{
    err_alacritty_missing, err_app_error, err_app_no_response, err_empty_command,
    err_kitty_missing, err_open_app, err_osascript_spawn, err_terminal_not_installed,
    err_warp_error, err_warp_no_response, err_warp_open, err_wezterm_missing,
};
use crate::projects::applescript_escape;

/// Every supported terminal: (id, display name).
pub const SUPPORTED: &[(&str, &str)] = &[
    ("ghostty", "Ghostty"),
    ("terminal", "Terminal.app"),
    ("iterm2", "iTerm2"),
    ("warp", "Warp"),
    ("alacritty", "Alacritty"),
    ("kitty", "Kitty"),
    ("wezterm", "WezTerm"),
];

/// Default terminal for fresh configs and unknown values.
pub fn default_terminal() -> String {
    "ghostty".to_string()
}

/// Normalizes a terminal id coming from user config: trims, lowercases,
/// resolves a few aliases and falls back to `"ghostty"` for unknown values
/// so a hand-edited config can never break project opening.
pub fn normalize_terminal(raw: Option<&str>) -> String {
    let id = raw.unwrap_or_default().trim().to_lowercase();
    let canonical = match id.as_str() {
        "terminal.app" | "apple_terminal" | "appleterminal" => "terminal",
        "iterm" => "iterm2",
        "warp-terminal" | "warp_terminal" => "warp",
        _ => id.as_str(),
    };
    if SUPPORTED.iter().any(|(known, _)| *known == canonical) {
        canonical.to_string()
    } else {
        default_terminal()
    }
}

/// Display name for a terminal id (`"Ghostty"` for unknown ids).
pub fn display_name(id: &str) -> &str {
    SUPPORTED
        .iter()
        .find(|(known, _)| *known == id)
        .map(|(_, name)| *name)
        .unwrap_or("Ghostty")
}

/// What the frontend renders in the terminal picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
}

/// Lists every supported terminal with its display name and whether it was
/// detected on this machine right now.
pub fn detect_terminals() -> Vec<TerminalInfo> {
    SUPPORTED
        .iter()
        .map(|(id, name)| TerminalInfo {
            id: id.to_string(),
            name: name.to_string(),
            available: is_available(id),
        })
        .collect()
}

fn app_in_home(name: &str) -> Option<String> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Applications")
            .join(name)
            .to_string_lossy()
            .into_owned()
    })
}

fn any_app_exists(candidates: &[&str], home_name: &str) -> bool {
    if candidates.iter().any(|p| Path::new(p).exists()) {
        return true;
    }
    if let Some(home_path) = app_in_home(home_name) {
        if Path::new(&home_path).exists() {
            return true;
        }
    }
    false
}

fn binary_in_path(name: &str) -> Option<String> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

/// Looks for a CLI binary first in `PATH`, then in well-known locations
/// (Homebrew prefix, inside the `.app` bundle).
fn find_binary(name: &str, extra: &[&str]) -> Option<String> {
    if let Some(found) = binary_in_path(name) {
        return Some(found);
    }
    for path in extra {
        if Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    None
}

fn alacritty_binary() -> Option<String> {
    find_binary(
        "alacritty",
        &[
            "/opt/homebrew/bin/alacritty",
            "/Applications/Alacritty.app/Contents/MacOS/alacritty",
        ],
    )
}

fn kitty_binary() -> Option<String> {
    // `kitten` alone is not enough to open windows, but its presence next
    // to a kitty install still signals Kitty; the open step needs `kitty`.
    if let Some(kitty) = find_binary(
        "kitty",
        &[
            "/opt/homebrew/bin/kitty",
            "/Applications/kitty.app/Contents/MacOS/kitty",
        ],
    ) {
        return Some(kitty);
    }
    None
}

fn wezterm_binary() -> Option<String> {
    find_binary(
        "wezterm",
        &[
            "/opt/homebrew/bin/wezterm",
            "/Applications/WezTerm.app/Contents/MacOS/wezterm",
        ],
    )
}

/// Whether the terminal looks installed: `.app` bundle in /Applications (or
/// ~/Applications) or its CLI on `PATH` / known locations. Terminal.app is
/// always present on macOS.
pub fn is_available(id: &str) -> bool {
    match id {
        "ghostty" => {
            any_app_exists(&["/Applications/Ghostty.app"], "Ghostty.app")
                || find_binary(
                    "ghostty",
                    &[
                        "/opt/homebrew/bin/ghostty",
                        "/Applications/Ghostty.app/Contents/MacOS/ghostty",
                    ],
                )
                .is_some()
        }
        "terminal" => any_app_exists(
            &[
                "/System/Applications/Utilities/Terminal.app",
                "/Applications/Utilities/Terminal.app",
            ],
            "Terminal.app",
        ),
        "iterm2" => any_app_exists(&["/Applications/iTerm.app"], "iTerm.app"),
        "warp" => {
            any_app_exists(&["/Applications/Warp.app"], "Warp.app")
                || binary_in_path("warp-terminal").is_some()
        }
        "alacritty" => {
            any_app_exists(&["/Applications/Alacritty.app"], "Alacritty.app")
                || alacritty_binary().is_some()
        }
        "kitty" => {
            any_app_exists(&["/Applications/kitty.app"], "kitty.app")
                || kitty_binary().is_some()
                || binary_in_path("kitten").is_some()
        }
        "wezterm" => {
            any_app_exists(&["/Applications/WezTerm.app"], "WezTerm.app")
                || wezterm_binary().is_some()
        }
        _ => false,
    }
}

/// Quotes a value for POSIX shells (`/a'b` -> `'/a'\''b'`).
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Percent-encodes a path for `warp://…?path=…` (keeps `/` readable).
pub fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn run_osascript(app_name: &str, lines: &[String], lang: &str) -> Result<(), String> {
    let mut cmd = std::process::Command::new("osascript");
    for line in lines {
        cmd.arg("-e").arg(line);
    }
    let output = cmd
        .output()
        .map_err(|e| err_osascript_spawn(lang, &e.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(err_app_no_response(lang, app_name))
        } else {
            Err(err_app_error(lang, app_name, &stderr))
        }
    }
}

/// `do script` always opens a new window; there is no stable AppleScript way
/// to target "a new tab", so a new window per project is the documented
/// Terminal.app behavior.
pub fn build_terminal_script(project_path: &str, opencode_bin: &str) -> Vec<String> {
    let cmd = applescript_escape(&format!(
        "cd {} && exec {}",
        shell_quote(project_path),
        shell_quote(opencode_bin)
    ));
    vec![
        "tell application \"Terminal\"".to_string(),
        format!("do script \"{cmd}\""),
        "activate".to_string(),
        "end tell".to_string(),
    ]
}

/// New tab in the current window when one exists, new window otherwise, then
/// `write text` types the `cd … && exec …` line (with trailing newline, so it
/// runs) instead of replacing the profile command — that keeps the tab open
/// and interactive after opencode exits.
pub fn build_iterm_script(project_path: &str, opencode_bin: &str) -> Vec<String> {
    let cmd = applescript_escape(&format!(
        "cd {} && exec {}",
        shell_quote(project_path),
        shell_quote(opencode_bin)
    ));
    vec![
        "tell application \"iTerm2\"".to_string(),
        "activate".to_string(),
        "if (count of windows) = 0 then".to_string(),
        "create window with default profile".to_string(),
        "tell current session of current window".to_string(),
        format!("write text \"{cmd}\""),
        "end tell".to_string(),
        "else".to_string(),
        "tell current window".to_string(),
        "create tab with default profile".to_string(),
        "tell current session".to_string(),
        format!("write text \"{cmd}\""),
        "end tell".to_string(),
        "end tell".to_string(),
        "end if".to_string(),
        "end tell".to_string(),
    ]
}

/// `warp://action/new_tab?path=…` / `…/new_window?path=…`.
pub fn warp_url(project_path: &str, new_window: bool) -> String {
    let action = if new_window { "new_window" } else { "new_tab" };
    format!("warp://action/{action}?path={}", url_encode(project_path))
}

/// Alacritty has no tabs: every project opens a new window.
/// `alacritty --working-directory <dir> -e <cmd>`.
pub fn alacritty_argv(binary: &str, project_path: &str, opencode_bin: &str) -> Vec<String> {
    vec![
        binary.to_string(),
        "--working-directory".to_string(),
        project_path.to_string(),
        "-e".to_string(),
        opencode_bin.to_string(),
    ]
}

/// Kitty opens a new OS window: `kitty --directory <dir> <cmd>`.
/// (Tabs in the current window would need remote control enabled in
/// `kitty.conf`, which CodeDock does not assume.)
pub fn kitty_argv(binary: &str, project_path: &str, opencode_bin: &str) -> Vec<String> {
    vec![
        binary.to_string(),
        "--directory".to_string(),
        project_path.to_string(),
        opencode_bin.to_string(),
    ]
}

/// New tab in the running instance: `wezterm cli spawn --cwd <dir> -- <cmd>`.
pub fn wezterm_spawn_argv(binary: &str, project_path: &str, opencode_bin: &str) -> Vec<String> {
    vec![
        binary.to_string(),
        "cli".to_string(),
        "spawn".to_string(),
        "--cwd".to_string(),
        project_path.to_string(),
        "--".to_string(),
        opencode_bin.to_string(),
    ]
}

/// Cold start (no GUI running): `wezterm start --cwd <dir> -- <cmd>`.
pub fn wezterm_start_argv(binary: &str, project_path: &str, opencode_bin: &str) -> Vec<String> {
    vec![
        binary.to_string(),
        "start".to_string(),
        "--cwd".to_string(),
        project_path.to_string(),
        "--".to_string(),
        opencode_bin.to_string(),
    ]
}

fn spawn_detached(app_name: &str, argv: &[String], lang: &str) -> Result<(), String> {
    let (bin, args) = argv
        .split_first()
        .ok_or_else(|| err_empty_command(lang, app_name))?;
    std::process::Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| err_open_app(lang, app_name, &e.to_string()))
}

fn warp_running() -> bool {
    std::process::Command::new("pgrep")
        .arg("-xq")
        .arg("Warp")
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn open_warp(project_path: &str, lang: &str) -> Result<(), String> {
    // Mirror the tab-if-running / window-if-not behavior: new tab when Warp
    // is already open, new window on cold start.
    let url = warp_url(project_path, !warp_running());
    let output = std::process::Command::new("open")
        .arg(&url)
        .output()
        .map_err(|e| err_warp_open(lang, &e.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(err_warp_no_response(lang))
        } else {
            Err(err_warp_error(lang, &stderr))
        }
    }
}

fn open_wezterm(project_path: &str, opencode_bin: &str, lang: &str) -> Result<(), String> {
    let bin = wezterm_binary().ok_or_else(|| err_wezterm_missing(lang))?;
    // Prefer a new tab in the running instance; fall back to a cold start.
    let spawn = wezterm_spawn_argv(&bin, project_path, opencode_bin);
    if let Ok(output) = std::process::Command::new(&spawn[0])
        .args(&spawn[1..])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }
    spawn_detached(
        "WezTerm",
        &wezterm_start_argv(&bin, project_path, opencode_bin),
        lang,
    )
}

/// Opens the project in the given terminal (id as stored in config) and runs
/// opencode inside — except Warp, whose URI scheme can only open the folder
/// (documented in the README and in the UI hint).
pub fn open_in_terminal(
    terminal: &str,
    project_path: &str,
    opencode_bin: &str,
    lang: &str,
) -> Result<(), String> {
    let id = normalize_terminal(Some(terminal));
    if !is_available(&id) {
        return Err(err_terminal_not_installed(lang, display_name(&id)));
    }
    match id.as_str() {
        "ghostty" => run_osascript(
            "Ghostty",
            &crate::projects::build_open_script(project_path, opencode_bin),
            lang,
        ),
        "terminal" => run_osascript(
            "Terminal",
            &build_terminal_script(project_path, opencode_bin),
            lang,
        ),
        "iterm2" => run_osascript("iTerm2", &build_iterm_script(project_path, opencode_bin), lang),
        "warp" => open_warp(project_path, lang),
        "alacritty" => {
            let bin = alacritty_binary().ok_or_else(|| err_alacritty_missing(lang))?;
            spawn_detached("Alacritty", &alacritty_argv(&bin, project_path, opencode_bin), lang)
        }
        "kitty" => {
            let bin = kitty_binary().ok_or_else(|| err_kitty_missing(lang))?;
            spawn_detached("Kitty", &kitty_argv(&bin, project_path, opencode_bin), lang)
        }
        "wezterm" => open_wezterm(project_path, opencode_bin, lang),
        // `normalize_terminal` only returns known ids; this is unreachable.
        _ => run_osascript(
            "Ghostty",
            &crate::projects::build_open_script(project_path, opencode_bin),
            lang,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_known_ids_case_insensitively() {
        assert_eq!(normalize_terminal(Some("ghostty")), "ghostty");
        assert_eq!(normalize_terminal(Some("  iTerm2 ")), "iterm2");
        assert_eq!(normalize_terminal(Some("WARP")), "warp");
        assert_eq!(normalize_terminal(Some("WezTerm")), "wezterm");
    }

    #[test]
    fn normalize_resolves_aliases() {
        assert_eq!(normalize_terminal(Some("iterm")), "iterm2");
        assert_eq!(normalize_terminal(Some("Terminal.app")), "terminal");
        assert_eq!(normalize_terminal(Some("warp-terminal")), "warp");
    }

    #[test]
    fn normalize_falls_back_to_ghostty() {
        assert_eq!(normalize_terminal(None), "ghostty");
        assert_eq!(normalize_terminal(Some("")), "ghostty");
        assert_eq!(normalize_terminal(Some("   ")), "ghostty");
        assert_eq!(normalize_terminal(Some("hyper")), "ghostty");
    }

    #[test]
    fn detect_lists_every_supported_terminal_in_order() {
        let found = detect_terminals();
        let ids: Vec<&str> = found.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "ghostty",
                "terminal",
                "iterm2",
                "warp",
                "alacritty",
                "kitty",
                "wezterm"
            ]
        );
        assert!(found.iter().all(|t| !t.name.is_empty()));
    }

    #[test]
    fn unknown_ids_are_never_available() {
        assert!(!is_available("hyper"));
        assert!(!is_available(""));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn terminal_app_is_always_available_on_macos() {
        assert!(is_available("terminal"));
    }

    #[test]
    fn shell_quote_wraps_in_single_quotes() {
        assert_eq!(shell_quote("/a/b"), "'/a/b'");
        assert_eq!(shell_quote("/a'b"), "'/a'\\''b'");
        assert_eq!(shell_quote("/x/opencode"), "'/x/opencode'");
    }

    #[test]
    fn url_encode_keeps_slashes_and_escapes_spaces() {
        assert_eq!(url_encode("/a/b"), "/a/b");
        assert_eq!(url_encode("/Mi Proyecto"), "/Mi%20Proyecto");
        assert_eq!(url_encode("~/a&b"), "~/a%26b");
    }

    #[test]
    fn terminal_script_runs_cd_and_exec_in_new_window() {
        let script = build_terminal_script("/p/demo", "/x/opencode").join("\n");
        assert!(script.contains("tell application \"Terminal\""));
        assert!(script.contains("do script"));
        assert!(script.contains("cd '/p/demo' && exec '/x/opencode'"));
        assert!(script.contains("activate"));
    }

    #[test]
    fn iterm_script_prefers_tab_with_window_fallback() {
        let script = build_iterm_script("/p/demo", "/x/opencode").join("\n");
        assert!(script.contains("tell application \"iTerm2\""));
        assert!(script.contains("if (count of windows) = 0 then"));
        assert!(script.contains("create window with default profile"));
        assert!(script.contains("create tab with default profile"));
        assert!(script.contains("write text \"cd '/p/demo' && exec '/x/opencode'\""));
    }

    #[test]
    fn warp_url_targets_tab_or_window_with_encoded_path() {
        assert_eq!(warp_url("/p/demo", false), "warp://action/new_tab?path=/p/demo");
        assert_eq!(
            warp_url("/Mi Proyecto", true),
            "warp://action/new_window?path=/Mi%20Proyecto"
        );
    }

    #[test]
    fn cli_argv_use_each_tool_documented_flags() {
        let alacritty = alacritty_argv("/usr/bin/alacritty", "/p/demo", "/x/opencode");
        assert_eq!(
            alacritty,
            vec!["/usr/bin/alacritty", "--working-directory", "/p/demo", "-e", "/x/opencode"]
        );
        let kitty = kitty_argv("/usr/bin/kitty", "/p/demo", "/x/opencode");
        assert_eq!(
            kitty,
            vec!["/usr/bin/kitty", "--directory", "/p/demo", "/x/opencode"]
        );
        let spawn = wezterm_spawn_argv("/usr/bin/wezterm", "/p/demo", "/x/opencode");
        assert_eq!(
            spawn,
            vec![
                "/usr/bin/wezterm",
                "cli",
                "spawn",
                "--cwd",
                "/p/demo",
                "--",
                "/x/opencode"
            ]
        );
        let start = wezterm_start_argv("/usr/bin/wezterm", "/p/demo", "/x/opencode");
        assert_eq!(
            start,
            vec!["/usr/bin/wezterm", "start", "--cwd", "/p/demo", "--", "/x/opencode"]
        );
    }
}
