use super::*;
use std::{cell::RefCell, path::PathBuf};

fn scheme(id: &str, content: &str, enabled: bool) -> HostScheme {
    HostScheme {
        id: id.into(),
        name: id.into(),
        content: content.into(),
        enabled,
    }
}

#[test]
fn insert_replace_and_remove_preserve_system_bytes() {
    let original = "# 系统原文\r\n127.0.0.1 localhost\r\n\r\n";
    let profile = scheme("dev", "# 开发环境\n10.0.0.1 dev.test", true);
    let inserted = merge(original, &[profile]).unwrap();
    assert_eq!(
        inserted,
        format!("{original}{START}\r\n# 开发环境\r\n10.0.0.1 dev.test\r\n{END}\r\n")
    );
    let with_tail = format!("{inserted}# 其他工具追加\r\n10.2.0.1 other.test");
    let replaced = merge(&with_tail, &[scheme("x", "::1 v6.test", true)]).unwrap();
    assert_eq!(
        replaced,
        format!(
            "{original}{START}\r\n::1 v6.test\r\n{END}\r\n# 其他工具追加\r\n10.2.0.1 other.test"
        )
    );
    assert_eq!(
        merge(&replaced, &[]).unwrap(),
        format!("{original}# 其他工具追加\r\n10.2.0.1 other.test")
    );
}

#[test]
fn merge_handles_empty_missing_newline_disabled_and_empty_profiles() {
    let profiles = [
        scheme("a", "1.2.3.4 one", true),
        scheme("b", "5.6.7.8 two", false),
        scheme("c", "", true),
    ];
    assert_eq!(
        merge("", &profiles).unwrap(),
        format!("{START}\n1.2.3.4 one\n{END}\n")
    );
    assert_eq!(
        merge("# no newline", &profiles).unwrap(),
        format!("# no newline\n{START}\n1.2.3.4 one\n{END}\n")
    );
    assert_eq!(merge("# no newline", &[]).unwrap(), "# no newline");
    assert_eq!(
        merge(&format!("{START}\n1.2.3.4 old\n{END}"), &[]).unwrap(),
        ""
    );
    assert_eq!(merge("", &[scheme("a", "  \n\t", true)]).unwrap(), "");
}

