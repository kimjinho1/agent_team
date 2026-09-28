#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

// The shell can be sitting in a directory that no longer exists (it was moved
// or deleted after the shell cd'd into it) — process.cwd() throws there.
let cwd;
try {
  cwd = process.cwd();
} catch {
  console.error(`
  현재 폴더가 존재하지 않습니다.
  이 터미널이 있던 폴더가 지워졌거나 이동된 것 같습니다.

  해결: 존재하는 폴더로 이동한 뒤 다시 실행하세요.
    cd ~  &&  agent-org
`);
  process.exit(1);
}

// Credentials may live next to the install or in the folder you run from.
// Load the current folder first so a project can override, then fall back.
dotenv.config({ path: path.join(cwd, '.env') });
dotenv.config({ path: path.join(pkgRoot, '.env') });

const { startServer } = await import('../server.mjs');
const { openDb } = await import('../db.mjs');
const { resolveProject, listProjects, renameProject, forgetProject, homeDir } = await import('../projects.mjs');
const { listBranches, deleteBranch, mergeBranch, baseBranch } = await import('../git.mjs');
const { runPipeline } = await import('../pipeline.mjs');

const args = process.argv.slice(2);

// 하위 명령은 작업 폴더 이름이 아니다. 안 그러면 `agent-org branches` 가
// ./branches 폴더에서 실행하려 든다.
const SUBCOMMANDS = new Set(['projects', 'rename', 'forget', 'branches', 'merge', 'cleanup']);
const opts = { port: 4747, workspace: cwd, run: null, budget: 10, rework: 1, review: true };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') { opts.port = Number(args[++i]); opts.portPinned = true; }
  else if (a === '--dir' || a === '-d') opts.workspace = path.resolve(args[++i]);
  else if (a === '--run' || a === '-r') opts.run = args[++i];
  else if (a === '--budget' || a === '-b') opts.budget = Number(args[++i]);
  else if (a === '--rework') opts.rework = Number(args[++i]);
  else if (a === '--no-review') opts.review = false;
  else if (a === '--help' || a === '-h') opts.help = true;
  else if (!a.startsWith('-')) {
    if (i === 0 && SUBCOMMANDS.has(a)) continue;        // 하위 명령
    if (SUBCOMMANDS.has(args[0])) continue;             // 하위 명령의 인자
    opts.workspace = path.resolve(a);
  }
}

