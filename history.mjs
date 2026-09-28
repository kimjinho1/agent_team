import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { orgDir } from './db.mjs';

// 코드는 "지금 어떻게 생겼나"만 알려준다. "어쩌다 이렇게 됐나"는 git 이 안다.
//
// 어디가 자주 깨지는지, 최근 어느 방향으로 가고 있는지, 이 팀이 커밋을 어떻게
// 쓰는지는 전부 히스토리에 있다. 그리고 이건 모델에게 물어볼 필요 없이
// git 에서 그대로 뽑을 수 있다 — 토큰도 안 들고 틀릴 일도 없다.

function git(repoPath, args, fallback = '') {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

/** 커밋 제목들에서 이 팀의 작성 관례를 읽어낸다 */
function detectConvention(subjects) {
  if (!subjects.length) return null;
  const conventional = subjects.filter((s) => /^(feat|fix|chore|docs|refactor|test|style|perf|build|ci)(\(.+?\))?!?:/i.test(s)).length;
  const ticket = subjects.filter((s) => /^\[?[A-Z]{2,10}-\d+\]?/.test(s)).length;
  const korean = subjects.filter((s) => /[가-힣]/.test(s)).length;

  const pct = (n) => Math.round((n / subjects.length) * 100);
  const notes = [];
  if (pct(conventional) >= 40) notes.push(`Conventional Commits 형식 (${pct(conventional)}%)`);
  if (pct(ticket) >= 30) notes.push(`티켓 번호 접두 (${pct(ticket)}%)`);
  if (pct(korean) >= 50) notes.push(`한국어 메시지 (${pct(korean)}%)`);
  if (!notes.length) notes.push('뚜렷한 형식 없음');
  return notes.join(' · ');
}

/** 한 repo 의 내력을 git 에서 그대로 뽑는다 */
export function repoHistory(repoPath, name) {
  const count = Number(git(repoPath, ['rev-list', '--count', 'HEAD'], '0')) || 0;
  if (!count) return { name, empty: true };

  const first = git(repoPath, ['log', '--reverse', '--format=%ci', '--max-parents=0']).split('\n')[0] || '';
  const last = git(repoPath, ['log', '-1', '--format=%ci']);
  const subjects = git(repoPath, ['log', '--format=%s', '-n', '300']).split('\n').filter(Boolean);

  const contributors = git(repoPath, ['shortlog', '-sne', 'HEAD'], '')
    .split('\n').filter(Boolean).slice(0, 6)
    .map((l) => l.trim().replace(/\s+/, '  '));

  // 자주 바뀌는 파일 = 활발하거나 불안정한 곳. 건드릴 때 조심해야 하는 신호.
  const touched = {};
  git(repoPath, ['log', '--name-only', '--format=', '-n', '400'])
    .split('\n').map((x) => x.trim()).filter(Boolean)
    .forEach((f) => { touched[f] = (touched[f] || 0) + 1; });
  const hotspots = Object.entries(touched)
    .filter(([f]) => !/^(package-lock|yarn\.lock|pnpm-lock)/.test(path.basename(f)))
    .sort((a, b) => b[1] - a[1]).slice(0, 12);

  const fixes = subjects.filter((s) => /\b(fix|버그|수정|hotfix|bug)\b/i.test(s)).length;
  const reverts = subjects.filter((s) => /^revert/i.test(s)).length;
  const tags = git(repoPath, ['tag', '--sort=-creatordate'], '').split('\n').filter(Boolean).slice(0, 8);
  const branches = git(repoPath, ['branch', '--format=%(refname:short)'], '').split('\n').filter(Boolean);

  // 최근 무엇을 했는지 — 방향을 읽는 근거
  const recent = git(repoPath, ['log', '-n', '25', '--format=%ad  %s', '--date=short'])
    .split('\n').filter(Boolean);

  // 최근 3개월 동안 손댄 영역
  const recentFiles = {};
  git(repoPath, ['log', '--since=3.months', '--name-only', '--format='])
    .split('\n').map((x) => x.trim()).filter(Boolean)
    .forEach((f) => {
      const top = f.split('/').slice(0, 2).join('/');
      recentFiles[top] = (recentFiles[top] || 0) + 1;
    });
  const recentAreas = Object.entries(recentFiles).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return {
    name, empty: false, count, first, last, subjects,
    contributors, hotspots, fixes, reverts, tags, branches, recent, recentAreas,
    convention: detectConvention(subjects),
  };
}

const daysBetween = (a, b) => {
  const d = (Date.parse(b) - Date.parse(a)) / 86400000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
};

/** 사람이 읽을 내력 문서. 모델을 부르지 않는다. */
export function writeHistory(project, repos) {
  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });

  const parts = [];
  for (const r of repos) {
    const h = repoHistory(r.path, r.name);
    if (h.empty) {
      parts.push(`## ${r.name}\n\n커밋이 없습니다. 새로 시작하는 repo 입니다.`);
      continue;
    }

    const age = daysBetween(h.first, h.last);
    const idle = daysBetween(h.last, new Date().toISOString());

    parts.push(`## ${h.name}

| | |
|---|---|
| 커밋 | ${h.count}개 |
| 기간 | ${h.first.slice(0, 10)} ~ ${h.last.slice(0, 10)}${age != null ? ` (${age}일)` : ''} |
| 마지막 작업 | ${idle != null ? `${idle}일 전` : '알 수 없음'} |
| 커밋 관례 | ${h.convention} |
| 수정·버그 커밋 | ${h.fixes}건${h.reverts ? ` · 되돌림 ${h.reverts}건` : ''} |
${h.tags.length ? `| 최근 태그 | ${h.tags.slice(0, 5).join(', ')} |` : ''}

### 만든 사람들
${h.contributors.map((c) => `- ${c}`).join('\n') || '- (없음)'}

### 자주 바뀌는 파일
활발하거나 불안정한 곳입니다. 건드릴 때 특히 조심해야 합니다.

| 파일 | 변경 횟수 |
|---|---|
${h.hotspots.map(([f, n]) => `| \`${f}\` | ${n} |`).join('\n') || '| — | — |'}

