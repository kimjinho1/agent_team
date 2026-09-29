import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, ROLE_BY_KEY, artifactOf } from './roles.mjs';
const ROLES = CATALOG;
import { orgDir } from './db.mjs';
const KEEP_RUNS = 20;   // 그 위로는 _archive 로 내린다

// The org is defined once in roles.mjs. Every document here is generated from
// it, so the charter, the job descriptions and the run records can never drift
// away from what the team actually does.

const pad = (n) => String(n).padStart(2, '0');

/** `06-fe1-index.html` — 순서와 담당자가 파일명에 드러난다 */
export function artifactName(person, stack) {
  const i = ROLES.findIndex((r) => r.key === person.key);
  const who = person.total > 1 ? `${person.key}${person.instance + 1}` : person.key;
  // 기록 폴더는 평탄하게 둔다. src/server.js 같은 실제 경로는 스택에 남아 있고,
  // 코드가 repo 로 갈 때 그 경로를 쓴다.
  const file = path.basename(artifactOf(person.key, stack));
  return `${pad(i + 1)}-${who}-${file}`;
}

/**
 * 이 산출물이 repo 안에서 가야 할 자리.
 *
 * 같은 직무를 둘 이상 뽑으면 각자 파일 전체를 쓰기 때문에 한 경로에 몰면
 * 서로 덮어쓴다. 2번째부터는 파일명을 갈라 둔다.
 */
export function repoPathOf(person, stack) {
  const rel = artifactOf(person.key, stack);
  if (!person.total || person.total <= 1) return rel;
  const dir = path.dirname(rel);
  const ext = path.extname(rel);
  const base = path.basename(rel, ext);
  const name = `${base}-${person.instance + 1}${ext}`;
  return dir === '.' ? name : path.join(dir, name);
}

// ---------------------------------------------------------------- charter

/** 회사 운영 규칙 — ORG.md 본문 */
function orgDoc() {
  const byCat = {};
  ROLES.forEach((r) => { (byCat[r.category] = byCat[r.category] || []).push(r); });

  return `# 이 회사는 어떻게 일하는가

일감 하나를 받아 **동작하는 산출물**까지 만든다.
고정된 팀은 없다. 일을 받을 때마다 **필요한 직무를 필요한 인원만큼 고용**한다.

## 원칙

1. **사람은 산출물로 말한다.** 회의도 잡담도 없다. 남는 건 파일뿐이다.
2. **필요한 사람만 뽑는다.** 안 쓸 자리는 만들지 않는다.
3. **빠진 자리는 보강한다.** 화면을 만드는데 디자이너가 없거나, 만들 사람이 아무도 없으면 자동으로 채운다.
4. **계약이 병렬을 만든다.** 개발리드가 인터페이스를 먼저 못 박기에 구현 인원이 서로 묻지 않고 동시에 짠다.
5. **같은 직무도 여럿일 수 있다.** 일이 충분히 크면 범위를 쪼개 나눠 맡는다.
6. **판정은 근거를 댄다.** QA는 재현 경로 없는 지적을 하지 않는다. FAIL이면 다시 만든다.

## 고용 가능한 직무 (${ROLES.length}종)

${Object.entries(byCat).map(([cat, list]) => `### ${cat}

| 직무 | 하는 일 | 산출물 | 선행 |
|---|---|---|---|
${list.map((r) => `| ${r.label}${r.core ? ' *(필수)*' : ''}${r.splittable ? ' *(분할 가능)*' : ''} | ${r.blurb} | \`${r.defaultArtifact}\` | ${r.deps.length ? r.deps.map((d) => ROLE_BY_KEY[d].label).join(', ') : '—'} |`).join('\n')}`).join('\n\n')}

*(필수)* 는 항상 고용된다. *(분할 가능)* 은 일이 크면 여러 명을 뽑아 범위를 나눈다.

## 실행 순서

선행 직무가 모두 끝난 사람부터 **동시에** 시작한다. 실제 차수는 그때 뽑은 팀에 따라 달라지며,
각 실행의 \`README.md\`에 기록된다.

## 폴더 구조

\`\`\`
agent-org/
├── ORG.md              이 문서 — 회사 운영 규칙
├── roles/              직무 정의서 (직무별 1장)
├── knowledge/          실행을 거치며 쌓이는 학습과 성적표
└── runs/<날짜-일감>/
    ├── README.md       실행 요약 — 여기부터 보면 된다
    ├── 00-team.md      이번에 누구를 왜 뽑았나
    ├── HANDOFF.md      인계 기록
    └── NN-담당자-산출물
\`\`\`

각 문서는 설명을 늘리지 않고 **다음 사람이 일을 시작할 최소 정보**만 담는다.
`;
}

