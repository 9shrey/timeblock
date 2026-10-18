//! Schema-agnostic SQLite access. All SQL lives in TypeScript; Rust only runs
//! statements, converts values, and owns transactions and backups.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde::Deserialize;
use serde_json::{Map, Value as Json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const DB_FILE: &str = "data.sqlite3";
const BACKUP_DIR: &str = "backups";
const BACKUPS_KEPT: usize = 14;

pub type Row = Map<String, Json>;

#[derive(Debug, Deserialize)]
pub struct Stmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

pub struct Db {
    conn: Mutex<Connection>,
    dir: PathBuf,
}

/// JSON → SQLite. null/integer/float/string map to NULL/INTEGER/REAL/TEXT.
/// Booleans are rejected so the TS side always sends 0/1 explicitly.
pub fn to_sql(v: &Json) -> Result<Value, String> {
    match v {
        Json::Null => Ok(Value::Null),
        Json::Bool(_) => Err("boolean parameters are not allowed; send 0/1".into()),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Value::Real(f))
            } else {
                Err(format!("unsupported number: {n}"))
            }
        }
        Json::String(s) => Ok(Value::Text(s.clone())),
        Json::Array(_) | Json::Object(_) => Err("array/object parameters are not allowed".into()),
    }
}

/// SQLite → JSON. Blobs are not used by the schema and are rejected.
pub fn from_sql(v: ValueRef<'_>) -> Result<Json, String> {
    Ok(match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => return Err("BLOB values are not supported".into()),
    })
}