### 최근 3개월 손댄 영역
${h.recentAreas.length ? h.recentAreas.map(([a, n]) => `- \`${a}\` (${n}회)`).join('\n') : '- (최근 활동 없음)'}

### 최근 커밋
\`\`\`
${h.recent.slice(0, 20).join('\n') || '(없음)'}
\`\`\`

### 브랜치
${h.branches.slice(0, 12).map((b) => `- ${b}`).join('\n') || '- (없음)'}`);
  }

  const body = `# 프로젝트 내력

_${new Date().toISOString().slice(0, 16).replace('T', ' ')} 기준 · git 에서 그대로 추출_

코드가 "지금 어떻게 생겼나"라면, 이 문서는 "어쩌다 이렇게 됐나"입니다.
새로 작업할 때 이 프로젝트가 어디로 가고 있었는지, 어디가 자주 깨지는지 참고하세요.

${parts.join('\n\n---\n\n')}
`;
  fs.writeFileSync(path.join(dir, 'HISTORY.md'), body);
  return body;
}

/** 코드 파악 단계에 같이 넣을 압축본 */
export function historyBrief(repos, limit = 2200) {
  const lines = [];
  for (const r of repos) {
    const h = repoHistory(r.path, r.name);
    if (h.empty) { lines.push(`[${r.name}] 커밋 없음 (새 repo)`); continue; }
    lines.push(
      `[${h.name}] 커밋 ${h.count}개 · ${h.first.slice(0, 10)}~${h.last.slice(0, 10)} · 관례: ${h.convention}`,
      `  자주 바뀐 파일: ${h.hotspots.slice(0, 6).map(([f, n]) => `${f}(${n})`).join(', ') || '없음'}`,
      `  최근 손댄 영역: ${h.recentAreas.slice(0, 5).map(([a]) => a).join(', ') || '없음'}`,
      `  최근 커밋:\n${h.recent.slice(0, 12).map((c) => `    ${c}`).join('\n')}`
    );
  }
  const text = lines.join('\n');
  return text ? `[git 내력]\n${text.slice(0, limit)}` : '';
}

/** 팀 프롬프트에 실을 내력 요약 */
export function historyContext(project, limit = 2500) {
  try {
    const raw = fs.readFileSync(path.join(orgDir(project), 'knowledge', 'HISTORY.md'), 'utf8');
    return `[프로젝트 내력]\n${raw.slice(0, limit)}`;
  } catch {
    return '';
  }
}
