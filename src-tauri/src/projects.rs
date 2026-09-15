//! Projects and opening them in the chosen terminal with opencode (macOS only).
//!
//! - `list_projects` scans the base folders and returns their direct
//!   subfolders (no hidden entries), ordered by name.
//! - `open_project` opens the project in the configured terminal (see
//!   `crate::terminal`): new tab when already running, new window when not —
//!   except Terminal.app (always a new window), Alacritty/Kitty (always a new
//!   window, no tabs / OS window) and Warp (only opens the folder: its URI
//!   scheme cannot launch commands).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::i18n::{
    err_base_unreadable, err_opencode_not_found, err_opencode_override_missing,
    err_project_missing,
};

/// A project: a direct subfolder of a base folder.
#[derive(Debug, PartialEq, Eq, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
    pub base: String,
}

/// Expands a leading `~` to `$HOME`. Everything else is left untouched.
pub fn expand_tilde(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest).to_string_lossy().into_owned();
        }
    } else if value == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return home.to_string_lossy().into_owned();
        }
    }
    value.to_string()
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Short label of a base folder: its last segment
/// (`/Users/you/Programs` -> `Programs`). Used for badges and headers.
/// Input is already normalized (no trailing `/`), except root `/`.
pub fn base_label(base: &str) -> &str {
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return base;
    }
    let no_slash = trimmed.trim_end_matches('/');
    if no_slash.is_empty() {
        return "/";
    }
    no_slash.rsplit('/').next().unwrap_or(no_slash)
}

/// Sorts projects following the stored config mode:
/// - `"base"`: by base folder (alphabetical label, then base path as
///   tiebreaker) and within each base by name.
/// - any other value (`"name"`): global alphabetical by name (historic
///   behavior) then by path.
/// Case-insensitive in both cases.
pub fn sort_projects(projects: &mut [Project], sort_mode: &str) {
    if sort_mode.trim().eq_ignore_ascii_case("base") {
        projects.sort_by(|a, b| {
            base_label(&a.base)
                .to_lowercase()
                .cmp(&base_label(&b.base).to_lowercase())
                .then_with(|| a.base.to_lowercase().cmp(&b.base.to_lowercase()))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.path.cmp(&b.path))
        });
    } else {
        projects.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.path.cmp(&b.path))
        });
    }
}

/// Whether a scanned project path is disabled (hidden from the window list
/// and the tray menu). Both sides normalize trailing `/` so `/a/Demo` and
/// `/a/Demo/` match; comparison is exact (case-sensitive like the filesystem
/// path on macOS default APFS behavior is case-insensitive, but the stored
/// path comes from the same scan so exact match is correct and predictable).
pub fn is_project_disabled(project_path: &str, disabled: &[String]) -> bool {
    let normalized = crate::config::normalize_project_path(project_path);
    disabled
        .iter()
        .any(|d| crate::config::normalize_project_path(d) == normalized)
}

/// Removes disabled projects from a scanned list (in place). Stale disabled
/// entries (no longer on disk) simply match nothing.
pub fn apply_disabled_filter(projects: &mut Vec<Project>, disabled: &[String]) {
    if disabled.is_empty() {
        return;
    }
    projects.retain(|p| !is_project_disabled(&p.path, disabled));
}

/// Scans the bases and lists their direct subfolders. Missing bases or
/// non-directories are skipped (stderr warning so `tauri dev` shows why a
/// base yields 0 projects); projects are ordered by name (case-insensitive)
/// then by path. See `sort_projects` to reorder by base via `sortMode`.
pub fn list_projects(base_dirs: &[String], lang: &str) -> Vec<Project> {
    let mut out = Vec::new();
    for base in base_dirs {
        let expanded = expand_tilde(base.trim());
        let normalized = crate::config::normalize_base_dir(&expanded);
        if normalized.is_empty() {
            continue;
        }
        let base_path = Path::new(&normalized);
        let Ok(entries) = std::fs::read_dir(base_path) else {
            eprintln!("{}", err_base_unreadable(lang, &normalized));
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if is_hidden(name) {
                continue;
            }
            out.push(Project {
                name: name.to_string(),
                path: path.to_string_lossy().into_owned(),
                base: normalized.clone(),
            });
        }
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    out
}

/// Locates the opencode binary: config override first, then the usual
/// locations, finally the `PATH`.
pub fn resolve_opencode(opencode_override: Option<&str>, lang: &str) -> Result<String, String> {
    if let Some(raw) = opencode_override {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let expanded = expand_tilde(trimmed);
            if Path::new(&expanded).is_file() {
                return Ok(expanded);
            }
            return Err(err_opencode_override_missing(lang, &expanded));
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join(".opencode")
                .join("bin")
                .join("opencode")
                .to_string_lossy()
                .into_owned(),
        );
    }
    candidates.push("/opt/homebrew/bin/opencode".to_string());
    candidates.push("/usr/local/bin/opencode".to_string());
    for c in &candidates {
        if Path::new(c).is_file() {
            return Ok(c.clone());
        }
    }

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join("opencode");
            if candidate.is_file() {
                return Ok(candidate.to_string_lossy().into_owned());
            }
        }
    }

    Err(err_opencode_not_found(lang))
}