// ── 프로젝트 관리 명령 ────────────────────────────────
const [cmd, a1, a2] = args;
if (cmd === 'projects') {
  const list = listProjects().sort((x, y) => (y.lastSeenAt || '').localeCompare(x.lastSeenAt || ''));
  if (!list.length) console.log('\n  아직 등록된 프로젝트가 없습니다.\n');
  else {
    console.log('');
    for (const p of list) {
      console.log(`  ${p.name.padEnd(20)} ${(p.lastSeenAt || '').slice(0, 10)}  ${(p.workspaces || [])[0] || ''}`);
    }
    console.log(`\n  문서: ${homeDir()}/projects/<이름>/\n  목록: ${homeDir()}/index.md\n`);
  }
  process.exit(0);
}
if (cmd === 'rename') {
  if (!a1 || !a2) { console.error('사용법: agent-org rename <기존이름> <새이름>'); process.exit(1); }
  const r = renameProject(a1, a2);
  console.log(r.ok ? `이름 변경: ${a1} → ${a2}` : `실패: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}
if (cmd === 'forget') {
  if (!a1) { console.error('사용법: agent-org forget <이름>'); process.exit(1); }
  const r = forgetProject(a1);
  console.log(r.ok
    ? `목록에서 제거했습니다: ${a1}\n문서는 그대로 있습니다: ${r.dir}\n완전히 지우려면 그 폴더를 직접 삭제하세요.`
    : `실패: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}

// ── 브랜치 정리 ───────────────────────────────────────
if (cmd === 'branches' || cmd === 'merge' || cmd === 'cleanup') {
  const project = resolveProject(opts.workspace);
  if (!project.repos.length) {
    console.error('\n  이 폴더에 git repo 가 없습니다.\n');
    process.exit(1);
  }

  if (cmd === 'branches') {
    console.log('');
    for (const r of project.repos) {
      const list = listBranches(r.path);
      console.log(`  ${r.name}  (기준: ${baseBranch(r.path)})`);
      if (!list.length) { console.log('    이 도구가 만든 브랜치가 없습니다\n'); continue; }
      for (const b of list) {
        const mark = b.current ? '*' : ' ';
        const state = b.merged ? '머지됨' : `미머지 +${b.ahead}`;
        console.log(`   ${mark} ${b.name}`);
        console.log(`      ${b.date}  ${b.sha}  ${state}  ${b.subject.slice(0, 50)}`);
      }
      console.log('');
    }
    console.log('  머지: agent-org merge <브랜치>');
    console.log('  정리: agent-org cleanup           (머지된 것만 삭제)');
    console.log('        agent-org cleanup --force   (미머지 포함 — 작업이 사라집니다)\n');
    process.exit(0);
  }

  if (cmd === 'merge') {
    if (!a1) { console.error('사용법: agent-org merge <브랜치>'); process.exit(1); }
    let any = false;
    for (const r of project.repos) {
      if (!listBranches(r.path).some((b) => b.name === a1)) continue;
      any = true;
      const res = mergeBranch(r.path, a1);
      console.log(res.ok
        ? `  ${r.name}: ${res.base} 에 머지했습니다 (${res.sha})`
        : `  ${r.name}: 실패 — ${res.error}`);
    }
    if (!any) console.error(`  그런 브랜치가 없습니다: ${a1}`);
    process.exit(any ? 0 : 1);
  }

  // cleanup
  const force = args.includes('--force');
  let removed = 0;
  let kept = 0;
  for (const r of project.repos) {
    for (const b of listBranches(r.path)) {
      if (b.current) { kept++; continue; }
      if (!b.merged && !force) {
        console.log(`  남김  ${r.name}: ${b.name} (미머지 +${b.ahead})`);
        kept++;
        continue;
      }
      const res = deleteBranch(r.path, b.name, { force });
      if (res.ok) { console.log(`  삭제  ${r.name}: ${b.name}`); removed++; }
      else { console.log(`  남김  ${r.name}: ${b.name} — ${res.error}`); kept++; }
    }
  }
  console.log(`\n  삭제 ${removed}개 · 남김 ${kept}개`);
  if (!force && kept) console.log('  미머지 브랜치까지 지우려면 --force (작업이 사라집니다)\n');
  process.exit(0);
}

if (opts.help) {
  console.log(`
  agent-org — AI 개발 조직을 로컬에서 돌립니다.

  사용법
    agent-org                     현재 폴더를 작업 공간으로 대시보드 실행
    agent-org ./my-project        지정한 폴더를 작업 공간으로 실행
    agent-org --port 5000         포트 지정
    agent-org --run "요구사항"     대시보드 없이 한 번만 실행 (CLI)
    agent-org --budget 5          작업 1건당 비용 상한 (기본 $10, 0이면 무제한)
    agent-org --rework 2          QA FAIL 시 재작업 최대 횟수 (기본 1)
    agent-org --no-review         상호 검토 끄기 (빠르고 싸지만 독단 위험)

  프로젝트 관리
    agent-org projects            등록된 프로젝트 목록
    agent-org rename <구> <신>     프로젝트 이름 변경
    agent-org forget <이름>        목록에서 제거 (문서는 남김)

  브랜치 정리
    agent-org branches            이 도구가 만든 브랜치 목록 (머지 여부 표시)
    agent-org merge <브랜치>       기본 브랜치에 머지
    agent-org cleanup             머지된 브랜치만 삭제
    agent-org cleanup --force     미머지 포함 삭제 (작업이 사라집니다)

  문서와 기록은 ~/.agent-org/projects/<프로젝트>/runs/ 에 쌓입니다.
  코드 변경은 해당 repo 의 브랜치로 갑니다. (타겟 repo 는 문서로 오염되지 않습니다)
`);
  process.exit(0);
}

if (!fs.existsSync(opts.workspace)) {
  console.error(`작업 폴더가 없습니다: ${opts.workspace}`);
  process.exit(1);
}

if (opts.run) {
  const project = resolveProject(opts.workspace);
  const db = openDb(project);
  console.log(`\n[시작] ${opts.run}\n작업 폴더: ${opts.workspace}\n프로젝트: ${project.name}\n`);
  const { taskId, totalCost, runDir, status } = await runPipeline(db, opts.run, project, { budget: opts.budget, maxRework: opts.rework, review: opts.review });
  console.log(`\n완료 — Task #${taskId} · ${status} · $${totalCost.toFixed(4)}`);
  console.log(`산출물: ${runDir}`);
  console.log(`요약 보기: open "${path.join(runDir, 'README.md')}"`);
  console.log(`폴더 열기: open "${runDir}"\n`);
  process.exit(status === 'done' ? 0 : 1);
}

startServer({ workspace: opts.workspace, port: opts.port, budget: opts.budget, maxRework: opts.rework, review: opts.review, portPinned: !!opts.portPinned });
