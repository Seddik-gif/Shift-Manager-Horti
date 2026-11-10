//! Database backup with `pg_dump`, mirroring scripts/backup.mjs: write a timestamped file, check it can be read
//! back with `pg_restore --list`, keep only the newest N. The password never appears on a command line.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use url::Url;

#[derive(Serialize, Debug, PartialEq)]
pub struct BackupResult {
    pub path: String,
    pub size_kb: u64,
    pub objects: usize,
    pub removed: Vec<String>,
}

/// `horti-YYYYMMDD-HHMM.dump` in UTC, so names sort chronologically.
pub fn backup_file_name(unix_seconds: u64) -> String {
    let (y, mo, d, h, mi) = civil_from_unix(unix_seconds);
    format!("horti-{y:04}{mo:02}{d:02}-{h:02}{mi:02}.dump")
}

// Howard Hinnant's days-to-civil algorithm: no date library needed.
fn civil_from_unix(secs: u64) -> (i64, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, (rem / 3600) as u32, ((rem % 3600) / 60) as u32)
}

pub fn is_backup_name(name: &str) -> bool {
    let b = name.as_bytes();
    // horti-YYYYMMDD-HHMM.dump
    name.len() == 24
        && name.starts_with("horti-")
        && name.ends_with(".dump")
        && b[6..14].iter().all(u8::is_ascii_digit)
        && b[14] == b'-'
        && b[15..19].iter().all(u8::is_ascii_digit)
}

/// Which files to delete so only the newest `keep` remain. Files we did not create are never listed.
pub fn select_to_delete(files: &[String], keep: usize) -> Vec<String> {
    let mut ours: Vec<&String> = files.iter().filter(|f| is_backup_name(f)).collect();
    ours.sort();
    ours.reverse();
    ours.into_iter().skip(keep.max(1)).cloned().collect()
}

/// Splits a postgres URL into one without the password, plus the password (for PGPASSWORD).
pub fn split_url(raw: &str) -> Result<(String, String), String> {
    let mut u = Url::parse(raw).map_err(|_| "The database address is not valid.".to_string())?;
    if u.scheme() != "postgres" && u.scheme() != "postgresql" {
        return Err("The database address must start with postgresql://".into());
    }
    let password = percent_decode(u.password().unwrap_or(""));
    u.set_password(None).map_err(|_| "The database address is not valid.".to_string())?;
    Ok((u.to_string(), password))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Finds a PostgreSQL client tool: configured folder, then PATH, then the usual Windows install folders.
pub fn find_tool(name: &str, configured_dir: Option<&str>) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = configured_dir.filter(|d| !d.trim().is_empty()) {
        candidates.push(Path::new(dir).join(&exe));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join(&exe)));
    }
    for root in ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"] {
        if let Ok(rd) = fs::read_dir(root) {
            let mut versions: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
            versions.sort();
            versions.reverse(); // newest first
            candidates.extend(versions.into_iter().map(|v| v.join("bin").join(&exe)));
        }
    }
    candidates.into_iter().find(|c| c.is_file())
}

fn run(tool: &Path, args: &[&str], password: &str) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(tool);
    cmd.args(args).env("PGPASSWORD", password);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window flashing up
    }
    cmd.output().map_err(|e| format!("Could not start {}: {e}", tool.display()))
}

/// Takes one backup. Blocking: call from a background thread.
pub fn run_backup(database_url: &str, dir: &Path, keep: usize, tools_dir: Option<&str>) -> Result<BackupResult, String> {
    let (url, password) = split_url(database_url)?;
    let pg_dump = find_tool("pg_dump", tools_dir)
        .ok_or("pg_dump was not found. Install the PostgreSQL command-line tools (or set their folder in Settings).")?;
    let pg_restore = find_tool("pg_restore", tools_dir)
        .ok_or("pg_restore was not found next to pg_dump. Install the PostgreSQL command-line tools.")?;

    fs::create_dir_all(dir).map_err(|e| format!("Cannot create the backup folder {}: {e}", dir.display()))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let file = dir.join(backup_file_name(now));
    let file_s = file.to_string_lossy().to_string();

    let out = run(
        &pg_dump,
        &["--format=custom", "--no-owner", "--no-privileges", "--schema", "public", "--schema", "auth", "--file", &file_s, "--dbname", &url],
        &password,
    )?;
    if !out.status.success() {
        let _ = fs::remove_file(&file); // never leave a half-written backup that looks real
        return Err(format!("pg_dump failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }

    // a backup nobody has opened is not a backup
    let list = run(&pg_restore, &["--list", &file_s], &password)?;
    let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if !list.status.success() || size < 1024 {
        let _ = fs::remove_file(&file);
        return Err(format!("The backup file could not be read back ({size} bytes). It was removed."));
    }
    let objects = String::from_utf8_lossy(&list.stdout).lines().filter(|l| !l.is_empty() && !l.starts_with(';')).count();

    let names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    let mut removed = Vec::new();
    for old in select_to_delete(&names, keep) {
        if fs::remove_file(dir.join(&old)).is_ok() {
            removed.push(old);
        }
    }
    Ok(BackupResult { path: file_s, size_kb: size / 1024, objects, removed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_utc_and_sortable() {
        // 2026-11-09 23:14:59 UTC
        assert_eq!(backup_file_name(1_794_266_099), "horti-20261109-2314.dump");
        assert_eq!(backup_file_name(0), "horti-19700101-0000.dump");
        // leap day
        assert_eq!(backup_file_name(1_709_210_100), "horti-20240229-1235.dump");
        assert!(backup_file_name(1_800_000_000) > backup_file_name(1_700_000_000));
    }

    #[test]
    fn recognises_only_its_own_files() {
        assert!(is_backup_name("horti-20261109-2314.dump"));
        for bad in ["horti-2026110-2314.dump", "horti-20261109-231.dump", "notes.txt", "horti-abcdefgh-1234.dump", "x-20261109-2314.dump", "horti-20261109-2314.dump.bak"] {
            assert!(!is_backup_name(bad), "{bad}");
        }
    }

    #[test]
    fn keeps_the_newest_and_never_touches_foreign_files() {
        let files: Vec<String> = ["horti-20261101-0200.dump", "horti-20261103-0200.dump", "horti-20261102-0200.dump", "notes.txt", "family.dump"]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(select_to_delete(&files, 2), vec!["horti-20261101-0200.dump".to_string()]);
        assert!(select_to_delete(&files, 10).is_empty());
        assert_eq!(select_to_delete(&files, 0).len(), 2); // the last backup is never deleted
    }

    #[test]
    fn moves_the_password_out_of_the_url() {
        let (url, pw) = split_url("postgresql://postgres:p%40ss%3Aw0rd@db.abc.supabase.co:5432/postgres").unwrap();
        assert_eq!(pw, "p@ss:w0rd");
        assert!(!url.contains("w0rd"));
        assert!(url.contains("postgres@db.abc.supabase.co"));
        assert!(split_url("mysql://u:p@h/db").is_err());
        assert!(split_url("not a url").is_err());
    }
}
