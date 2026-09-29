import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT,
  output TEXT,
  cost_usd REAL,
  started_at TEXT,
  completed_at TEXT
);
`;

// Applied defensively so databases created by older versions keep working.
const MIGRATIONS = [
  'ALTER TABLE stages ADD COLUMN tokens_input INTEGER',
  'ALTER TABLE stages ADD COLUMN tokens_output INTEGER',
  'ALTER TABLE stages ADD COLUMN tokens_cache_read INTEGER',
  'ALTER TABLE stages ADD COLUMN tokens_cache_creation INTEGER',
  'ALTER TABLE stages ADD COLUMN role_key TEXT',
  'ALTER TABLE stages ADD COLUMN artifact_path TEXT',
  'ALTER TABLE stages ADD COLUMN attempt INTEGER DEFAULT 0',
  'ALTER TABLE stages ADD COLUMN instance INTEGER DEFAULT 0',
  'ALTER TABLE stages ADD COLUMN assignment TEXT',
  'ALTER TABLE stages ADD COLUMN review_status TEXT',
  'ALTER TABLE tasks ADD COLUMN roster TEXT',
  'ALTER TABLE tasks ADD COLUMN hire_reason TEXT',
  'ALTER TABLE tasks ADD COLUMN stack TEXT',
  'ALTER TABLE tasks ADD COLUMN kind TEXT',
  'ALTER TABLE tasks ADD COLUMN git_result TEXT',
  'ALTER TABLE tasks ADD COLUMN git_note TEXT',
  'ALTER TABLE stages ADD COLUMN step_index INTEGER',
  'ALTER TABLE stages ADD COLUMN step_total INTEGER',
  'ALTER TABLE stages ADD COLUMN step_label TEXT',
  'ALTER TABLE tasks ADD COLUMN workspace TEXT',
  'ALTER TABLE tasks ADD COLUMN run_dir TEXT',
];

/**
 * 프로젝트 문서와 DB 가 사는 곳.
 *
 * 남의 repo 안이 아니라 ~/.agent-org/projects/<이름>/ 에 둔다. 작업 폴더에
 * repo 가 여러 개면 계약이 repo 경계를 넘기 때문에, 어느 한 repo 안에 두면
 * 반쪽이 된다. 코드 변경만 각 repo 의 브랜치로 간다.
 */
export function orgDir(project) {
  if (typeof project === 'string') return project;   // 이미 경로면 그대로
  return project.dir;
}

export function stateDir(project) {
  return path.join(orgDir(project), '.state');
}

export function openDb(project) {
  const dir = stateDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'agent-org.db'));
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  for (const sql of MIGRATIONS) {
    try { db.exec(sql); } catch (e) { /* 이미 있는 컬럼 */ }
  }
  return db;
}
