//! Search results for web apps (config.json `webApps`); the windows live in crate::webapps.

use fuzzy_matcher::skim::SkimMatcherV2;
use tauri::Url;

use super::{ItemAction, ItemKind, SearchItem, SearchProvider};
use crate::config::WebApp;

pub const ID: &str = "webapps";
/// Typing an app's own keyword ("ds") puts it first.
const KEYWORD_SCORE: i64 = 5_000;
/// A site the user set up ranks a little above apps of the same match quality.
const BONUS: i64 = 25;

/// "https://chat.deepseek.com/a" → "deepseek": the part people remember.
fn site_name(url: &str) -> Option<String> {
    let host = Url::parse(url).ok()?.host_str()?.to_string();
    let parts: Vec<_> = host.split('.').collect();
    let name = if parts.len() >= 2 { parts[parts.len() - 2] } else { parts[0] };
    Some(name.to_string())
}

fn host(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

pub fn item(web: &WebApp, score: i64) -> SearchItem {
    SearchItem {
        title: web.name.clone(),
        subtitle: format!("{} · 网页应用", host(&web.url)),
        score,
        plugin: ID.into(),
        kind: ItemKind::Feature,
        icon: Some(web.url.clone()),
        action: ItemAction::OpenWeb { id: web.id.clone() },
    }
}

pub struct WebApps;

impl SearchProvider for WebApps {
    fn search(&self, query: &str, matcher: &SkimMatcherV2) -> Vec<SearchItem> {
        super::web_apps()
            .iter()
            .filter_map(|web| {
                if web.keywords.iter().any(|k| k.eq_ignore_ascii_case(query)) {
                    return Some(item(web, KEYWORD_SCORE));
                }
                let site = site_name(&web.url);
                [Some(web.name.as_str()), site.as_deref()]
                    .into_iter()
                    .flatten()
                    .chain(web.keywords.iter().map(String::as_str))
                    .filter_map(|text| super::match_text(matcher, text, query))
                    .max()
                    .map(|s| item(web, s + BONUS))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_web_apps;

    #[test]
    fn site_names() {
        assert_eq!(site_name("https://chat.deepseek.com").as_deref(), Some("deepseek"));
        assert_eq!(site_name("https://kimi.com/chat").as_deref(), Some("kimi"));
    }

    #[test]
    fn finds_deepseek_by_keyword_name_and_site() {
        let mut cfg = crate::config::Config::default();
        cfg.web_apps = default_web_apps();
        super::super::configure(&cfg);
        let m = SkimMatcherV2::default().ignore_case();
        for q in ["ds", "deepseek", "DeepSeek", "deep"] {
            let items = WebApps.search(q, &m);
            assert_eq!(items.len(), 1, "query {q}");
            assert_eq!(items[0].action, ItemAction::OpenWeb { id: "deepseek".into() });
        }
        assert_eq!(WebApps.search("ds", &m)[0].score, KEYWORD_SCORE);
        assert!(WebApps.search("kimi", &m).is_empty());
    }
}