#[test]
fn malformed_and_repeated_markers_are_never_repaired_by_guessing() {
    for text in [
        format!("{START}\nx"),
        END.into(),
        format!("{START}\n{START}\n{END}"),
        format!("{START}\n{END}\n{START}\n{END}"),
        format!("{START}\n{END}\n{END}"),
    ] {
        assert!(merge(&text, &[]).is_err(), "{text}");
    }
    assert!(
        marker_range(&format!("# prefix {START}\n {END}\n"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn supports_addresses_aliases_tabs_and_comments() {
    let text = "# 注释\n\n127.0.0.1\tlocalhost local alias.test # comment\n::1 local\n2001:db8::1 one.test two.test\n";
    let validation = validate(
        &[scheme("a", text, true)],
        "127.0.0.1 localhost\n::1 local\n",
    );
    assert!(validation.issues.is_empty(), "{:?}", validation.issues);
    assert_eq!(validation.counts["a"], 3);
}

#[test]
fn rejects_invalid_ip_names_controls_and_reserved_markers() {
    for content in [
        "999.1.2.3 host",
        "1.2.3.4",
        "1.2.3.4 https://host",
        "1.2.3.4 host:80",
        "1.2.3.4 *.test",
        "1.2.3.4 foo..test",
        "1.2.3.4 host\0",
        "# comment\u{1b}",
        START,
        END,
    ] {
        let validation = validate(&[scheme("a", content, true)], "");
        assert!(
            validation
                .issues
                .iter()
                .any(|i| i.blocking && i.location.line == 1),
            "{content}"
        );
    }
}

#[test]
fn disabled_syntax_errors_are_visible_but_do_not_block() {
    let validation = validate(
        &[
            scheme("draft", "invalid", false),
            scheme("a", "1.2.3.4 host", true),
        ],
        "",
    );
    assert_eq!(validation.issues.len(), 1);
    assert!(!validation.issues[0].blocking);
    assert_eq!(
        validation.issues[0].location.scheme_id.as_deref(),
        Some("draft")
    );
    assert_eq!(validation.counts["draft"], 0);
}

#[test]
fn conflicts_include_internal_other_profiles_and_system_line_numbers() {
    let validation = validate(
        &[
            scheme("a", "2.2.2.2 HOST\n3.3.3.3 host", true),
            scheme("b", "4.4.4.4 host", true),
        ],
        "# preserved\n1.1.1.1 host\n",
    );
    assert_eq!(validation.issues.len(), 3);
    let last = validation.issues.last().unwrap();
    assert_eq!(last.related.len(), 3);
    assert_eq!(
        last.related[0],
        Location {
            scheme_id: None,
            line: 2
        }
    );
    assert_eq!(
        last.related[1],
        Location {
            scheme_id: Some("a".into()),
            line: 1
        }
    );
    assert!(validation.issues.iter().all(|i| i.blocking));
}

#[test]
fn equal_addresses_and_dual_stack_are_allowed_old_managed_entries_are_ignored() {
    let system = format!(
        "# preserved\n1.1.1.1 host\n{START}\n2.2.2.2 host\n{END}\nnot valid but preserved\n"
    );
    let validation = validate(
        &[scheme(
            "a",
            "1.1.1.1 HOST. host\n::1 host\n0:0:0:0:0:0:0:1 HOST",
            true,
        )],
        &system,
    );
    assert!(validation.issues.is_empty(), "{:?}", validation.issues);
}

#[test]
fn invalid_metadata_cannot_overwrite_the_saved_list() {
    for list in [
        vec![scheme("", "", false)],
        vec![scheme("a", "", false), scheme("a", "", false)],
    ] {
        assert!(validate(&list, "").issues.iter().any(|i| i.blocking));
    }
}

struct FakeSystem {
    current: RefCell<String>,
    behavior: &'static str,
    saved: PathBuf,
    gate: Mutex<()>,
}

impl FakeSystem {
    fn new(dir: &Path, behavior: &'static str) -> Self {
        Self {
            current: RefCell::new("# 系统\n127.0.0.1 localhost\n".into()),
            behavior,
            saved: dir.join("hosts.json"),
            gate: Mutex::new(()),
        }
    }
}

impl System for FakeSystem {
    fn read(&self) -> Result<String, String> {
        Ok(self.current.borrow().clone())
    }
    fn apply(&self, expected: &str, candidate: &str) -> Result<NativeOutcome, String> {
        assert_eq!(expected, self.read().unwrap());
        match self.behavior {
            "cancel" => return Ok(NativeOutcome::Cancelled),
            "external" => {
                self.current.borrow_mut().push_str("# 外部追加\n");
                return Ok(NativeOutcome::Stale);
            }
            "fail" => return Err("无法写入".into()),
            "mismatch" => return Ok(NativeOutcome::Applied { dns_flushed: true }),
            _ => {}
        }
        *self.current.borrow_mut() = candidate.into();
        if self.behavior == "save-fail" {
            fs::create_dir(&self.saved).unwrap();
        }
        if self.behavior == "saved-external" {
            fs::write(&self.saved, b"[]\n").unwrap();
        }
        Ok(NativeOutcome::Applied {
            dns_flushed: self.behavior != "dns-fail",
        })
    }
}

fn run(dir: &Path, system: &FakeSystem, profiles: Option<Vec<HostScheme>>) -> Operation {
    let revision = load(dir, system).unwrap().revision;
    operate(dir, system, &system.gate, profiles, &revision).unwrap()
}

#[test]
fn missing_and_corrupt_data_are_distinguished_and_original_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let system = FakeSystem::new(dir.path(), "ok");
    assert!(load(dir.path(), &system).unwrap().schemes.is_empty());
    ensure_backup(dir.path(), "原始\n").unwrap();
    ensure_backup(dir.path(), "不应覆盖\n").unwrap();
    assert_eq!(
        load(dir.path(), &system).unwrap().original.unwrap(),
        "原始\n"
    );
    fs::write(&system.saved, b"broken").unwrap();
    assert!(
        load(dir.path(), &system)
            .unwrap_err()
            .contains("原文件已保留")
    );
    assert_eq!(fs::read(&system.saved).unwrap(), b"broken");
}

#[test]
fn cancelled_failed_and_external_transactions_leave_saved_profiles_unchanged() {
    for behavior in ["cancel", "fail", "external", "mismatch"] {
        let dir = tempfile::tempdir().unwrap();
        let system = FakeSystem::new(dir.path(), behavior);
        atomic_save(dir.path(), &[]).unwrap();
        let before = fs::read(&system.saved).unwrap();
        let result = run(
            dir.path(),
            &system,
            Some(vec![scheme("a", "1.2.3.4 host", true)]),
        );
        assert!(
            !result.system_written && !result.profiles_saved,
            "{behavior}"
        );
        assert_eq!(result.cancelled, behavior == "cancel");
        assert_eq!(fs::read(&system.saved).unwrap(), before);
        if behavior == "external" {
            assert!(system.read().unwrap().ends_with("# 外部追加\n"));
        }
    }
}

#[test]
fn successful_write_saves_disabled_invalid_drafts_and_dns_failure_is_partial_success() {
    for behavior in ["ok", "dns-fail"] {
        let dir = tempfile::tempdir().unwrap();
        let system = FakeSystem::new(dir.path(), behavior);
        let list = vec![
            scheme("a", "1.2.3.4 host", true),
            scheme("draft", "invalid", false),
        ];
        let result = run(dir.path(), &system, Some(list.clone()));
        assert!(result.system_written && result.profiles_saved);
        assert_eq!(result.dns_flushed, behavior == "ok");
        assert_eq!(load(dir.path(), &system).unwrap().schemes, list);
        assert!(result.snapshot.unwrap().matches_saved);
        assert_eq!(result.error.is_some(), behavior != "ok");
    }
}

#[test]
fn local_save_failure_never_masquerades_as_complete_success() {
    for behavior in ["save-fail", "saved-external"] {
        let dir = tempfile::tempdir().unwrap();
        let system = FakeSystem::new(dir.path(), behavior);
        let result = run(
            dir.path(),
            &system,
            Some(vec![scheme("a", "1.2.3.4 host", true)]),
        );
        assert!(result.system_written && result.dns_flushed && !result.profiles_saved);
        assert!(result.error.unwrap().contains("方案保存失败"));
        assert!(system.read().unwrap().contains("1.2.3.4 host"));
    }
}

#[test]
fn restoration_removes_only_our_block_and_disables_saved_profiles_even_with_syntax_errors() {
    let dir = tempfile::tempdir().unwrap();
    let system = FakeSystem::new(dir.path(), "ok");
    atomic_save(dir.path(), &[scheme("a", "invalid", true)]).unwrap();
    let original = system.read().unwrap();
    *system.current.borrow_mut() = format!("{original}{START}\n1.2.3.4 host\n{END}\n# external\n");
    let result = run(dir.path(), &system, None);
    assert!(result.system_written && result.profiles_saved && result.dns_flushed);
    assert_eq!(system.read().unwrap(), format!("{original}# external\n"));
    assert!(!result.snapshot.unwrap().schemes[0].enabled);
}

#[test]
fn stale_revision_and_busy_gate_block_before_any_side_effect() {
    let dir = tempfile::tempdir().unwrap();
    let system = FakeSystem::new(dir.path(), "ok");
    let revision = load(dir.path(), &system).unwrap().revision;
    system.current.borrow_mut().push_str("# external\n");
    assert!(
        operate(dir.path(), &system, &system.gate, Some(vec![]), &revision)
            .unwrap_err()
            .contains("外部修改")
    );
    assert!(!dir.path().join("hosts.original").exists());
    let revision = load(dir.path(), &system).unwrap().revision;
    let _guard = system.gate.lock().unwrap();
    assert!(
        operate(dir.path(), &system, &system.gate, None, &revision)
            .unwrap_err()
            .contains("等待")
    );
}

#[test]
fn saved_revision_change_and_unusable_backup_abort_before_system_write() {
    let dir = tempfile::tempdir().unwrap();
    let system = FakeSystem::new(dir.path(), "ok");
    let before = system.read().unwrap();
    let old_revision = load(dir.path(), &system).unwrap().revision;
    atomic_save(dir.path(), &[]).unwrap();
    assert!(operate(dir.path(), &system, &system.gate, None, &old_revision).is_err());
    fs::create_dir(dir.path().join("hosts.original")).unwrap();
    let current_revision = revision(&before, Some(b"[]"));
    assert!(operate(dir.path(), &system, &system.gate, None, &current_revision).is_err());
    assert_eq!(system.read().unwrap(), before);
}

#[test]
fn fixed_shell_script_retains_mode_cleans_staging_and_checks_authorization_race() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let dir = tempfile::Builder::new()
        .prefix("ahatools hosts ' 测试-")
        .tempdir()
        .unwrap();
    let target = dir.path().join("hosts");
    let expected = dir.path().join("expected");
    let candidate = dir.path().join("candidate");
    fs::write(&target, "original\n").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).unwrap();
    fs::write(&expected, "original\n").unwrap();
    fs::write(&candidate, "updated\n").unwrap();
    let script = WRITE_SCRIPT
        .replace(
            "target=/private/etc/hosts",
            &format!("target={}", shell_quote(&target.to_string_lossy())),
        )
        .replace(
            "/private/etc/.ahatools-hosts.XXXXXXXX",
            &shell_quote(&dir.path().join("stage.XXXXXXXX").to_string_lossy()),
        )
        .replace("/usr/bin/dscacheutil -flushcache", "/usr/bin/true")
        .replace("/usr/bin/killall -HUP mDNSResponder", "/usr/bin/true");
    let execute = || {
        Command::new("/bin/sh")
            .args(["-c", &script, "--"])
            .arg(&expected)
            .arg(&candidate)
            .output()
            .unwrap()
    };
    let result = execute();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(result.stdout, b"AHATOOLS_OK");
    assert_eq!(fs::read(&target).unwrap(), b"updated\n");
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o644
    );
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
    let inode = fs::metadata(&target).unwrap().ino();
    fs::write(&expected, "updated\n").unwrap();
    assert_eq!(execute().stdout, b"AHATOOLS_OK");
    assert_eq!(
        fs::metadata(&target).unwrap().ino(),
        inode,
        "No-op keeps the original file"
    );
    let failed_dns = Command::new("/bin/sh")
        .args([
            "-c",
            &script.replace("/usr/bin/true", "/usr/bin/false"),
            "--",
        ])
        .arg(&expected)
        .arg(&candidate)
        .output()
        .unwrap();
    assert!(failed_dns.status.success());
    assert_eq!(failed_dns.stdout, b"AHATOOLS_DNS_WARN");
    fs::write(&target, "external\n").unwrap();
    assert_eq!(execute().status.code(), Some(73));
    assert_eq!(fs::read(&target).unwrap(), b"external\n");
}

#[test]
fn both_keywords_resolve_to_the_hosts_plugin() {
    let registry = crate::plugins::Registry::new();
    for keyword in ["host", "hosts"] {
        assert!(registry.search(keyword).iter().any(|item| item.plugin == "hosts" &&
            matches!(&item.action, crate::plugins::ItemAction::Feature { feature, .. } if feature == "hosts")));
    }
}

#[test]
fn shell_arguments_are_data_even_with_quotes_dollars_backticks_and_newlines() {
    let text = "a ' quote $(touch /unwanted) `no` \\ end\n中文";
    let output = Command::new("/bin/sh")
        .args(["-c", &format!("/usr/bin/printf %s {}", shell_quote(text))])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, text.as_bytes());
}