/** 직무 정의서 한 장 — 무엇을 받아 무엇을 내고 누구에게 넘기는지 */
function roleDoc(role) {
  const from = role.deps.length
    ? role.deps.map((d) => `\`${ROLE_BY_KEY[d].artifact}\` (${ROLE_BY_KEY[d].label})`).join('\n- ')
    : '사용자 요구사항 한 줄';
  const to = ROLES.filter((r) => r.deps.includes(role.key)).map((r) => r.label);

  return `# ${role.label}

> ${role.systemPrompt.split('\n')[0]}

## 산출물
\`${role.defaultArtifact}\` — ${role.mode === 'revise' ? '단계마다 파일 전체를 다시 쓰며 완성도를 올린다' : '단계마다 섹션을 더해 쌓는다'}

## 입력
- ${from}

## 넘기는 곳
${to.length ? to.map((t) => `- ${t}`).join('\n') : '- 없음 (파이프라인 종료)'}

## 작업 단계
${(role.steps || []).map((s, k) => `${k + 1}. **${s.label}** — ${s.prompt.split('\n').pop().trim()}`).join('\n')}

## 지키는 것
${role.systemPrompt.split('\n').slice(1).filter(Boolean).map((l) => `- ${l.trim()}`).join('\n') || '- 위 역할 정의를 따른다'}
`;
}

/** 회사 규칙과 직무 정의서를 보관 폴더에 깐다 */
export function writeCharter(workspace) {
  const dir = orgDir(workspace);
  fs.mkdirSync(path.join(dir, 'roles'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'ORG.md'), orgDoc());
  ROLES.forEach((role, i) => {
    fs.writeFileSync(path.join(dir, 'roles', `${pad(i + 1)}-${role.key}.md`), roleDoc(role));
  });
}

// ---------------------------------------------------------------- run record

