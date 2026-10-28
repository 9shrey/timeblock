use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use timeblock_sync::{app, backup_if_due, AppState, Config};
use tower::ServiceExt;

fn test_app() -> Router {
    let config = Config {
        db_path: ":memory:".into(),
        origins: vec!["https://9shrey.github.io".into()],
    };
    app(AppState::in_memory(), &config)
}

async fn send(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("x-forwarded-for", "10.0.0.1");
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let req = match body {
        Some(b) => req
            .header("content-type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn signup(app: &Router, name: &str) -> String {
    let (s, b) = send(
        app,
        "POST",
        "/api/signup",
        None,
        Some(json!({"username": name, "password": "password1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    b["token"].as_str().unwrap().to_string()
}

async fn sync(app: &Router, token: &str, body: Value) -> Value {
    let (s, b) = send(app, "POST", "/api/sync", Some(token), Some(body)).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    b
}

#[tokio::test]
async fn signup_login_and_errors() {
    let app = test_app();
    let token = signup(&app, "Shrey").await;
    let (s, b) = send(&app, "GET", "/api/me", Some(&token), None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["username"], "shrey");

    let (s, b) = send(
        &app,
        "POST",
        "/api/signup",
        None,
        Some(json!({"username": "shrey", "password": "password1"})),
    )
    .await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::CONFLICT, Some("username_taken"))
    );
    let (s, b) = send(
        &app,
        "POST",
        "/api/signup",
        None,
        Some(json!({"username": "a", "password": "password1"})),
    )
    .await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("invalid_username"))
    );
    let (s, b) = send(
        &app,
        "POST",
        "/api/signup",
        None,
        Some(json!({"username": "abc", "password": "short"})),
    )
    .await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::BAD_REQUEST, Some("weak_password"))
    );

    let (s, b) = send(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({"username": "SHREY", "password": "password1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["username"], "shrey");
    let (s, b) = send(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({"username": "shrey", "password": "nope"})),
    )
    .await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("bad_credentials"))
    );
    let (s, b) = send(&app, "GET", "/api/me", Some("bogus"), None).await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::UNAUTHORIZED, Some("unauthorized"))
    );
}