fn params(values: &[Json]) -> Result<Vec<Value>, String> {
    values.iter().map(to_sql).collect()
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Db {
    /// Opens (creating if needed) `<dir>/data.sqlite3` with WAL, foreign keys and a busy timeout.
    pub fn open(dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let conn = Connection::open(dir.join(DB_FILE)).map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
        )
        .map_err(err)?;
        Ok(Self {
            conn: Mutex::new(conn),
            dir: dir.to_path_buf(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "database lock poisoned".to_string())
    }

    /// Runs a query and returns rows as `{column: value}` maps.
    pub fn select(&self, sql: &str, values: &[Json]) -> Result<Vec<Row>, String> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(sql).map_err(err)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(params(values)?)).map_err(err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err)? {
            let mut map = Map::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                map.insert(name.clone(), from_sql(row.get_ref(i).map_err(err)?)?);
            }
            out.push(map);
        }
        Ok(out)
    }

    /// Runs all statements in one transaction (foreign keys checked at commit).
    /// Any failure rolls the whole batch back.
    pub fn batch(&self, stmts: &[Stmt]) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(err)?;
        tx.execute_batch("PRAGMA defer_foreign_keys = ON;")
            .map_err(err)?;
        for s in stmts {
            let mut stmt = tx.prepare_cached(&s.sql).map_err(err)?;
            let vals = params(&s.params)?;
            let mut rows = stmt.query(params_from_iter(vals)).map_err(err)?;
            // Drain so statements with RETURNING still run to completion.
            while rows.next().map_err(err)?.is_some() {}
        }
        tx.commit().map_err(err)
    }

    /// Runs a multi-statement script (migrations) inside one transaction.
    pub fn exec_script(&self, sql: &str) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(err)?;
        tx.execute_batch(sql).map_err(err)?;
        tx.commit().map_err(err)
    }

    fn backup_dir(&self) -> PathBuf {
        self.dir.join(BACKUP_DIR)
    }

    /// `VACUUM INTO backups/data-<unix>-<reason>.sqlite3`, keeping the newest 14.
    pub fn backup_now(&self, reason: &str) -> Result<String, String> {
        let reason: String = reason
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .take(32)
            .collect();
        let reason = if reason.is_empty() {
            "manual".into()
        } else {
            reason
        };
        let dir = self.backup_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut path = dir.join(format!("data-{}-{reason}.sqlite3", unix_now()));
        let mut n = 1;
        while path.exists() {
            path = dir.join(format!("data-{}-{reason}-{n}.sqlite3", unix_now()));
            n += 1;
        }
        let target = path.to_string_lossy().into_owned();
        self.lock()?
            .execute("VACUUM INTO ?1", [&target])
            .map_err(err)?;
        self.prune_backups()?;
        Ok(target)
    }

    /// Backups sorted oldest → newest by the unix timestamp in the file name.
    fn list_backups(&self) -> Result<Vec<(u64, PathBuf)>, String> {
        let dir = self.backup_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Some(rest) = name.strip_prefix("data-") else {
                continue;
            };
            if !name.ends_with(".sqlite3") {
                continue;
            }
            let ts = rest.split('-').next().and_then(|s| s.parse::<u64>().ok());
            if let Some(ts) = ts {
                out.push((ts, path));
            }
        }
        out.sort();
        Ok(out)
    }

    fn prune_backups(&self) -> Result<(), String> {
        let list = self.list_backups()?;
        let excess = list.len().saturating_sub(BACKUPS_KEPT);
        for (_, path) in list.into_iter().take(excess) {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Backs up if the newest backup is older than `max_age_hours` (or none exists).
    /// Returns the new backup's path, if one was made.
    pub fn backup_if_stale(&self, max_age_hours: u64) -> Result<Option<String>, String> {
        let newest = self.list_backups()?.last().map(|(ts, _)| *ts);
        let stale = match newest {
            None => true,
            Some(ts) => unix_now().saturating_sub(ts) >= max_age_hours * 3600,
        };
        if stale {
            self.backup_now("auto").map(Some)
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        db.exec_script(
            "CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL CHECK (n >= 0), r REAL, s TEXT) STRICT;",
        )
        .unwrap();
        (dir, db)
    }

    fn stmt(sql: &str, params: Vec<Json>) -> Stmt {
        Stmt {
            sql: sql.into(),
            params,
        }
    }

    #[test]
    fn converts_values() {
        assert_eq!(to_sql(&json!(null)).unwrap(), Value::Null);
        assert_eq!(to_sql(&json!(42)).unwrap(), Value::Integer(42));
        assert_eq!(to_sql(&json!(1.5)).unwrap(), Value::Real(1.5));
        assert_eq!(to_sql(&json!("x")).unwrap(), Value::Text("x".into()));
        assert!(to_sql(&json!(true)).is_err());
        assert!(to_sql(&json!([1])).is_err());
        assert!(to_sql(&json!({"a": 1})).is_err());
    }

    #[test]
    fn round_trips_rows() {
        let (_d, db) = db();
        db.batch(&[stmt(
            "INSERT INTO t VALUES (?, ?, ?, ?)",
            vec![json!("a"), json!(3), json!(0.25), json!(null)],
        )])
        .unwrap();
        let rows = db
            .select("SELECT * FROM t WHERE id = ?", &[json!("a")])
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            Json::Object(rows[0].clone()),
            json!({"id": "a", "n": 3, "r": 0.25, "s": null})
        );
    }

    #[test]
    fn batch_rolls_back_on_check_failure() {
        let (_d, db) = db();
        let res = db.batch(&[
            stmt(
                "INSERT INTO t (id, n) VALUES (?, ?)",
                vec![json!("ok"), json!(1)],
            ),
            stmt(
                "INSERT INTO t (id, n) VALUES (?, ?)",
                vec![json!("bad"), json!(-1)],
            ),
        ]);
        assert!(res.is_err());
        assert!(db.select("SELECT * FROM t", &[]).unwrap().is_empty());
    }

    #[test]
    fn batch_rejects_bool_params_atomically() {
        let (_d, db) = db();
        let res = db.batch(&[
            stmt(
                "INSERT INTO t (id, n) VALUES (?, ?)",
                vec![json!("ok"), json!(1)],
            ),
            stmt(
                "INSERT INTO t (id, n) VALUES (?, ?)",
                vec![json!("b"), json!(true)],
            ),
        ]);
        assert!(res.is_err());
        assert!(db.select("SELECT * FROM t", &[]).unwrap().is_empty());
    }

    #[test]
    fn script_failure_rolls_back() {
        let (_d, db) = db();
        let res = db.exec_script(
            "INSERT INTO t (id, n) VALUES ('x', 1); PRAGMA user_version = 7; SELECT nope;",
        );
        assert!(res.is_err());
        assert!(db.select("SELECT * FROM t", &[]).unwrap().is_empty());
        let v = db.select("PRAGMA user_version", &[]).unwrap();
        assert_eq!(v[0]["user_version"], json!(0));
    }

    #[test]
    fn deferred_foreign_keys_in_batch() {
        let (_d, db) = db();
        db.exec_script(
            "CREATE TABLE p (id TEXT PRIMARY KEY) STRICT;
             CREATE TABLE c (id TEXT PRIMARY KEY, p TEXT REFERENCES p(id)) STRICT;",
        )
        .unwrap();
        // Child before parent is fine inside one batch.
        db.batch(&[
            stmt("INSERT INTO c VALUES ('c1', 'p1')", vec![]),
            stmt("INSERT INTO p VALUES ('p1')", vec![]),
        ])
        .unwrap();
        // A dangling reference fails at commit.
        assert!(
            db.batch(&[stmt("INSERT INTO c VALUES ('c2', 'nope')", vec![])])
                .is_err()
        );
    }

    #[test]
    fn backups_are_pruned_and_staleness_checked() {
        let (_d, db) = db();
        let first = db.backup_now("pre migration!").unwrap();
        assert!(first.ends_with("-pre-migration-.sqlite3"));
        assert!(Path::new(&first).exists());
        assert_eq!(db.backup_if_stale(24).unwrap(), None);
        // Fake 20 old backups; only the newest 14 survive the next prune.
        let dir = db.dir().join(BACKUP_DIR);
        for i in 0..20 {
            std::fs::write(dir.join(format!("data-{}-old.sqlite3", 1000 + i)), b"").unwrap();
        }
        db.backup_now("manual").unwrap();
        let list = db.list_backups().unwrap();
        assert_eq!(list.len(), BACKUPS_KEPT);
        assert!(Path::new(&first).exists());
    }
}