const fmtDur = (a, b) => {
  if (!a || !b) return '—';
  const s = Math.max(0, Math.round((Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function writeRunDocs(runDir, { taskId, requirement, status, stages, roster = [], reason = '' }) {
  const verdictRow = stages.find((s) => /판정:\s*(PASS|FAIL)/.test(s.output || ''));
  const verdict = verdictRow ? verdictRow.output.match(/판정:\s*(PASS|FAIL)/)[1] : null;
  const totalCost = stages.reduce((n, s) => n + (s.cost_usd || 0), 0);

  const rows = stages.map((s, i) => {
    const mark = { done: '완료', failed: '실패', blocked: '중단', cancelled: '중단됨' }[s.status] || '—';
    const file = s.artifact_path ? s.artifact_path.split('/').pop() : null;
    return `| ${pad(i + 1)} | ${s.role} | ${mark} | ${fmtDur(s.started_at, s.completed_at)} | $${(s.cost_usd || 0).toFixed(3)} | ${file ? `[\`${file}\`](./${file})` : '—'} |`;
  }).join('\n');

  const waveText = rosterWaves(roster)
    .map((w, i) => `${i + 1}차  ${w.join(' , ')}`).join('\n');

  const readme = `# Task #${taskId}

**요구사항**  ${requirement}

**결과**  ${status === 'done' ? '완주' : '실패'}${verdict ? ` · QA 판정 **${verdict}**` : ''} · 총 $${totalCost.toFixed(3)}

**편성**  ${reason}

## 이번 팀

| # | 담당자 | 상태 | 소요 | 비용 | 산출물 |
|---|---|---|---|---|---|
${rows}

## 동시 실행 구간

\`\`\`
${waveText}
\`\`\`

${verdict === 'FAIL' ? '> QA가 **FAIL** 판정했다. 상세 근거와 PASS 조건은 QA 보고서를 볼 것.\n' : ''}
## 어디부터 보면 되나

1. \`00-team.md\` — 누가 무엇을 맡았나
2. \`00-requirement.md\` — 무엇을 만들라고 했나
3. 위 표의 산출물을 순서대로
`;
  fs.writeFileSync(path.join(runDir, 'README.md'), readme);

  const present = new Set(stages.map((s) => s.role_key));
  const handoff = `# 인계 기록 — Task #${taskId}

누가 무엇을 만들어 누구에게 넘겼는지.

${stages.map((s) => {
  const to = ROLES.filter((x) => x.deps.includes(s.role_key) && present.has(x.key)).map((x) => x.label);
  const head = (s.output || '').split('\n').find((l) => l.trim()) || '';
  return `## ${s.role} → ${to.join(', ') || '(종료)'}
- 맡은 범위: ${s.assignment || '전체'}
- 산출물: \`${s.artifact_path ? s.artifact_path.split('/').pop() : '—'}\`
- 상태: ${s.status || '—'}
- 첫 줄: ${head.slice(0, 90).replace(/[#*`]/g, '') || '—'}`;
}).join('\n\n')}
`;
  fs.writeFileSync(path.join(runDir, 'HANDOFF.md'), handoff);
}

/** 이번 팀 안에서 동시에 일할 수 있는 묶음 */
function rosterWaves(roster) {
  const titleOf = (p) => (p.total > 1 ? `${ROLE_BY_KEY[p.key].label} ${p.instance + 1}` : ROLE_BY_KEY[p.key].label);
  const depth = {};
  const of = (p) => {
    const id = `${p.key}#${p.instance}`;
    if (depth[id] != null) return depth[id];
    const deps = roster.filter((o) => ROLE_BY_KEY[p.key].deps.includes(o.key));
    depth[id] = deps.length ? 1 + Math.max(...deps.map(of)) : 0;
    return depth[id];
  };
  const out = [];
  roster.forEach((p) => {
    const d = of(p);
    (out[d] = out[d] || []).push(titleOf(p));
  });
  return out.filter(Boolean);
}

/**
 * 프로젝트 한 장 요약. 문서가 쌓여도 "지금 뭐가 어떤 상태인지"를 여기서 본다.
 * 현재 상태(knowledge)와 과거 기록(runs)을 분리해 두는 게 핵심이다.
 */
export function writeProjectReadme(project, db) {
  const dir = orgDir(project);
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 5').all();
  const total = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  const cost = db.prepare('SELECT SUM(COALESCE(cost_usd,0)) c FROM stages').get().c || 0;

  const repos = readJson(path.join(dir, 'repos.json'));
  const repoRows = (repos?.repos || [])
    .map((r) => `| ${r.name} | ${r.branch || '—'} | ${r.origin || '(로컬)'} | ${r.dirty ? '⚠ 커밋 안 된 변경' : '깨끗함'} |`)
    .join('\n') || '| — | — | git repo 없음 | — |';

  const recent = tasks
    .map((t) => `| ${(t.created_at || '').slice(0, 10)} | ${t.requirement.slice(0, 44).replace(/\|/g, '/')} | ${t.status} |`)
    .join('\n') || '| — | 아직 없음 | — |';

  const knowledge = ['CODEBASE.md', 'CONTRACTS.md', 'DECISIONS.md', 'BACKLOG.md', 'track-record.md', 'qa-findings.md']
    .filter((f) => fs.existsSync(path.join(dir, 'knowledge', f)))
    .map((f) => `- [${f}](./knowledge/${f})`)
    .join('\n') || '- 아직 쌓인 문서 없음';

  const body = `# ${project.name || path.basename(dir)}

작업 폴더 \`${repos?.workspace || '—'}\`
실행 ${total}건 · 누적 $${cost.toFixed(2)}${project.related?.length ? `\n관련 프로젝트: ${project.related.join(', ')} (repo 공유)` : ''}

## 지금 상태

${knowledge}

## repo

| 이름 | 브랜치 | origin | 상태 |
|---|---|---|---|
${repoRows}

코드 변경은 각 repo 의 \`agent-org/<작업명>\` 브랜치로 갑니다. 이 폴더에는 문서만 있습니다.

## 최근 작업

| 날짜 | 일감 | 결과 |
|---|---|---|
${recent}

전체 기록은 [runs/index.md](./runs/index.md)
`;
  fs.writeFileSync(path.join(dir, 'README.md'), body);
}

/** 실행 목록 한 장 + 오래된 것은 _archive 로 */
export function writeRunsIndex(project, db) {
  const runsDir = path.join(orgDir(project), 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  const rows = tasks.map((t) => {
    const folder = t.run_dir ? path.basename(t.run_dir) : null;
    const archived = folder && !fs.existsSync(path.join(runsDir, folder));
    const link = folder
      ? `[${folder}](./${archived ? '_archive/' : ''}${folder}/README.md)`
      : '—';
    return `| ${t.id} | ${(t.created_at || '').slice(0, 16)} | ${t.requirement.slice(0, 40).replace(/\|/g, '/')} | ${t.status} | ${link} |`;
  }).join('\n');

  fs.writeFileSync(path.join(runsDir, 'index.md'), `# 실행 기록

| # | 시각 | 일감 | 결과 | 폴더 |
|---|---|---|---|---|
${rows}
`);

  // 최근 것만 남기고 나머지는 내린다 (목록에는 그대로 남아 추적 가능)
  try {
    const folders = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_archive')
      .map((e) => e.name)
      .sort()
      .reverse();
    if (folders.length > KEEP_RUNS) {
      const archive = path.join(runsDir, '_archive');
      fs.mkdirSync(archive, { recursive: true });
      for (const old of folders.slice(KEEP_RUNS)) {
        fs.renameSync(path.join(runsDir, old), path.join(archive, old));
      }
    }
  } catch { /* 정리 실패가 실행을 막지는 않는다 */ }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** What this org has actually done so far — the record behind the charter. */
export function writeTrackRecord(project, db) {
  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });

  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  if (!tasks.length) return;

  const perRole = db
    .prepare(
      `SELECT role,
              COUNT(*) AS n,
              SUM(COALESCE(cost_usd,0)) AS cost,
              AVG(COALESCE(cost_usd,0)) AS avg_cost
       FROM stages WHERE status = 'done' GROUP BY role`
    )
    .all();
  const roleMap = Object.fromEntries(perRole.map((r) => [r.role, r]));

  const totalCost = db
    .prepare('SELECT SUM(COALESCE(cost_usd,0)) c FROM stages')
    .get().c || 0;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;

  const verdicts = db
    .prepare("SELECT task_id, output FROM stages WHERE role_key = 'qa' AND output IS NOT NULL")
    .all();
  const pass = verdicts.filter((v) => /판정:\s*PASS/.test(v.output)).length;
  const fail = verdicts.filter((v) => /판정:\s*FAIL/.test(v.output)).length;

  const body = `# 팀 기록

실행할 때마다 갱신된다. 숫자가 조직의 실제 모습이다.

## 전체

| 항목 | 값 |
|---|---|
| 총 실행 | ${tasks.length}건 |
| 완주 | ${doneTasks}건 |
| QA 판정 | PASS ${pass} · FAIL ${fail} |
| 누적 비용 | $${totalCost.toFixed(2)} |
| 실행당 평균 | $${(totalCost / tasks.length).toFixed(2)} |

## 역할별

| 역할 | 처리 | 누적 비용 | 건당 평균 |
|---|---|---|---|
${ROLES.map((r) => {
  const m = roleMap[r.label];
  return `| ${r.label} | ${m ? m.n : 0} | $${(m ? m.cost : 0).toFixed(2)} | $${(m ? m.avg_cost : 0).toFixed(2)} |`;
}).join('\n')}

## 실행 목록

| # | 요구사항 | 결과 |
|---|---|---|
${tasks.slice(-15).reverse().map((t) =>
  `| ${t.id} | ${t.requirement.slice(0, 40).replace(/\|/g, '/')} | ${t.status} |`
).join('\n')}
`;
  fs.writeFileSync(path.join(dir, 'track-record.md'), body);
}

/** Lessons that outlive a single run — QA findings worth remembering. */
export function appendKnowledge(project, taskId, qaOutput) {
  if (!qaOutput) return;
  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'qa-findings.md');

  // QA words its findings differently run to run, so key off 심각도 rather than
  // any one heading style.
  const findings = [];
  for (const line of qaOutput.split('\n')) {
    if (!/심각도/.test(line)) continue;
    // titles only — headings or list/bold items, not prose that happens to mention 심각도
    if (!/^\s*(#{2,4}\s|[-*]\s|\*\*|\d+[.)]\s)/.test(line)) continue;
    if (line.length > 160) continue;
    const sev = (line.match(/심각도[:\s]*(상|중|하|높음|낮음|보통|[A-Za-z]+)/) || [])[1] || '미상';
    const title = line
      .replace(/^[#*\s]*/, '')
      .replace(/\(?\s*심각도[:\s]*[^)]*\)?/, '')
      .replace(/[*`]/g, '')
      .replace(/\s*—\s*$/, '')
      .trim();
    if (title.length > 4) findings.push(`- [Task #${taskId}] (${sev}) ${title}`);
  }
  if (!findings.length) return;

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# QA 지적 누적\n\n반복되는 항목은 계약이나 역할 정의에 반영할 것.\n\n');
  }
  fs.appendFileSync(file, findings.join('\n') + '\n');
}
