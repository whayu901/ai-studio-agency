import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env";

/**
 * SQLite (Node's built-in node:sqlite, no native install) is the source of truth for campaigns,
 * jobs, state history, approvals, renders, reviews, orchestration runs and costs.
 * Media and production documents stay as files under the repo (outputs/, assets/).
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE campaigns (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
     creation_mode TEXT NOT NULL, performance_mode TEXT NOT NULL, video_provider TEXT NOT NULL,
     character_id TEXT NOT NULL, language TEXT NOT NULL, duration_seconds REAL NOT NULL,
     is_test INTEGER NOT NULL DEFAULT 0, brief_path TEXT, data TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE brief_revisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL REFERENCES campaigns(id), job_id TEXT,
     revision INTEGER NOT NULL, brief TEXT NOT NULL, source TEXT NOT NULL, author TEXT,
     valid INTEGER NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE jobs (
     id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), character_id TEXT NOT NULL,
     creation_mode TEXT NOT NULL, performance_mode TEXT NOT NULL, video_provider TEXT NOT NULL,
     ai_mode TEXT NOT NULL, state TEXT NOT NULL, state_before_failure TEXT, is_test INTEGER NOT NULL DEFAULT 0,
     production_path TEXT NOT NULL, reference_manifest TEXT, analysis_path TEXT,
     retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, version INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE job_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), ts TEXT NOT NULL,
     from_state TEXT, to_state TEXT NOT NULL, actor_type TEXT NOT NULL, actor_name TEXT,
     source TEXT NOT NULL, execution_id TEXT, reason TEXT)`,
  `CREATE TABLE approvals (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), gate TEXT NOT NULL,
     decision TEXT NOT NULL, reviewer TEXT NOT NULL, notes TEXT, artifact_sha256 TEXT, ts TEXT NOT NULL)`,
  `CREATE TABLE renders (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), clip_id TEXT NOT NULL,
     attempt INTEGER NOT NULL, path TEXT NOT NULL, provider TEXT NOT NULL, original_name TEXT,
     bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, probe TEXT, contact_sheet TEXT, first_frame TEXT,
     credits REAL, est_cost REAL, currency TEXT, is_test_media INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL, uploaded_at TEXT NOT NULL)`,
  `CREATE TABLE qc_reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), render_ids TEXT NOT NULL,
     scores TEXT NOT NULL, defects TEXT NOT NULL, comments TEXT, overall REAL, passed INTEGER NOT NULL,
     decision TEXT NOT NULL, reviewer TEXT, ts TEXT NOT NULL)`,
  `CREATE TABLE orchestration_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, workflow TEXT NOT NULL, execution_id TEXT,
     idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
     last_error TEXT, request TEXT, response TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE idempotency (
     key TEXT PRIMARY KEY, job_id TEXT, operation TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, provider TEXT NOT NULL, kind TEXT NOT NULL,
     units REAL, unit_type TEXT, amount REAL, currency TEXT, note TEXT, ts TEXT NOT NULL)`,
  `CREATE TABLE packages (
     id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), dir TEXT NOT NULL,
     zip_path TEXT NOT NULL, manifest TEXT NOT NULL, is_test INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX idx_events_job ON job_events(job_id, id)`,
  `CREATE INDEX idx_renders_job ON renders(job_id, clip_id)`,
  `CREATE INDEX idx_runs_exec ON orchestration_runs(execution_id)`,
];

let _db: DatabaseSync | null = null;
let _path = "";

export function db(): DatabaseSync {
  const p = env().dbPath;
  if (_db && _path === p) return _db;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const d = new DatabaseSync(p);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  d.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = d.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    d.exec("BEGIN");
    try {
      d.exec(MIGRATIONS[i]);
      d.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(i + 1, now());
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  }
  _db = d;
  _path = p;
  return d;
}

export function now(): string {
  return new Date().toISOString();
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** For tests: drop the cached handle so the next call opens ACS_DATA_DIR afresh. */
export function resetDbForTests() {
  _db?.close();
  _db = null;
  _path = "";
}
