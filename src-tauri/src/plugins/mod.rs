//! Plugin registry.
//!
//! A plugin is a directory under `/plugins/<id>/` with a `plugin.json` manifest and
//! React views. Plugins that need native code add a module here and, if they produce
//! search results, a `SearchProvider`.
//!
//! Built-in plugins are compiled in. External plugins (loaded from disk at runtime)
//! will use the same manifest format.

pub mod launcher;

use std::collections::HashMap;
use std::sync::Arc;
use std::thread;

use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

const BUILTIN_MANIFESTS: &[&str] = &[
    include_str!("../../../plugins/launcher/plugin.json"),
    include_str!("../../../plugins/hotkeys/plugin.json"),
];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Contributes results to every search via a native `SearchProvider`.
    #[serde(default)]
    pub search_provider: bool,
    #[serde(default)]
    pub features: Vec<Feature>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    /// Matches a view registered under `<plugin id>/<code>` in the frontend.
    pub code: String,
    pub explain: String,
    /// Keywords that surface this feature in search.
    pub cmds: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub title: String,
    pub subtitle: String,
    pub score: i64,
    pub plugin: String,
    pub kind: ItemKind,
    /// For saved paths: "folder", "file" or "link".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<&'static str>,
    pub action: ItemAction,
}

/// What the result is, for its icon and label in the list.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    App,
    Saved,
    Feature,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ItemAction {
    /// Open a file, folder, app or URL with the system default handler.
    OpenPath { path: String },
    /// Enter a plugin feature's view.
    Feature { feature: String },
}

pub trait SearchProvider: Send + Sync {
    fn search(&self, query: &str, matcher: &SkimMatcherV2) -> Vec<SearchItem>;
    /// Called in the background each time the panel opens.
    fn refresh(&self) {}
}

pub struct Registry {
    pub manifests: Vec<Manifest>,
    providers: HashMap<String, Arc<dyn SearchProvider>>,
}

const MAX_RESULTS: usize = 30;

impl Registry {
    pub fn new() -> Self {
        let manifests = BUILTIN_MANIFESTS
            .iter()
            .map(|s| serde_json::from_str(s).expect("invalid built-in plugin.json"))
            .collect();
        Registry {
            manifests,
            providers: HashMap::new(),
        }
    }

    pub fn add_provider(&mut self, plugin_id: &str, provider: Arc<dyn SearchProvider>) {
        self.providers.insert(plugin_id.to_string(), provider);
    }

    pub fn search(&self, query: &str) -> Vec<SearchItem> {
        let query = query.trim();
        if query.is_empty() {
            return vec![];
        }
        let matcher = SkimMatcherV2::default().ignore_case();
        let mut items = vec![];

        for m in &self.manifests {
            for f in &m.features {
                let best = f
                    .cmds
                    .iter()
                    .filter_map(|cmd| matcher.fuzzy_match(cmd, query))
                    .max();
                if let Some(score) = best {
                    items.push(SearchItem {
                        title: f.explain.clone(),
                        subtitle: format!("{} · 插件功能", m.name),
                        // Plugin features rank above files for the same match quality.
                        score: score + 20,
                        plugin: m.id.clone(),
                        kind: ItemKind::Feature,
                        icon: None,
                        action: ItemAction::Feature {
                            feature: f.code.clone(),
                        },
                    });
                }
            }
            if m.search_provider {
                if let Some(p) = self.providers.get(&m.id) {
                    items.extend(p.search(query, &matcher));
                }
            }
        }

        items.sort_by(|a, b| b.score.cmp(&a.score));
        items.truncate(MAX_RESULTS);
        items
    }
}

pub fn on_panel_shown<R: Runtime>(app: &AppHandle<R>) {
    let Some(registry) = app.try_state::<Registry>() else {
        return;
    };
    for p in registry.providers.values() {
        let p = p.clone();
        thread::spawn(move || p.refresh());
    }
}

#[tauri::command]
pub fn list_plugins(registry: State<Registry>) -> Vec<Manifest> {
    registry.manifests.clone()
}

#[tauri::command]
pub fn search(registry: State<Registry>, query: String) -> Vec<SearchItem> {
    registry.search(&query)
}

/// "~/x" → "$HOME/x"; anything else unchanged.
pub fn expand_home(path: &str) -> String {
    match (path.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => path.to_string(),
    }
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    // `open` doesn't expand "~"; saved paths may be typed by hand.
    let target = expand_home(&path);
    std::process::Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("无法打开 {path}: {e}"))?;
    crate::panel::hide(&app);
    Ok(())
}
