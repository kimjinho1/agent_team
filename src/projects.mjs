import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// 이 팀은 남의 repo 안에서 일한다. 그래서 우리 문서를 그 repo 안에 쌓지 않는다.
//
//   코드 변경  → 그 repo 의 브랜치에 (repo 가 주인)
//   프로젝트 문서 → ~/.agent-org/projects/<이름>/ 에 (도구가 주인)
//
// repo 가 여러 개인 작업 폴더에서는 계약이 repo 경계를 넘는다. 그런 문서를
// 어느 한 repo 안에 두면 반쪽이 되므로 중앙에 둔다.

export function homeDir() {
  return process.env.AGENT_ORG_HOME || path.join(os.homedir(), '.agent-org');
}

/** 작업 폴더 아래의 git repo 들을 찾는다 (두 단계까지만 내려간다) */
const MAX_DEPTH = 2;

function scanRepos(workspace) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    if (entries.some((e) => e.name === '.git')) {
      found.push({ path: dir, name: path.basename(dir), origin: originOf(dir) });
      return;   // repo 안의 repo 는 캐지 않는다
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(workspace, 0);
  return found;
}

function originOf(repoPath) {
  try {
    return execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch { return null; }
}

/** 커밋 안 된 변경이 있으면 건드리기 전에 알아야 한다 */
export function isDirty(repoPath) {
  try {
    const out = execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch { return false; }
}

export function currentBranch(repoPath) {
  try {
    return execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

const slug = (s) =>
  s.replace(/[^가-힣a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * 작업 폴더가 어떤 프로젝트인지 정한다.
 *
 * 기준은 **작업 폴더 경로**다. repo 가 겹친다고 같은 프로젝트로 합치지 않는다.
 * 공유 라이브러리 repo 를 여러 프로젝트가 함께 쓰는 일이 흔한데, 그걸 근거로
 * 합치면 서로 다른 프로젝트의 계약과 결정이 한 문서에 섞여버린다.
 *
 * 폴더를 옮겨서 경로가 안 맞을 때만 origin 으로 후보를 찾아 제안한다.
 * 제안일 뿐 자동으로 잇지 않는다 (link 로 사용자가 확정).
 */
export function resolveProject(workspace, { link = null } = {}) {
  const abs = path.resolve(workspace);
  const repos = scanRepos(abs);
  const registryPath = path.join(homeDir(), 'projects.json');
  const registry = readJson(registryPath) || { projects: [] };

  const origins = repos.map((r) => r.origin).filter(Boolean);

  let entry = registry.projects.find((p) => p.workspaces?.includes(abs));
  let suggestion = null;

  if (!entry && link) {
    entry = registry.projects.find((p) => p.name === link);
    if (entry) entry.workspaces = [...new Set([...(entry.workspaces || []), abs])];
  }

  if (!entry) {
    // 경로로는 못 찾았다. 폴더를 옮긴 것일 수도 있으니 origin 으로 후보만 찾는다.
    const candidate = origins.length
      ? registry.projects.find((p) => (p.origins || []).some((o) => origins.includes(o)))
      : null;
    if (candidate) suggestion = candidate.name;

    const base = slug(path.basename(abs)) || 'project';
    let name = base;
    if (registry.projects.some((p) => p.name === name)) {
      // 흔한 이름이면 상위 폴더까지 붙여 구분한다 (frontend-2 보다 낫다)
      const parent = slug(path.basename(path.dirname(abs)));
      name = parent ? `${parent}-${base}` : base;
      let n = 2;
      while (registry.projects.some((p) => p.name === name)) name = `${base}-${n++}`;
    }

    entry = {
      name,
      workspaces: [abs],
      origins,
      createdAt: new Date().toISOString(),
    };
    registry.projects.push(entry);
  } else {
    entry.origins = [...new Set([...(entry.origins || []), ...origins])];
  }

  entry.lastSeenAt = new Date().toISOString();

  const dir = path.join(homeDir(), 'projects', entry.name);
  fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  writeJson(registryPath, registry);

  writeJson(path.join(dir, 'repos.json'), {
    workspace: abs,
    scannedAt: new Date().toISOString(),
    repos: repos.map((r) => ({
      name: r.name, path: r.path, origin: r.origin,
      branch: currentBranch(r.path), dirty: isDirty(r.path),
    })),
  });

  // 같은 repo 를 쓰는 다른 프로젝트는 합치지 않고 관계로만 남긴다
  const related = registry.projects
    .filter((p) => p.name !== entry.name && (p.origins || []).some((o) => origins.includes(o)))
    .map((p) => p.name);

  writeIndex(registry);
  return { name: entry.name, dir, workspace: abs, repos, related, suggestion };
}

/** 프로젝트가 늘어도 한 장으로 파악되게 */
function writeIndex(registry) {
  const rows = [...registry.projects]
    .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
    .map((p) => `| [${p.name}](./projects/${p.name}/README.md) | ${(p.lastSeenAt || '').slice(0, 10)} | ${(p.workspaces || [])[0] || '—'} |`)
    .join('\n');

  const body = `# 프로젝트 목록

이 맥에서 AI 팀이 일한 프로젝트들. 최근 순.

| 프로젝트 | 마지막 작업 | 작업 폴더 |
|---|---|---|
${rows}

각 프로젝트의 현재 상태는 \`projects/<이름>/knowledge/\`, 지난 기록은 \`runs/\` 에 있다.
`;
  try { fs.writeFileSync(path.join(homeDir(), 'index.md'), body); } catch { /* 색인 실패는 치명적이지 않다 */ }
}

export function renameProject(from, to) {
  const registryPath = path.join(homeDir(), 'projects.json');
  const registry = readJson(registryPath) || { projects: [] };
  const entry = registry.projects.find((p) => p.name === from);
  if (!entry) return { ok: false, error: `프로젝트 없음: ${from}` };
  if (registry.projects.some((p) => p.name === to)) return { ok: false, error: `이미 있는 이름: ${to}` };

  const oldDir = path.join(homeDir(), 'projects', from);
  const newDir = path.join(homeDir(), 'projects', to);
  try { if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir); } catch (e) { return { ok: false, error: String(e.message) }; }

  entry.name = to;
  writeJson(registryPath, registry);
  writeIndex(registry);
  return { ok: true };
}

export function forgetProject(name) {
  const registryPath = path.join(homeDir(), 'projects.json');
  const registry = readJson(registryPath) || { projects: [] };
  const before = registry.projects.length;
  registry.projects = registry.projects.filter((p) => p.name !== name);
  if (registry.projects.length === before) return { ok: false, error: `프로젝트 없음: ${name}` };
  writeJson(registryPath, registry);
  writeIndex(registry);
  return { ok: true, dir: path.join(homeDir(), 'projects', name) };
}

export function listProjects() {
  const registry = readJson(path.join(homeDir(), 'projects.json')) || { projects: [] };
  return registry.projects;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