/// Escapes a value for interpolation into a quoted AppleScript literal.
pub fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Builds the script that opens the project: new tab when Ghostty already
/// has a window, new window when there is none (or Ghostty is closed, in
/// which case `tell` launches it).
pub fn build_open_script(project_path: &str, opencode_bin: &str) -> Vec<String> {
    let path = applescript_escape(project_path);
    let bin = applescript_escape(opencode_bin);
    vec![
        "tell application \"Ghostty\"".to_string(),
        "set cfg to new surface configuration".to_string(),
        format!("set initial working directory of cfg to \"{path}\""),
        format!("set command of cfg to \"{bin}\""),
        "if (count windows) = 0 then".to_string(),
        "new window with configuration cfg".to_string(),
        "else".to_string(),
        "new tab in front window with configuration cfg".to_string(),
        "end if".to_string(),
        "activate".to_string(),
        "end tell".to_string(),
    ]
}

/// Opens the project in the configured terminal with opencode inside.
/// `terminal` is the id stored in config (`None` = Ghostty).
pub fn open_project(
    project_path: &str,
    opencode_override: Option<&str>,
    terminal: Option<&str>,
    lang: &str,
) -> Result<(), String> {
    let expanded = expand_tilde(project_path.trim());
    if expanded.is_empty() || !Path::new(&expanded).is_dir() {
        return Err(err_project_missing(lang, project_path));
    }
    let bin = resolve_opencode(opencode_override, lang)?;
    crate::terminal::open_in_terminal(terminal.unwrap_or("ghostty"), &expanded, &bin, lang)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilde_expands_to_home() {
        let home = std::env::var_os("HOME").unwrap().to_string_lossy().into_owned();
        assert_eq!(expand_tilde("~"), home);
        assert!(expand_tilde("~/a/b").starts_with(&home));
        assert_eq!(expand_tilde("/absoluta"), "/absoluta");
        assert_eq!(expand_tilde("relativa"), "relativa");
    }

    #[test]
    fn applescript_escape_quotes_and_backslashes() {
        assert_eq!(applescript_escape("/a/b"), "/a/b");
        assert_eq!(applescript_escape("/a\"b"), "/a\\\"b");
        assert_eq!(applescript_escape("C:\\x"), "C:\\\\x");
    }

    #[test]
    fn open_script_prefers_tab_with_window_fallback() {
        let script = build_open_script("/Users/you/Programs/Demo", "/x/opencode");
        let joined = script.join("\n");
        assert!(joined.contains("set initial working directory of cfg to \"/Users/you/Programs/Demo\""));
        assert!(joined.contains("set command of cfg to \"/x/opencode\""));
        assert!(joined.contains("if (count windows) = 0 then"));
        assert!(joined.contains("new window with configuration cfg"));
        assert!(joined.contains("new tab in front window with configuration cfg"));
    }

    #[test]
    fn open_script_escapes_quotes_in_paths() {
        let script = build_open_script("/Users/you/My \"Project\"", "/x/opencode");
        assert!(
            script
                .iter()
                .any(|l| l.contains("My \\\"Project\\\""))
        );
    }

    #[test]
    fn list_projects_skips_files_hidden_and_missing_bases() {
        let root = std::env::temp_dir().join(format!("codedock-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Beta")).unwrap();
        std::fs::create_dir_all(root.join("alfa")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("file.txt"), "hello").unwrap();

        let found = list_projects(
            &[
                root.to_string_lossy().into_owned(),
                "/codedock-__no_such__".to_string(),
            ],
            "en",
        );
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        // Sorted case-insensitively: alfa before Beta.
        assert_eq!(names, vec!["alfa", "Beta"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn list_projects_merges_two_valid_bases_sorted() {
        let base = std::env::temp_dir().join(format!("codedock-multi-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let a = base.join("base-a");
        let b = base.join("base-b");
        std::fs::create_dir_all(a.join("Zeta")).unwrap();
        std::fs::create_dir_all(a.join("alfa")).unwrap();
        std::fs::create_dir_all(b.join("Beta")).unwrap();
        std::fs::create_dir_all(b.join(".hidden")).unwrap();
        std::fs::write(b.join("note.txt"), "hello").unwrap();

        let found = list_projects(
            &[
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
            ],
            "en",
        );
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        // Both bases contribute: alfa (a), Beta (b), Zeta (a), sorted.
        assert_eq!(names, vec!["alfa", "Beta", "Zeta"]);
        // Each project remembers its normalized base.
        assert_eq!(found[0].base, a.to_string_lossy());
        assert_eq!(found[1].base, b.to_string_lossy());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn list_projects_normalizes_trailing_slash_base() {
        let root =
            std::env::temp_dir().join(format!("codedock-slash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Demo")).unwrap();

        let with_slash = format!("{}/", root.to_string_lossy());
        let found = list_projects(&[with_slash], "en");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Demo");
        // No trailing `/` in the `base` field.
        assert!(!found[0].base.ends_with('/'));
        assert_eq!(found[0].base, root.to_string_lossy());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_opencode_prefers_override_when_it_exists() {
        let dir = std::env::temp_dir().join(format!("codedock-bin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("opencode");
        std::fs::write(&fake, "#!/bin/sh").unwrap();
        let got = resolve_opencode(Some(fake.to_str().unwrap()), "en").unwrap();
        assert_eq!(got, fake.to_string_lossy());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_opencode_errors_on_missing_override() {
        let err = resolve_opencode(Some("/codedock-__no_such__/opencode"), "en").unwrap_err();
        assert!(err.contains("does not exist"));
        let err_es =
            resolve_opencode(Some("/codedock-__no_such__/opencode"), "es").unwrap_err();
        assert!(err_es.contains("No existe"));
    }

    #[test]
    fn base_label_uses_last_segment() {
        assert_eq!(base_label("/Users/you/Programs"), "Programs");
        assert_eq!(base_label("/Users/you/AndroidApps/"), "AndroidApps");
        assert_eq!(base_label("/"), "/");
        assert_eq!(base_label("Programs"), "Programs");
    }

    #[test]
    fn sort_projects_by_base_groups_then_sorts_by_name() {
        let mut found = vec![
            Project { name: "Zeta".to_string(), path: "/a/Zeta".to_string(), base: "/a".to_string() },
            Project { name: "alfa".to_string(), path: "/b/alfa".to_string(), base: "/b".to_string() },
            Project { name: "Beta".to_string(), path: "/a/Beta".to_string(), base: "/a".to_string() },
        ];
        sort_projects(&mut found, "base");
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        // Base `/a` (label "a") before `/b`; within `/a`, by name.
        assert_eq!(names, vec!["Beta", "Zeta", "alfa"]);

        sort_projects(&mut found, "name");
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["alfa", "Beta", "Zeta"]);

        // Unknown mode falls back to historic name order.
        sort_projects(&mut found, "hyper");
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["alfa", "Beta", "Zeta"]);
    }

    #[test]
    fn open_project_rejects_missing_folders_without_touching_terminals() {
        let err = open_project("/codedock-__no_such__", None, None, "en").unwrap_err();
        assert!(err.contains("no longer exists"));
    }

    #[test]
    fn disabled_filter_hides_only_listed_paths() {
        let mut found = vec![
            Project { name: "Keep".to_string(), path: "/a/Keep".to_string(), base: "/a".to_string() },
            Project { name: "Old".to_string(), path: "/a/Old".to_string(), base: "/a".to_string() },
        ];
        // Empty list keeps everything (historic behavior).
        apply_disabled_filter(&mut found, &[]);
        assert_eq!(found.len(), 2);
        // Trailing slash in the stored entry still matches.
        apply_disabled_filter(&mut found, &["/a/Old/".to_string()]);
        assert_eq!(found.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["Keep"]);
        assert!(is_project_disabled("/a/Old", &["/a/Old".to_string()]));
        assert!(!is_project_disabled("/a/Keep", &["/a/Old".to_string()]));
        // Stale entries match nothing and never panic.
        let mut again = found.clone();
        apply_disabled_filter(&mut again, &["/no/such".to_string()]);
        assert_eq!(again.len(), 1);
    }
}
