use std::net::SocketAddr;
use std::time::Duration;

use timeblock_sync::{app, backup_if_due, AppState, Config};

#[tokio::main]
async fn main() {
    let config = Config::from_env();
    let bind = std::env::var("TIMEBLOCK_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let state = AppState::open(&config.db_path)
        .unwrap_or_else(|e| panic!("can't open {}: {e}", config.db_path));

    // Nightly backups: check hourly, write one per day, keep 14.
    let (bstate, bpath) = (state.clone(), config.db_path.clone());
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let (s, p) = (bstate.clone(), bpath.clone());
            match tokio::task::spawn_blocking(move || backup_if_due(&s, &p, 14)).await {
                Ok(Ok(Some(path))) => println!("backup written: {}", path.display()),
                Ok(Err(e)) => eprintln!("backup failed: {e}"),
                _ => {}
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("can't bind {bind}: {e}"));
    println!(
        "timeblock-sync listening on {bind} (db {}, origins {:?})",
        config.db_path, config.origins
    );
    axum::serve(
        listener,
        app(state, &config).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .expect("server error");
}