#[tokio::test]
async fn logout_and_password_change_revoke_tokens() {
    let app = test_app();
    let a = signup(&app, "shrey").await;
    let (_, b) = send(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({"username": "shrey", "password": "password1"})),
    )
    .await;
    let b_tok = b["token"].as_str().unwrap().to_string();

    send(&app, "POST", "/api/logout", Some(&a), Some(json!({}))).await;
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&a), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&b_tok), None).await.0,
        StatusCode::OK
    );

    let (s, _) = send(
        &app,
        "POST",
        "/api/password",
        Some(&b_tok),
        Some(json!({"old_password": "wrong", "new_password": "password2"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, res) = send(
        &app,
        "POST",
        "/api/password",
        Some(&b_tok),
        Some(json!({"old_password": "password1", "new_password": "password2"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let fresh = res["token"].as_str().unwrap().to_string();
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&b_tok), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&fresh), None).await.0,
        StatusCode::OK
    );

    send(
        &app,
        "POST",
        "/api/logout-all",
        Some(&fresh),
        Some(json!({})),
    )
    .await;
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&fresh), None).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn sync_push_pull_and_seq() {
    let app = test_app();
    let t = signup(&app, "shrey").await;
    let r = sync(
        &app,
        &t,
        json!({"since": 0, "changes": [
            {"table": "goals", "key": "g1", "row": {"id": "g1", "name": "Deep work"}},
            {"table": "blocks", "key": "b1", "row": {"id": "b1"}}
        ]}),
    )
    .await;
    assert_eq!(r["seq"], 2);
    assert_eq!(r["changes"].as_array().unwrap().len(), 2);

    // Another device pulls from 0, then sees only newer changes.
    let r = sync(&app, &t, json!({"since": 0, "changes": []})).await;
    assert_eq!(r["changes"][0]["row"]["name"], "Deep work");
    let r = sync(
        &app,
        &t,
        json!({"since": 2, "changes": [{"table": "goals", "key": "g1", "row": null}]}),
    )
    .await;
    assert_eq!(r["seq"], 3);
    assert_eq!(
        r["changes"],
        json!([{"table": "goals", "key": "g1", "row": null}])
    );

    // A client ahead of the server gets everything again.
    let r = sync(&app, &t, json!({"since": 99, "changes": []})).await;
    assert_eq!(r["changes"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn replace_tombstones_rows_not_pushed() {
    let app = test_app();
    let t = signup(&app, "shrey").await;
    sync(
        &app,
        &t,
        json!({"since": 0, "changes": [
            {"table": "goals", "key": "g1", "row": {"id": "g1"}},
            {"table": "goals", "key": "g2", "row": {"id": "g2"}}
        ]}),
    )
    .await;
    let r = sync(&app, &t, json!({"since": 2, "replace": true, "changes": [{"table": "goals", "key": "g3", "row": {"id": "g3"}}]})).await;
    let mut got: Vec<(String, bool)> = r["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["key"].as_str().unwrap().to_string(), c["row"].is_null()))
        .collect();
    got.sort();
    assert_eq!(
        got,
        vec![
            ("g1".into(), true),
            ("g2".into(), true),
            ("g3".into(), false)
        ]
    );
}

#[tokio::test]
async fn users_are_isolated_and_account_delete_removes_data() {
    let app = test_app();
    let a = signup(&app, "alice").await;
    let b = signup(&app, "bob").await;
    sync(
        &app,
        &a,
        json!({"since": 0, "changes": [{"table": "goals", "key": "g1", "row": {"id": "g1"}}]}),
    )
    .await;
    let r = sync(&app, &b, json!({"since": 0, "changes": []})).await;
    assert_eq!(r["changes"], json!([]));

    let (s, _) = send(
        &app,
        "DELETE",
        "/api/account",
        Some(&a),
        Some(json!({"password": "wrong"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = send(
        &app,
        "DELETE",
        "/api/account",
        Some(&a),
        Some(json!({"password": "password1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        send(&app, "GET", "/api/me", Some(&a), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    // The name is free again, and the new account starts empty.
    let a2 = signup(&app, "alice").await;
    assert_eq!(
        sync(&app, &a2, json!({"since": 0, "changes": []})).await["changes"],
        json!([])
    );
}

#[tokio::test]
async fn login_failures_are_rate_limited() {
    let app = test_app();
    signup(&app, "shrey").await;
    for _ in 0..10 {
        let (s, _) = send(
            &app,
            "POST",
            "/api/login",
            None,
            Some(json!({"username": "shrey", "password": "nope"})),
        )
        .await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let (s, b) = send(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({"username": "shrey", "password": "password1"})),
    )
    .await;
    assert_eq!(
        (s, b["error"].as_str()),
        (StatusCode::TOO_MANY_REQUESTS, Some("rate_limited"))
    );
}

#[tokio::test]
async fn signups_are_rate_limited_per_ip() {
    let app = test_app();
    for i in 0..5 {
        signup(&app, &format!("user{i}")).await;
    }
    let (s, _) = send(
        &app,
        "POST",
        "/api/signup",
        None,
        Some(json!({"username": "user9", "password": "password1"})),
    )
    .await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn cors_preflight_allows_the_web_app_only() {
    let app = test_app();
    let preflight = |origin: &str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/api/sync")
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                "authorization,content-type",
            )
            .body(Body::empty())
            .unwrap()
    };
    let res = app
        .clone()
        .oneshot(preflight("https://9shrey.github.io"))
        .await
        .unwrap();
    assert_eq!(
        res.headers()["access-control-allow-origin"],
        "https://9shrey.github.io"
    );
    assert!(res.headers()["access-control-allow-headers"]
        .to_str()
        .unwrap()
        .contains("authorization"));
    let res = app
        .clone()
        .oneshot(preflight("https://evil.example"))
        .await
        .unwrap();
    assert!(res.headers().get("access-control-allow-origin").is_none());
}

#[test]
fn backups_write_once_a_day_and_keep_the_newest() {
    let dir = std::env::temp_dir().join(format!("tb-sync-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("backups")).unwrap();
    for d in ["2020-01-01", "2020-01-02", "2020-01-03"] {
        std::fs::write(
            dir.join("backups").join(format!("timeblock-{d}.db")),
            b"old",
        )
        .unwrap();
    }
    let db = dir.join("sync.db");
    let state = AppState::open(db.to_str().unwrap()).unwrap();
    let written = backup_if_due(&state, db.to_str().unwrap(), 2).unwrap();
    assert!(written.is_some());
    assert!(backup_if_due(&state, db.to_str().unwrap(), 2)
        .unwrap()
        .is_none());
    let n = std::fs::read_dir(dir.join("backups")).unwrap().count();
    assert_eq!(n, 2);
    let _ = std::fs::remove_dir_all(&dir);
}
