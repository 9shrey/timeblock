//! Timeblock sync server: username/password accounts and a per-user store of opaque rows.
//!
//! The server doesn't know the app's schema. Each row is `(table, key, JSON or null)`;
//! every write gets the user's next sequence number, and clients pull "everything after
//! seq N". Last push wins per row.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
const MAX_CHANGES: usize = 20_000;

const LOGIN_WINDOW: Duration = Duration::from_secs(15 * 60);
const LOGIN_MAX_FAILURES: usize = 10;
const SIGNUP_WINDOW: Duration = Duration::from_secs(60 * 60);
const SIGNUP_MAX: usize = 5;

const SCHEMA: &str = "
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS rows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tbl     TEXT NOT NULL,
  key     TEXT NOT NULL,
  data    TEXT,
  seq     INTEGER NOT NULL,
  PRIMARY KEY (user_id, tbl, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS rows_seq ON rows (user_id, seq);
";

// ---------- config & state ----------

#[derive(Clone, Debug)]
pub struct Config {
    pub db_path: String,
    pub origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let origins = std::env::var("TIMEBLOCK_ORIGINS").unwrap_or_else(|_| {
            "http://localhost:1420,http://localhost:1430,tauri://localhost,http://tauri.localhost"
                .into()
        });
        Config {
            db_path: std::env::var("TIMEBLOCK_DB").unwrap_or_else(|_| "./timeblock-sync.db".into()),
            origins: origins
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<Connection>>,
    limiter: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl AppState {
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(AppState {
            db: Arc::new(Mutex::new(conn)),
            limiter: Arc::default(),
        })
    }

    pub fn in_memory() -> Self {
        Self::open(":memory:").expect("in-memory db")
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Number of recent events under `key` inside `window`, pruning older ones.
    fn recent(&self, key: &str, window: Duration) -> usize {
        let mut map = self.limiter.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let list = map.entry(key.to_string()).or_default();
        list.retain(|t| now.duration_since(*t) < window);
        let n = list.len();
        if n == 0 {
            map.remove(key);
        }
        n
    }

    fn note(&self, key: &str) {
        let mut map = self.limiter.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(key.to_string()).or_default().push(Instant::now());
    }
}

// ---------- errors ----------

#[derive(Debug)]
pub struct AppError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

fn err(status: StatusCode, code: &'static str, message: impl Into<String>) -> AppError {
    AppError {
        status,
        code,
        message: message.into(),
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": self.code, "message": self.message })),
        )
            .into_response()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        eprintln!("database error: {e}");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "server",
            "Database error.",
        )
    }
}

type ApiResult<T> = Result<Json<T>, AppError>;

// ---------- helpers ----------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_password(pw: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server",
                "Couldn't hash the password.",
            )
        })
}

fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

/// Argon2 is deliberately slow; keep it off the async runtime threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f).await.map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "server",
            "Internal error.",
        )
    })
}

fn valid_username(name: &str) -> bool {
    (3..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
}

fn check_password_strength(pw: &str) -> Result<(), AppError> {
    if pw.chars().count() < 8 || pw.len() > 1024 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "weak_password",
            "Use at least 8 characters for the password.",
        ));
    }
    Ok(())
}

fn issue_session(conn: &Connection, user_id: i64, device: &str) -> rusqlite::Result<String> {
    let token = new_token();
    let now = now_secs();
    let device: String = device.chars().take(80).collect();
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, device, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![hash_token(&token), user_id, device, now],
    )?;
    Ok(token)
}

// ---------- extractors ----------

/// The client's IP. Behind Caddy on the same host, the real client is in X-Forwarded-For.
pub struct ClientIp(pub String);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let peer: Option<IpAddr> = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip());
        let forwarded = || {
            parts
                .headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.split(',').next_back())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let ip = match peer {
            Some(p) if p.is_loopback() => forwarded().unwrap_or_else(|| p.to_string()),
            Some(p) => p.to_string(),
            None => forwarded().unwrap_or_else(|| "unknown".into()),
        };
        Ok(ClientIp(ip))
    }
}

/// A signed-in request (valid Bearer token).
pub struct AuthUser {
    user_id: i64,
    token_hash: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let unauthorized = || {
            err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "You were signed out. Sign in again.",
            )
        };
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;
        let token_hash = hash_token(token.trim());
        let conn = state.db();
        let user_id: i64 = conn
            .query_row(
                "SELECT user_id FROM sessions WHERE token_hash = ?1",
                [&token_hash],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(unauthorized)?;
        conn.execute(
            "UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2",
            params![now_secs(), token_hash],
        )?;
        Ok(AuthUser {
            user_id,
            token_hash,
        })
    }
}

// ---------- handlers ----------

#[derive(Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
    #[serde(default)]
    device: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    token: String,
    username: String,
}

