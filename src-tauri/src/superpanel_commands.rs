//! Shell templates accept placeholders only as standalone, unquoted arguments.
use crate::context::Context;

const NAMES: [&str; 4] = ["path", "dir", "text", "name"];
fn boundary(c: Option<char>) -> bool {
    c.is_none_or(|c| c.is_whitespace() || ";|&()< >".contains(c))
}

pub fn validate(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("请输入命令".into());
    }
    let chars: Vec<char> = command.chars().collect();
    let (mut quote, mut escaped, mut sub, mut comment) = (None, false, 0usize, false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let placeholder = NAMES.iter().find(|n| {
            chars[i..]
                .iter()
                .collect::<String>()
                .starts_with(&format!("{{{n}}}"))
        });
        if let Some(name) = placeholder {
            let end = i + name.len() + 2;
            if quote.is_some()
                || escaped
                || sub > 0
                || comment
                || !boundary(i.checked_sub(1).map(|j| chars[j]))
                || !boundary(chars.get(end).copied())
            {
                return Err(format!(
                    "{{{name}}} 要单独放在参数位置，不要加引号或嵌入脚本。例如：code {{path}}"
                ));
            }
            i = end;
            continue;
        }
        if comment {
            if c == '\n' {
                comment = false;
            }
            i += 1;
            continue;
        }
        if escaped {
            escaped = false;
            i += 1;
            continue;
        }
        match quote {
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                }
            }
            Some(q) => {
                if c == '\\' {
                    escaped = true;
                } else if c == q {
                    quote = None;
                }
            }
            None => {
                if c == '\\' {
                    escaped = true;
                } else if c == '\'' || c == '"' || c == '`' {
                    quote = Some(c);
                } else if c == '$' && chars.get(i + 1) == Some(&'(') {
                    sub += 1;
                    i += 1;
                } else if c == '(' && sub > 0 {
                    sub += 1;
                } else if c == ')' {
                    sub = sub.saturating_sub(1);
                } else if c == '#' && boundary(i.checked_sub(1).map(|j| chars[j])) {
                    comment = true;
                }
            }
        }
        i += 1;
    }
    if quote.is_some() || escaped || sub > 0 {
        return Err("命令的引号或括号没有闭合".into());
    }
    // A here-document has its own quoting rules; templates there cannot be escaped safely.
    if command.contains("<<") && NAMES.iter().any(|n| command.contains(&format!("{{{n}}}"))) {
        return Err("含占位符的命令不能使用 here-document（<<），请改用脚本文件接收参数".into());
    }
    Ok(())
}
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub fn expand(command: &str, ctx: &Context) -> Result<String, String> {
    validate(command)?;
    let paths = ctx
        .paths
        .iter()
        .map(|p| quote(p))
        .collect::<Vec<_>>()
        .join(" ");
    let names = ctx
        .paths
        .iter()
        .map(|p| {
            quote(
                &std::path::Path::new(p)
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| p.clone()),
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut out = String::new();
    let mut rest = command;
    // Single pass: text containing {path} is never interpreted as another placeholder.
    while !rest.is_empty() {
        if let Some(n) = NAMES.iter().find(|n| rest.starts_with(&format!("{{{n}}}"))) {
            let value = match *n {
                "path" if !ctx.paths.is_empty() => paths.clone(),
                "name" if !ctx.paths.is_empty() => names.clone(),
                "dir" => quote(ctx.dir.as_deref().ok_or("无法确定所在文件夹")?),
                "text" => quote(ctx.text.as_deref().ok_or("没有选中文字")?),
                _ => return Err("没有选中文件".into()),
            };
            out.push_str(&value);
            rest = &rest[n.len() + 2..];
        } else {
            let c = rest.chars().next().unwrap();
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_quoted_embedded_and_substitution_slots() {
        for s in [
            "echo '{text}'",
            "echo \"{text}\"",
            "echo prefix{path}",
            "echo $(echo {path})",
            "echo `{text}`",
            "cat <<EOF\n{text}\nEOF",
            "echo \\{text}",
            "echo # {text}",
        ] {
            assert!(validate(s).is_err(), "{s}");
        }
        assert!(validate("code {path} && echo {dir}").is_ok());
    }
    #[test]
    fn multiple_paths_stay_separate_shell_arguments() {
        let paths = vec![
            "/tmp/有 空格.png".to_string(),
            "/tmp/a'b\"c.txt".into(),
            "/tmp/a\nb;$(pwd)`id`.txt".into(),
        ];
        let ctx = Context {
            paths: paths.clone(),
            ..Context::default()
        };
        let command = expand(r#"printf '%s\0' {path}"#, &ctx).unwrap();
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &command])
            .output()
            .unwrap();
        let got: Vec<_> = output
            .stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8(s.to_vec()).unwrap())
            .collect();
        assert_eq!(got, paths);
    }
    #[test]
    fn hostile_values_are_literal_and_single_pass() {
        for value in [
            "有 空格",
            "a'b\"c",
            "a\nb",
            "; touch /tmp/no",
            "`pwd`",
            "$(pwd)",
            "{path}",
        ] {
            let ctx = Context {
                text: Some(value.into()),
                ..Context::default()
            };
            let cmd = expand("printf '%s' {text}", &ctx).unwrap();
            let out = std::process::Command::new("/bin/sh")
                .args(["-c", &cmd])
                .output()
                .unwrap();
            assert_eq!(String::from_utf8(out.stdout).unwrap(), value);
        }
    }
}

/// Bound command lifetime and output; a stuck child must not hold the panel open.
pub fn execute(command: &str, dir: Option<&str>) -> Result<(), String> {
    use std::{
        io::Read,
        os::unix::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", command])
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().map_err(|e| format!("无法运行命令：{e}"))?;
    let mut err = child.stderr.take().unwrap();
    use std::{
        os::fd::AsRawFd,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
    };
    unsafe {
        let fd = err.as_raw_fd();
        let flags = libc::fcntl(fd, libc::F_GETFL);
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
    let done = Arc::new(AtomicBool::new(false));
    let reader_done = done.clone();
    let reader = std::thread::spawn(move || {
        let mut sample = Vec::new();
        let mut buf = [0; 1024];
        loop {
            match err.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let keep = (4096usize.saturating_sub(sample.len())).min(n);
                    sample.extend_from_slice(&buf[..keep]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if reader_done.load(Ordering::Acquire) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
        sample
    });
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            done.store(true, Ordering::Release);
            if status.success() {
                let _ = reader.join();
                return Ok(());
            }
            // Kill remaining pipeline descendants before waiting for stderr EOF.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let bytes = reader.join().unwrap_or_default();
            return Err(format!(
                "命令执行失败：{}",
                String::from_utf8_lossy(&bytes).trim()
            ));
        }
        if start.elapsed() > Duration::from_secs(30) {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.wait();
            done.store(true, Ordering::Release);
            let _ = reader.join();
            return Err("命令超过 30 秒，已停止。长期任务请从终端启动".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}
