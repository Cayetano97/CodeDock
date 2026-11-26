//! Ignored performance probes for the backend hot paths.
//!
//! Run them with:
//!
//! ```sh
//! cargo test --release -- --ignored --nocapture perf_
//! ```
//!
//! They build synthetic folder trees in the system temp dir (never the user's
//! real bases), time the pure backend functions and print ns/op so before/after
//! numbers are directly comparable. Ignored by default so `cargo test` stays
//! fast and deterministic.

use std::hint::black_box;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::{config, projects, terminal};

fn temp_tree(tag: &str, bases: usize, per_base: usize) -> (PathBuf, Vec<String>) {
    let root = std::env::temp_dir().join(format!("codedock-perf-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let mut base_dirs = Vec::with_capacity(bases);
    for b in 0..bases {
        let base = root.join(format!("base-{b}"));
        std::fs::create_dir_all(&base).unwrap();
        for p in 0..per_base {
            std::fs::create_dir_all(base.join(format!("project-{p:04}"))).unwrap();
        }
        base_dirs.push(base.to_string_lossy().into_owned());
    }
    (root, base_dirs)
}

fn synthetic_projects(count: usize) -> Vec<projects::Project> {
    (0..count)
        .map(|i| projects::Project {
            name: format!("Project-{i:04}"),
            path: format!("/Users/you/Programs/batch-{}/Project-{i:04}", i % 8),
            base: format!("/Users/you/Programs/batch-{}", i % 8),
        })
        .collect()
}

fn report(label: &str, elapsed: Duration, iters: u32) {
    let per = elapsed / iters;
    println!("{label:<44} {per:>12?}  ({} ns/op)", per.as_nanos());
}

#[test]
#[ignore]
fn perf_list_projects_1k() {
    let (root, base_dirs) = temp_tree("scan", 4, 250);
    let iters = 50;
    // Warm the page cache before timing.
    black_box(projects::list_projects(&base_dirs, "en"));
    let start = Instant::now();
    for _ in 0..iters {
        black_box(projects::list_projects(black_box(&base_dirs), "en"));
    }
    report("list_projects (4 bases x 250 dirs)", start.elapsed(), iters);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
#[ignore]
fn perf_sort_projects_5k() {
    let source = synthetic_projects(5_000);
    let iters = 20;
    for mode in ["name", "base"] {
        let mut total = Duration::ZERO;
        for _ in 0..iters {
            let mut list = source.clone();
            let start = Instant::now();
            projects::sort_projects(&mut list, mode);
            total += start.elapsed();
            black_box(list);
        }
        report(&format!("sort_projects 5k ({mode})"), total, iters);
    }
}

#[test]
#[ignore]
fn perf_disabled_filter_1k_100() {
    let source = synthetic_projects(1_000);
    let disabled: Vec<String> = (0..100)
        .map(|i| format!("/Users/you/Programs/batch-{}/Project-{i:04}", i % 8))
        .collect();
    let iters = 200;
    let mut total = Duration::ZERO;
    for _ in 0..iters {
        let mut list = source.clone();
        let start = Instant::now();
        projects::apply_disabled_filter(&mut list, black_box(&disabled));
        total += start.elapsed();
        black_box(list);
    }
    report("apply_disabled_filter 1k/100", total, iters);
}

#[test]
#[ignore]
fn perf_disabled_filter_1k_4() {
    // The common real config: a handful of hidden projects.
    let source = synthetic_projects(1_000);
    let disabled: Vec<String> = (0..4)
        .map(|i| format!("/Users/you/Programs/batch-{}/Project-{i:04}", i % 8))
        .collect();
    let iters = 500;
    let mut total = Duration::ZERO;
    for _ in 0..iters {
        let mut list = source.clone();
        let start = Instant::now();
        projects::apply_disabled_filter(&mut list, black_box(&disabled));
        total += start.elapsed();
        black_box(list);
    }
    report("apply_disabled_filter 1k/4 (direct scan)", total, iters);
}

#[test]
#[ignore]
fn perf_parse_config() {
    let text = r#"{
        "baseDirs": ["/Users/you/Documents/Programs", "/Users/you/Documents/Webs", "/Users/you/Documents/AndroidApps"],
        "disabledProjects": ["/Users/you/Documents/Webs/FreeServiceIndex", "/Users/you/Documents/Programs/Docs"],
        "terminal": "ghostty",
        "sortMode": "base",
        "language": "es",
        "theme": "codedock-dark"
    }"#;
    let iters = 20_000;
    // Warm regex/serde internals.
    black_box(config::parse_config(text).unwrap());
    let start = Instant::now();
    for _ in 0..iters {
        black_box(config::parse_config(black_box(text)).unwrap());
    }
    report("parse_config (realistic)", start.elapsed(), iters);
}

#[test]
#[ignore]
fn perf_detect_terminals() {
    let iters = 200;
    black_box(terminal::detect_terminals());
    let start = Instant::now();
    for _ in 0..iters {
        black_box(terminal::detect_terminals());
    }
    report("detect_terminals", start.elapsed(), iters);
}

#[test]
#[ignore]
fn perf_tray_dots() {
    // The tray rebuild regenerates the 8 dot images on every refresh.
    let iters = 500;
    black_box(crate::tray_dot_images());
    let start = Instant::now();
    for _ in 0..iters {
        black_box(crate::tray_dot_images());
    }
    report("tray_dot_images (8 x 36px)", start.elapsed(), iters);
}
