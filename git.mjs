import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 팀이 만든 코드를 실제 repo 에 남긴다. 남의 저장소를 건드리는 일이라
// 규칙을 좁게 잡는다.
//
//   - 커밋 안 된 변경이 있으면 시작하지 않는다 (남의 작업을 덮을 수 있다)
//   - 항상 새 브랜치를 판다. 기존 브랜치에 직접 커밋하지 않는다
//   - push 하지 않는다. 원격에 올릴지는 사람이 정한다
//   - force 는 쓰지 않는다

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function tryGit(repoPath, args, fallback = null) {
  try { return git(repoPath, args); } catch { return fallback; }
}

export function isRepo(repoPath) {
  return tryGit(repoPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/** 시작 전 점검. 하나라도 걸리면 코드를 쓰지 않는다. */
export function checkWritable(repos) {
  const problems = [];
  for (const r of repos) {
    if (!isRepo(r.path)) { problems.push(`${r.name}: git 저장소가 아닙니다`); continue; }
    const dirty = tryGit(r.path, ['status', '--porcelain'], '');
    if (dirty) {
      const n = dirty.split('\n').filter(Boolean).length;
      problems.push(`${r.name}: 커밋 안 된 변경 ${n}건이 있습니다 (커밋하거나 stash 후 다시 시도하세요)`);
    }
    if (!tryGit(r.path, ['rev-parse', 'HEAD'])) {
      problems.push(`${r.name}: 커밋이 하나도 없습니다 (최초 커밋을 먼저 만들어 주세요)`);
    }
  }
  return { ok: problems.length === 0, problems };
}

const branchSlug = (s) =>
  s.replace(/[^가-힣a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';

/** `agent-org/<날짜>-<일감>` 브랜치를 판다 */
export function startBranch(repoPath, requirement, taskId) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `agent-org/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${branchSlug(requirement)}-${taskId}`;
  const from = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
  try {
    git(repoPath, ['checkout', '-b', name]);
    return { ok: true, branch: name, from };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).trim() };
  }
}

/** 이전 브랜치로 돌려놓는다 (작업 끝난 뒤 원상복귀) */
export function returnTo(repoPath, branch) {
  if (!branch) return;
  tryGit(repoPath, ['checkout', branch]);
}

/**
 * 파일을 repo 안에 쓴다. 경로가 repo 밖으로 나가면 거부한다.
 */
export function writeIntoRepo(repoPath, relPath, content) {
  const target = path.resolve(repoPath, relPath);
  const root = path.resolve(repoPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { ok: false, error: `repo 밖 경로 거부: ${relPath}` };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { ok: true, path: target };
}

/** 바뀐 것만 커밋한다. 바뀐 게 없으면 커밋하지 않는다. */
export function commitAll(repoPath, message) {
  const dirty = tryGit(repoPath, ['status', '--porcelain'], '');
  if (!dirty) return { ok: true, committed: false };
  try {
    git(repoPath, ['add', '-A']);
    git(repoPath, [
      '-c', 'user.name=agent-org',
      '-c', 'user.email=agent-org@localhost',
      'commit', '-m', message,
    ]);
    const sha = tryGit(repoPath, ['rev-parse', '--short', 'HEAD']);
    const files = tryGit(repoPath, ['show', '--name-only', '--format=', 'HEAD'], '')
      .split('\n').filter(Boolean);
    return { ok: true, committed: true, sha, files };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).trim() };
  }
}

const PREFIX = 'agent-org/';

/**
 * 이 도구가 만든 브랜치들의 현재 상태.
 *
 * 머지됐는지는 "기본 브랜치에 이 커밋이 들어가 있는가"로 판단한다.
 * 머지 안 된 브랜치를 지우면 작업이 사라지므로 반드시 구분해야 한다.
 */
export function listBranches(repoPath) {
  if (!isRepo(repoPath)) return [];

  const base = baseBranch(repoPath);
  const merged = new Set(
    (tryGit(repoPath, ['branch', '--merged', base, '--format=%(refname:short)'], '') || '')
      .split('\n').map((x) => x.trim()).filter(Boolean)
  );
  const current = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  return (tryGit(repoPath, ['branch', '--format=%(refname:short)'], '') || '')
    .split('\n').map((x) => x.trim()).filter((b) => b.startsWith(PREFIX))
    .map((b) => ({
      name: b,
      merged: merged.has(b),
      current: b === current,
      sha: tryGit(repoPath, ['rev-parse', '--short', b]),
      subject: tryGit(repoPath, ['log', '-1', '--format=%s', b]),
      date: tryGit(repoPath, ['log', '-1', '--format=%ci', b], '').slice(0, 10),
      ahead: Number(tryGit(repoPath, ['rev-list', '--count', `${base}..${b}`], '0')) || 0,
    }));
}

/** 기본 브랜치 추정 — main/master 중 있는 것 */
export function baseBranch(repoPath) {
  const head = tryGit(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], '');
  if (head) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (tryGit(repoPath, ['rev-parse', '--verify', b])) return b;
  }
  return tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
}

/**
 * 브랜치를 지운다.
 *
 * 머지 안 된 브랜치는 기본적으로 거부한다. 지우면 그 작업이 사라지기 때문이다.
 * 정말 버릴 때만 force 를 명시해야 한다.
 */
export function deleteBranch(repoPath, name, { force = false } = {}) {
  if (!name.startsWith(PREFIX)) {
    return { ok: false, error: `이 도구가 만든 브랜치가 아닙니다: ${name}` };
  }
  const current = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (name === current) {
    return { ok: false, error: '지금 체크아웃된 브랜치는 지울 수 없습니다' };
  }
  try {
    git(repoPath, ['branch', force ? '-D' : '-d', name]);
    return { ok: true };
  } catch (e) {
    const msg = String(e.stderr || e.message).trim();
    return {
      ok: false,
      error: /not fully merged/i.test(msg)
        ? '아직 머지되지 않았습니다 (버리려면 --force)'
        : msg,
    };
  }
}

/** 기본 브랜치에 머지한다 */
export function mergeBranch(repoPath, name) {
  if (!name.startsWith(PREFIX)) {
    return { ok: false, error: `이 도구가 만든 브랜치가 아닙니다: ${name}` };
  }
  const dirty = tryGit(repoPath, ['status', '--porcelain'], '');
  if (dirty) return { ok: false, error: '커밋 안 된 변경이 있습니다' };

  const base = baseBranch(repoPath);
  const from = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  try {
    git(repoPath, ['checkout', base]);
    git(repoPath, ['merge', '--no-ff', name, '-m', `Merge ${name}`]);
    const sha = tryGit(repoPath, ['rev-parse', '--short', 'HEAD']);
    return { ok: true, base, sha };
  } catch (e) {
    // 충돌이면 되돌려 놓는다 — 반쯤 머지된 상태로 두지 않는다
    tryGit(repoPath, ['merge', '--abort']);
    tryGit(repoPath, ['checkout', from]);
    return { ok: false, error: String(e.stderr || e.message).trim().split('\n')[0] };
  }
}

/** 어느 repo 에 무엇을 썼는지 한 줄 요약 */
export function describeResult(results) {
  return results
    .map((r) =>
      r.committed
        ? `${r.repo}: ${r.branch} (${r.sha}) — 파일 ${r.files.length}개`
        : `${r.repo}: 변경 없음`
    )
    .join('\n');
}
