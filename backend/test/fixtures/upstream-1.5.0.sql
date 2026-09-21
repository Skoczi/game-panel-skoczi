-- OVHcloud Game Panel v1.5.0 createSchema, Apache-2.0, Copyright OVH 2026.
-- Extracted verbatim SQL blocks from backend/src/database/init.ts at upstream tag v1.5.0.

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        global_permissions_json TEXT NOT NULL DEFAULT '[]',
        is_root INTEGER NOT NULL DEFAULT 0 CHECK(is_root IN (0, 1)),
        is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ;

      CREATE TABLE IF NOT EXISTS game_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('ovhcloud','linuxgsm','external')),
        catalog_id TEXT,
        docker_image TEXT NOT NULL,
        docker_image_digest TEXT,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('running','stopped','creating','installing','starting','stopping','restarting','unhealthy','failed')),
        desired_state TEXT NOT NULL DEFAULT 'stopped' CHECK(desired_state IN ('running','stopped')),
        container_status TEXT NOT NULL DEFAULT 'missing' CHECK(container_status IN ('missing','created','running','paused','restarting','removing','exited','dead','unknown')),
        health_status TEXT NOT NULL DEFAULT 'none' CHECK(health_status IN ('none','starting','healthy','unhealthy','unknown')),
        docker_container_id TEXT,
        docker_container_name TEXT,
        ports_json TEXT NOT NULL,
        healthcheck_json TEXT,
        resource_limits_json TEXT,
        mounts_json TEXT NOT NULL DEFAULT '[]',
        env_json TEXT NOT NULL DEFAULT '[]',
        runtime_config_json TEXT NOT NULL DEFAULT '{}',
        provider_metadata_json TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        app_version TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    ;

      CREATE TABLE IF NOT EXISTS linuxgsm_manifest_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        source_url TEXT NOT NULL,
        content_hash TEXT,
        fetched_at TEXT NOT NULL
      );
    ;

      CREATE TABLE IF NOT EXISTS linuxgsm_games (
        shortname TEXT PRIMARY KEY,
        gameservername TEXT NOT NULL,
        gamename TEXT NOT NULL,
        os TEXT,
        docker_image TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
    ;

      CREATE TABLE IF NOT EXISTS server_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        permissions_json TEXT NOT NULL DEFAULT '[]', -- JSON array, e.g. ["server.power","fs.read"]
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(server_id, user_id)
      )
    ;

      CREATE TABLE IF NOT EXISTS server_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT CHECK(level IN ('info', 'warn', 'warning', 'error', 'success', 'command')),
        message TEXT,
        actor_username TEXT,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        cpu_usage REAL,
        memory_usage REAL,
        disk_usage REAL,
        network_in INTEGER,
        network_out INTEGER
      )
    ;

      CREATE TABLE IF NOT EXISTS server_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        cpu_usage REAL,
        memory_usage REAL,
        disk_usage REAL,
        network_in INTEGER,
        network_out INTEGER,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS installation_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        progress_percent INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK(status IN (
          'pending',
          'pulling_image',
          'preparing_files',
          'hytale_downloader_auth',
          'downloading_server_files',
          'extracting_server_files',
          'hytale_account_auth',
          'hytale_profile_selection',
          'configuring_hytale_auth',
          'creating_container',
          'starting_container',
          'completed',
          'failed'
        )),
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS installation_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','expired','cancelled')),
        payload_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS file_transfer_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('upload','extract')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
        root TEXT NOT NULL,
        base_path TEXT NOT NULL,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        transferred_bytes INTEGER NOT NULL DEFAULT 0,
        total_files INTEGER NOT NULL DEFAULT 0,
        completed_files INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        artifact_path TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS server_scheduled_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('restart','backup','custom')),
        schedule TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        payload_json TEXT NOT NULL DEFAULT '{}',
        next_run_at TEXT,
        last_run_at TEXT,
        last_status TEXT,
        last_error TEXT,
        locked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
      )
    ;

      CREATE TABLE IF NOT EXISTS panel_update_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_version TEXT NOT NULL,
        target_tag TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
        phase TEXT NOT NULL DEFAULT 'queued',
        message TEXT,
        error_message TEXT,
        container_id TEXT,
        backup_path TEXT,
        started_by TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ;

      CREATE INDEX IF NOT EXISTS idx_server_actions_server_time
      ON server_actions(server_id, timestamp);
    ;

      CREATE INDEX IF NOT EXISTS idx_server_metrics_server_time
      ON server_metrics(server_id, timestamp);
    ;

      CREATE INDEX IF NOT EXISTS idx_system_metrics_time
      ON system_metrics(timestamp);
    ;

      CREATE INDEX IF NOT EXISTS idx_install_progress_server
      ON installation_progress(server_id);
    ;

      CREATE INDEX IF NOT EXISTS idx_install_interactions_server_status
      ON installation_interactions(server_id, status);
    ;

      CREATE INDEX IF NOT EXISTS idx_file_transfer_jobs_server_status
      ON file_transfer_jobs(server_id, status);
    ;

      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due
      ON server_scheduled_tasks(enabled, next_run_at, locked_at);
    ;

      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_server
      ON server_scheduled_tasks(server_id);
    ;

      CREATE INDEX IF NOT EXISTS idx_panel_update_jobs_status
      ON panel_update_jobs(status, created_at);
    ;

      CREATE INDEX IF NOT EXISTS idx_server_members_server
      ON server_members(server_id);
    ;

      CREATE INDEX IF NOT EXISTS idx_server_members_user
      ON server_members(user_id);
    ;

      CREATE INDEX IF NOT EXISTS idx_game_servers_provider
      ON game_servers(provider);
    ;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci_unique
      ON users(LOWER(username));
    ;