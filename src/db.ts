import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "slotcraft.db");

// In-memory for tests
if (process.env.NODE_ENV === "test") {
  dbPath = ":memory:";
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      game_type TEXT NOT NULL CHECK(game_type IN ('slot', 'crash', 'table')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
      step_data TEXT NOT NULL DEFAULT '{}',
      brand TEXT NOT NULL DEFAULT '',
      team TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      development_start TEXT,
      development_end TEXT,
      tech_release TEXT,
      pre_release TEXT,
      marketing_release TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_game_type ON projects(game_type);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'enterprise')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'past_due', 'canceled', 'trialing')),
      trial_ends_at TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      seats_included INTEGER NOT NULL DEFAULT 1,
      seats_used INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      server_sim_spins INTEGER NOT NULL DEFAULT 0,
      browser_sim_spins INTEGER NOT NULL DEFAULT 0,
      ai_review_calls INTEGER NOT NULL DEFAULT 0,
      export_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage_records(user_id, period_start);

    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_library (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      game_type TEXT NOT NULL CHECK(game_type IN ('slot', 'crash', 'table')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('wizard', 'csv_import', 'manual', 'api_import', 'par_upload')),
      parameters TEXT NOT NULL DEFAULT '{}',
      ai_analysis TEXT,
      ai_analyzed_at TEXT,
      status TEXT NOT NULL DEFAULT 'development' CHECK(status IN ('live', 'development', 'archived', 'concept')),
      release_date TEXT,
      thumbnail_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_game_library_game_type ON game_library(game_type);
    CREATE INDEX IF NOT EXISTS idx_game_library_status ON game_library(status);
    CREATE INDEX IF NOT EXISTS idx_game_library_name ON game_library(name);

    CREATE TABLE IF NOT EXISTS project_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changes TEXT NOT NULL DEFAULT '',
      snapshot TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_project_history_project ON project_history(project_id, timestamp);

    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      permission TEXT NOT NULL DEFAULT 'view' CHECK(permission IN ('view', 'comment')),
      created_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
    CREATE INDEX IF NOT EXISTS idx_share_links_project ON share_links(project_id);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      step INTEGER,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, step);
  `);

  // Additive migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));
  const addCol = (name: string, def: string) => {
    if (!existing.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${def}`);
  };
  addCol("brand", "TEXT NOT NULL DEFAULT ''");
  addCol("team", "TEXT NOT NULL DEFAULT ''");
  addCol("created_by", "TEXT NOT NULL DEFAULT ''");
  addCol("development_start", "TEXT");
  addCol("development_end", "TEXT");
  addCol("tech_release", "TEXT");
  addCol("pre_release", "TEXT");
  addCol("marketing_release", "TEXT");
}

export function resetDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