async fn signup(
    State(st): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(c): Json<Credentials>,
) -> ApiResult<AuthResponse> {
    let key = format!("signup:{ip}");
    if st.recent(&key, SIGNUP_WINDOW) >= SIGNUP_MAX {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many sign-ups. Try again later.",
        ));
    }
    st.note(&key);
    let username = c.username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "invalid_username",
            "Usernames are 3–32 characters: letters, numbers, . _ or -.",
        ));
    }
    check_password_strength(&c.password)?;
    let pw = c.password;
    let hash = blocking(move || hash_password(&pw)).await??;
    let conn = st.db();
    let inserted = conn.execute(
        "INSERT INTO users (username, pw_hash, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (username) DO NOTHING",
        params![username, hash, now_secs()],
    )?;
    if inserted == 0 {
        return Err(err(
            StatusCode::CONFLICT,
            "username_taken",
            "That username is taken.",
        ));
    }
    let token = issue_session(&conn, conn.last_insert_rowid(), &c.device)?;
    Ok(Json(AuthResponse { token, username }))
}

async fn login(
    State(st): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(c): Json<Credentials>,
) -> ApiResult<AuthResponse> {
    let username = c.username.trim().to_lowercase();
    let ip_key = format!("login-ip:{ip}");
    let user_key = format!("login-user:{username}");
    if st.recent(&ip_key, LOGIN_WINDOW) >= LOGIN_MAX_FAILURES
        || st.recent(&user_key, LOGIN_WINDOW) >= LOGIN_MAX_FAILURES
    {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts. Wait a few minutes and try again.",
        ));
    }
    let found: Option<(i64, String)> = st
        .db()
        .query_row(
            "SELECT id, pw_hash FROM users WHERE username = ?1",
            [&username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let pw = c.password;
    let ok = match found.clone() {
        Some((_, hash)) => blocking(move || verify_password(&pw, &hash)).await?,
        None => false,
    };
    let Some((user_id, _)) = found.filter(|_| ok) else {
        st.note(&ip_key);
        st.note(&user_key);
        return Err(err(
            StatusCode::UNAUTHORIZED,
            "bad_credentials",
            "Wrong username or password.",
        ));
    };
    let conn = st.db();
    let token = issue_session(&conn, user_id, &c.device)?;
    let username: String =
        conn.query_row("SELECT username FROM users WHERE id = ?1", [user_id], |r| {
            r.get(0)
        })?;
    Ok(Json(AuthResponse { token, username }))
}

async fn me(State(st): State<AppState>, auth: AuthUser) -> ApiResult<Value> {
    let (username, created_at): (String, i64) = st.db().query_row(
        "SELECT username, created_at FROM users WHERE id = ?1",
        [auth.user_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(Json(
        json!({ "username": username, "created_at": created_at }),
    ))
}

async fn logout(State(st): State<AppState>, auth: AuthUser) -> ApiResult<Value> {
    st.db().execute(
        "DELETE FROM sessions WHERE token_hash = ?1",
        [&auth.token_hash],
    )?;
    Ok(Json(json!({})))
}

async fn logout_all(State(st): State<AppState>, auth: AuthUser) -> ApiResult<Value> {
    st.db()
        .execute("DELETE FROM sessions WHERE user_id = ?1", [auth.user_id])?;
    Ok(Json(json!({})))
}

fn stored_hash(st: &AppState, user_id: i64) -> Result<String, AppError> {
    Ok(st
        .db()
        .query_row("SELECT pw_hash FROM users WHERE id = ?1", [user_id], |r| {
            r.get(0)
        })?)
}

async fn check_current_password(st: &AppState, user_id: i64, pw: String) -> Result<(), AppError> {
    let hash = stored_hash(st, user_id)?;
    if !blocking(move || verify_password(&pw, &hash)).await? {
        return Err(err(
            StatusCode::UNAUTHORIZED,
            "bad_credentials",
            "Wrong password.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct PasswordChange {
    old_password: String,
    new_password: String,
}

async fn change_password(
    State(st): State<AppState>,
    auth: AuthUser,
    Json(p): Json<PasswordChange>,
) -> ApiResult<Value> {
    check_password_strength(&p.new_password)?;
    check_current_password(&st, auth.user_id, p.old_password).await?;
    let new_pw = p.new_password;
    let hash = blocking(move || hash_password(&new_pw)).await??;
    let mut conn = st.db();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE users SET pw_hash = ?1 WHERE id = ?2",
        params![hash, auth.user_id],
    )?;
    let device: String = tx
        .query_row(
            "SELECT device FROM sessions WHERE token_hash = ?1",
            [&auth.token_hash],
            |r| r.get(0),
        )
        .unwrap_or_default();
    tx.execute("DELETE FROM sessions WHERE user_id = ?1", [auth.user_id])?;
    let token = issue_session(&tx, auth.user_id, &device)?;
    tx.commit()?;
    Ok(Json(json!({ "token": token })))
}

#[derive(Deserialize)]
pub struct PasswordOnly {
    password: String,
}

async fn delete_account(
    State(st): State<AppState>,
    auth: AuthUser,
    Json(p): Json<PasswordOnly>,
) -> ApiResult<Value> {
    check_current_password(&st, auth.user_id, p.password).await?;
    st.db()
        .execute("DELETE FROM users WHERE id = ?1", [auth.user_id])?;
    Ok(Json(json!({})))
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Change {
    table: String,
    key: String,
    #[serde(default)]
    row: Option<Value>,
}

#[derive(Deserialize)]
pub struct SyncRequest {
    #[serde(default)]
    since: i64,
    #[serde(default)]
    changes: Vec<Change>,
    #[serde(default)]
    replace: bool,
}

#[derive(Serialize)]
pub struct SyncResponse {
    seq: i64,
    changes: Vec<Change>,
}

async fn sync(
    State(st): State<AppState>,
    auth: AuthUser,
    Json(req): Json<SyncRequest>,
) -> ApiResult<SyncResponse> {
    if req.changes.len() > MAX_CHANGES {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Too many changes in one request.",
        ));
    }
    if req
        .changes
        .iter()
        .any(|c| c.table.is_empty() || c.table.len() > 64 || c.key.is_empty() || c.key.len() > 512)
    {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Invalid table or key.",
        ));
    }
    let mut conn = st.db();
    let tx = conn.transaction()?;
    let mut seq: i64 =
        tx.query_row("SELECT seq FROM users WHERE id = ?1", [auth.user_id], |r| {
            r.get(0)
        })?;
    // A client ahead of the server (e.g. after a server restore) re-reads everything.
    let since = if req.since > seq || req.since < 0 {
        0
    } else {
        req.since
    };

    {
        let mut upsert = tx.prepare(
            "INSERT INTO rows (user_id, tbl, key, data, seq) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (user_id, tbl, key) DO UPDATE SET data = excluded.data, seq = excluded.seq",
        )?;
        for c in &req.changes {
            seq += 1;
            let data = c
                .row
                .as_ref()
                .filter(|v| !v.is_null())
                .map(|v| v.to_string());
            upsert.execute(params![auth.user_id, c.table, c.key, data, seq])?;
        }
    }

    if req.replace {
        let pushed: HashSet<(&str, &str)> = req
            .changes
            .iter()
            .map(|c| (c.table.as_str(), c.key.as_str()))
            .collect();
        let live: Vec<(String, String)> = tx
            .prepare("SELECT tbl, key FROM rows WHERE user_id = ?1 AND data IS NOT NULL")?
            .query_map([auth.user_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let mut tomb = tx.prepare(
            "UPDATE rows SET data = NULL, seq = ?1 WHERE user_id = ?2 AND tbl = ?3 AND key = ?4",
        )?;
        for (t, k) in live
            .iter()
            .filter(|(t, k)| !pushed.contains(&(t.as_str(), k.as_str())))
        {
            seq += 1;
            tomb.execute(params![seq, auth.user_id, t, k])?;
        }
    }

    tx.execute(
        "UPDATE users SET seq = ?1 WHERE id = ?2",
        params![seq, auth.user_id],
    )?;
    let changes: Vec<Change> = tx
        .prepare("SELECT tbl, key, data FROM rows WHERE user_id = ?1 AND seq > ?2 ORDER BY seq")?
        .query_map(params![auth.user_id, since], |r| {
            let data: Option<String> = r.get(2)?;
            Ok(Change {
                table: r.get(0)?,
                key: r.get(1)?,
                row: data.and_then(|d| serde_json::from_str(&d).ok()),
            })
        })?
        .collect::<Result<_, _>>()?;
    tx.commit()?;
    Ok(Json(SyncResponse { seq, changes }))
}

async fn health() -> &'static str {
    "ok"
}

// ---------- router ----------

pub fn app(state: AppState, config: &Config) -> Router {
    let origins: Vec<HeaderValue> = config
        .origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::ACCEPT])
        .max_age(Duration::from_secs(86_400));
    Router::new()
        .route("/health", get(health))
        .route("/api/signup", post(signup))
        .route("/api/login", post(login))
        .route("/api/me", get(me))
        .route("/api/logout", post(logout))
        .route("/api/logout-all", post(logout_all))
        .route("/api/password", post(change_password))
        .route("/api/account", delete(delete_account))
        .route("/api/sync", post(sync))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .with_state(state)
}

// ---------- backups ----------

/// Writes `backups/timeblock-YYYY-MM-DD.db` next to the database if today's is missing,
/// then keeps the newest `keep`. Returns the path written, if any.
pub fn backup_if_due(
    state: &AppState,
    db_path: &str,
    keep: usize,
) -> rusqlite::Result<Option<PathBuf>> {
    if db_path == ":memory:" {
        return Ok(None);
    }
    let dir = Path::new(db_path)
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"));
    if std::fs::create_dir_all(&dir).is_err() {
        eprintln!("backup: can't create {}", dir.display());
        return Ok(None);
    }
    let conn = state.db();
    let day: String = conn.query_row("SELECT date('now')", [], |r| r.get(0))?;
    let path = dir.join(format!("timeblock-{day}.db"));
    if path.exists() {
        return Ok(None);
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
    drop(conn);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    files.retain(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("timeblock-") && n.ends_with(".db"))
    });
    files.sort();
    while files.len() > keep {
        let old = files.remove(0);
        let _ = std::fs::remove_file(old);
    }
    Ok(Some(path))
}
