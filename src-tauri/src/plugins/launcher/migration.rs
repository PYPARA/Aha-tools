//! A recoverable multi-file migration. The journal holds originals until every write succeeds.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path};

pub fn saved_id(path: &str) -> String {
    format!("saved-{:x}", Sha256::digest(path.as_bytes()))
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("收藏目录不存在")?)
        .map_err(|e| e.to_string())?;
    use std::io::Write;
    tmp.write_all(bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn rewrite(value: &mut Value, ids: &HashMap<String, String>) {
    match value {
        Value::Array(values) => {
            for v in values {
                rewrite(v, ids);
            }
        }
        Value::Object(map) => {
            if map.get("plugin").and_then(Value::as_str) == Some("launcher")
                && map.get("kind").and_then(Value::as_str) == Some("saved")
            {
                if let Some(id) = map
                    .get("action")
                    .filter(|a| a["type"] == "openPath")
                    .and_then(|a| a["path"].as_str())
                    .and_then(|p| ids.get(p))
                {
                    map.insert("action".into(), json!({"type":"openSaved", "id":id}));
                }
            }
            for (key, v) in map.iter_mut() {
                if key == "key" {
                    if let Some(old) = v.as_str() {
                        if let Some(action) = old
                            .strip_prefix("launcher\u{1f}")
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        {
                            if action["type"] == "openPath" {
                                if let Some(id) = action["path"].as_str().and_then(|p| ids.get(p)) {
                                    *v = Value::String(format!(
                                        "launcher\u{1f}{{\"type\":\"openSaved\",\"id\":{}}}",
                                        serde_json::to_string(id).unwrap()
                                    ));
                                }
                            }
                        }
                    }
                } else {
                    rewrite(v, ids);
                }
            }
        }
        _ => {}
    }
}
fn restore(root: &Path, originals: &HashMap<String, String>) -> Result<(), String> {
    for (name, bytes) in originals {
        atomic(&root.join(name), bytes.as_bytes())?;
    }
    Ok(())
}
pub fn run(root: &Path) -> Result<(), String> {
    let journal = root.join("launcher-migration.json");
    if journal.exists() {
        let originals: HashMap<String, String> =
            serde_json::from_slice(&fs::read(&journal).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if originals
            .keys()
            .any(|k| !["launcher.json", "usage.json", "config.json"].contains(&k.as_str()))
        {
            return Err("收藏迁移记录无效".into());
        }
        restore(root, &originals)?;
        fs::remove_file(&journal).map_err(|e| e.to_string())?;
    }
    let path = root.join("launcher.json");
    if !path.exists() {
        return Ok(());
    }
    let original = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut entries: Vec<Value> =
        serde_json::from_str(&original).map_err(|e| format!("收藏文件损坏：{e}"))?;
    let mut ids = HashMap::new();
    let mut changed = false;
    for entry in &mut entries {
        let path = entry["path"].as_str().ok_or("收藏缺少路径")?.to_owned();
        if entry["id"].as_str().is_none_or(str::is_empty) {
            entry["id"] = Value::String(saved_id(&path));
            changed = true;
        }
        ids.insert(path, entry["id"].as_str().ok_or("收藏 ID 无效")?.to_owned());
    }
    let mut originals = HashMap::from([("launcher.json".into(), original)]);
    let mut output = HashMap::from([(
        "launcher.json".to_string(),
        serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
    )]);
    for name in ["usage.json", "config.json"] {
        let path = root.join(name);
        if !path.exists() {
            continue;
        }
        let bytes = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut value: Value =
            serde_json::from_str(&bytes).map_err(|e| format!("{name} 无法读取：{e}"))?;
        let old = value.clone();
        rewrite(&mut value, &ids);
        changed |= old != value;
        originals.insert(name.into(), bytes);
        output.insert(
            name.into(),
            serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
        );
    }
    if !changed {
        return Ok(());
    }
    atomic(
        &journal,
        &serde_json::to_vec(&originals).map_err(|e| e.to_string())?,
    )?;
    for (name, bytes) in output {
        if let Err(error) = atomic(&root.join(name), &bytes) {
            restore(root, &originals)?;
            fs::remove_file(&journal).map_err(|e| e.to_string())?;
            return Err(error);
        }
    }
    fs::remove_file(journal).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_ids_pins_and_learning_once() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(
            root.join("launcher.json"),
            r#"[{"name":"配置","path":"~/中文 ' 文件"}]"#,
        )
        .unwrap();
        let item = json!({"plugin":"launcher","kind":"saved","title":"配置","action":{"type":"openPath","path":"~/中文 ' 文件"}});
        let key = format!(
            "launcher\u{1f}{}",
            json!({"type":"openPath","path":"~/中文 ' 文件"})
        );
        fs::write(root.join("usage.json"), json!({"recent":[item.clone()],"pinned":[item.clone()],"stats":[{"key":key,"count":9,"last":10}],"picks":[]}).to_string()).unwrap();
        fs::write(
            root.join("config.json"),
            json!({"appearance":"dark","superPanel":{"pinned":[item]}}).to_string(),
        )
        .unwrap();
        run(root).unwrap();
        let before = fs::read(root.join("usage.json")).unwrap();
        run(root).unwrap();
        assert_eq!(before, fs::read(root.join("usage.json")).unwrap());
        let usage: Value = serde_json::from_slice(&before).unwrap();
        assert_eq!(usage["pinned"][0]["action"]["type"], "openSaved");
        assert_eq!(usage["stats"][0]["count"], 9);
        assert_eq!(
            usage["stats"][0]["key"],
            format!(
                "launcher\u{1f}{}",
                serde_json::to_string(&crate::plugins::ItemAction::OpenSaved {
                    id: saved_id("~/中文 ' 文件")
                })
                .unwrap()
            )
        );
        let cfg: Value =
            serde_json::from_slice(&fs::read(root.join("config.json")).unwrap()).unwrap();
        assert_eq!(cfg["appearance"], "dark");
        assert_eq!(
            cfg["superPanel"]["pinned"][0]["action"]["type"],
            "openSaved"
        );
    }
    #[test]
    fn interrupted_migration_recovers_every_original_before_retrying() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let original = r#"[{"name":"原收藏","path":"/original"}]"#;
        fs::write(
            root.join("launcher.json"),
            r#"[{"id":"partial","name":"中间状态","path":"/other"}]"#,
        )
        .unwrap();
        fs::write(root.join("usage.json"), "broken-partial-write").unwrap();
        fs::write(root.join("launcher-migration.json"),json!({"launcher.json":original,"usage.json":"{\"recent\":[],\"pinned\":[],\"stats\":[],\"picks\":[]}"}).to_string()).unwrap();
        run(root).unwrap();
        let saved: Value =
            serde_json::from_slice(&fs::read(root.join("launcher.json")).unwrap()).unwrap();
        assert_eq!(saved[0]["path"], "/original");
        assert_eq!(saved[0]["id"], saved_id("/original"));
        assert!(!root.join("launcher-migration.json").exists());
    }
    #[test]
    fn corrupt_companion_preserves_original_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let original = r#"[{"name":"a","path":"/a"}]"#;
        fs::write(root.join("launcher.json"), original).unwrap();
        fs::write(root.join("usage.json"), "broken").unwrap();
        assert!(run(root).is_err());
        assert_eq!(
            fs::read_to_string(root.join("launcher.json")).unwrap(),
            original
        );
    }
}
