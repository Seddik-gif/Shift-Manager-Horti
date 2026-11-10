//! Settings kept in %APPDATA%\it.hortimagici.desktop\config.json. The database address (it contains a password)
//! is NOT stored here: it lives in the Windows Credential Manager.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    /// Address of the hosted Horti Magici app, e.g. https://horti.example.com
    pub app_url: String,
    /// Where backups are written. Empty = Documents\HortiMagici\backups
    pub backup_dir: String,
    /// How many backups to keep
    pub keep: usize,
    /// Folder that contains pg_dump.exe. Empty = find it automatically.
    pub tools_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Config { app_url: String::new(), backup_dir: String::new(), keep: 14, tools_dir: String::new() }
    }
}

/// Only the app's own address may be opened in the window: https, or http for localhost during development.
pub fn validate_app_url(raw: &str) -> Result<String, String> {
    let u = Url::parse(raw.trim()).map_err(|_| "This is not a valid address.".to_string())?;
    let host = u.host_str().unwrap_or("");
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    match u.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("Use an https:// address (http:// is only accepted for localhost).".into()),
    }
    if host.is_empty() {
        return Err("The address has no host name.".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Do not put a user name or password in the address.".into());
    }
    // keep scheme + host + port; drop any path, query or fragment
    let mut origin = format!("{}://{}", u.scheme(), host);
    if let Some(p) = u.port() {
        origin.push_str(&format!(":{p}"));
    }
    Ok(origin)
}

pub fn validate_keep(keep: usize) -> Result<usize, String> {
    if (1..=365).contains(&keep) { Ok(keep) } else { Err("Keep between 1 and 365 backups.".into()) }
}

pub fn load(path: &Path) -> Config {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(path: &Path, cfg: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp: PathBuf = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string()) // write-then-rename: a crash never leaves a broken file
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_trims_to_the_origin() {
        assert_eq!(validate_app_url(" https://horti.example.com/admin?x=1#top ").unwrap(), "https://horti.example.com");
        assert_eq!(validate_app_url("https://horti.example.com:8443/").unwrap(), "https://horti.example.com:8443");
        assert_eq!(validate_app_url("http://localhost:3000/login").unwrap(), "http://localhost:3000");
        assert_eq!(validate_app_url("http://127.0.0.1:3100").unwrap(), "http://127.0.0.1:3100");
    }

    #[test]
    fn rejects_everything_else() {
        for bad in ["http://horti.example.com", "ftp://x.test", "file:///C:/secret", "javascript:alert(1)", "https://user:pw@horti.example.com", "not a url", "", "https://"] {
            assert!(validate_app_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn keep_is_bounded() {
        assert!(validate_keep(0).is_err());
        assert!(validate_keep(1).is_ok());
        assert!(validate_keep(365).is_ok());
        assert!(validate_keep(366).is_err());
    }

    #[test]
    fn missing_or_damaged_files_fall_back_to_defaults_and_saving_roundtrips() {
        let dir = std::env::temp_dir().join(format!("horti-cfg-test-{}", std::process::id()));
        let file = dir.join("config.json");
        assert_eq!(load(&file), Config::default());
        let cfg = Config { app_url: "https://a.test".into(), keep: 7, ..Config::default() };
        save(&file, &cfg).unwrap();
        assert_eq!(load(&file), cfg);
        fs::write(&file, "{ not json").unwrap();
        assert_eq!(load(&file), Config::default());
        let _ = fs::remove_dir_all(&dir);
    }
}
