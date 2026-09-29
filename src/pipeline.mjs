import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ROLE_BY_KEY, BUILDERS, artifactOf, REVIEW_LENS } from './roles.mjs';
import { parseStack, fillGaps, stackBrief, DEFAULT_STACK } from './stack.mjs';
import { orgDir } from './db.mjs';
import { hireTeam, personTitle, personDeps } from './staffing.mjs';
import { needsOnboarding, runOnboarding, codebaseBrief } from './onboarding.mjs';
import { historyContext } from './history.mjs';
import { appendContract, contractsBrief } from './contracts.mjs';
import { collectDeferred, appendBacklog, backlogBrief } from './backlog.mjs';
import { artifactName, repoPathOf, writeCharter, writeRunDocs, appendKnowledge, writeTrackRecord,
         writeProjectReadme, writeRunsIndex } from './docs.mjs';
import { checkWritable, startBranch, returnTo, writeIntoRepo, commitAll } from './git.mjs';
import { KIND_GUIDE } from './staffing.mjs';

/**
 * 팀이 만든 코드를 각 repo 의 새 브랜치에 커밋한다.
 * 문서는 넣지 않는다 — 남의 저장소는 코드만 받는다.
 */
async function commitToRepos({ db, taskId, requirement, kind, repos, roster, outputs, stack, idOf }) {
  const check = checkWritable(repos);
  if (!check.ok) {
    console.warn('  코드를 repo 에 남기지 못했습니다:');
    check.problems.forEach((p) => console.warn(`    - ${p}`));
    db.prepare('UPDATE tasks SET git_note = ? WHERE id = ?')
      .run(check.problems.join(' / '), taskId);
    return [];
  }

  // 코드를 만든 사람만 (문서 역할은 제외)
  const coders = roster.filter((p) => ROLE_BY_KEY[p.key]?.stackKey && outputs[idOf(p)]);
  if (!coders.length) return [];

  const results = [];
  for (const repo of repos) {
    const started = startBranch(repo.path, requirement, taskId);
    if (!started.ok) {
      console.warn(`  ${repo.name}: 브랜치를 만들지 못했습니다 — ${started.error}`);
      continue;
    }

    let wrote = 0;
    for (const p of coders) {
      const rel = repoPathOf(p, stack);
      const r = writeIntoRepo(repo.path, rel, outputs[idOf(p)].trimEnd() + '\n');
      if (r.ok) wrote++;
      else console.warn(`  ${repo.name}: ${r.error}`);
    }

    const lines = coders.map((p) => `- ${personTitle(p)}: ${repoPathOf(p, stack)}`).join('\n');
    const commit = commitAll(
      repo.path,
      `${kind === 'bugfix' ? 'fix' : kind === 'refactor' ? 'refactor' : 'feat'}: ${requirement}\n\n${lines}\n\nagent-org task #${taskId}`
    );

    returnTo(repo.path, started.from);

    if (commit.ok && commit.committed) {
      results.push({
        repo: repo.name, branch: started.branch, from: started.from,
        sha: commit.sha, files: commit.files, committed: true,
      });
      console.log(`  ${repo.name}: ${started.branch} (${commit.sha}) — 파일 ${commit.files.length}개`);
    } else {
      results.push({ repo: repo.name, branch: started.branch, committed: false, files: [] });
    }
  }

  if (results.length) {
    db.prepare('UPDATE tasks SET git_result = ? WHERE id = ?')
      .run(JSON.stringify(results), taskId);
  }
  return results;
}

/** 글 쓰는 역할들은 도구가 필요 없다. 코드를 읽는 건 온보딩 단계만 한다. */
const NO_TOOLS = [
  'Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch', 'Task', 'Agent',
];

/**
 * 일감 하나를 처리한다.
 *  1) 요구사항을 보고 팀을 짠다 (필요한 직무를 필요한 인원만큼)
 *  2) 선행 작업이 끝난 사람부터 동시에 일한다
 *  3) QA가 FAIL이면 구현 인원이 재작업한다
 *
 * 산출물은 <workspace>/agent-org/runs/<날짜-요구사항>/ 아래에 쌓인다.
 */
export async function runPipeline(db, requirement, project, opts = {}) {
  const { maxRework = 1, budget = 0, signal = { cancelled: false }, review = true, preHired = null } = opts;

  const taskId = db
    .prepare('INSERT INTO tasks (requirement, status, workspace) VALUES (?, ?, ?)')
    .run(requirement, 'running', project.workspace || String(project)).lastInsertRowid;

  writeCharter(project);
  const runDir = path.join(orgDir(project), 'runs', runFolderName(taskId, requirement));
  fs.mkdirSync(runDir, { recursive: true });
  linkLatest(path.join(orgDir(project), 'runs'), runDir);
  fs.writeFileSync(path.join(runDir, '00-requirement.md'), `# 요구사항\n\n${requirement}\n`);
  db.prepare('UPDATE tasks SET run_dir = ? WHERE id = ?').run(runDir, taskId);

  // ── 온보딩 ────────────────────────────────────────────
  const repos = project.repos || [];
  const onboardCost = await onboardIfNeeded(db, project, repos, { taskId, signal });

  // ── 채용 ──────────────────────────────────────────────
  // 브리핑에서 이미 팀을 짰으면 다시 뽑지 않는다 (같은 값에 두 번 낼 이유가 없다)
  const { roster, cost: hireCost, reason, kind = 'new' } =
    preHired || await hireTeam(requirement, codebaseBrief(project, 2500));
  let totalCost = hireCost + onboardCost;
  db.prepare('UPDATE tasks SET roster = ?, hire_reason = ?, kind = ? WHERE id = ?')
    .run(JSON.stringify(roster.map((p) => ({ ...p, title: personTitle(p) }))), reason, kind, taskId);
  writeRoster(runDir, roster, reason);

  const stageIds = {};
  const idOf = (p) => `${p.key}#${p.instance}`;
  roster.forEach((p, i) => {
    stageIds[idOf(p)] = db
      .prepare(
        `INSERT INTO stages (task_id, role, role_key, instance, assignment, order_index, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(taskId, personTitle(p), p.key, p.instance, p.assignment, i).lastInsertRowid;
  });

  // ── 실행 ──────────────────────────────────────────────
  // 기존 프로젝트면 온보딩이 이미 스택과 파일 위치를 알아냈다. 그걸 출발점으로
  // 삼아야 새 코드가 원래 자리(src/server.js)에 간다. 기본값으로 떨어지면
  // 루트에 엉뚱한 파일이 생긴다.
  let stack = parseStack(codebaseBrief(project, 20000));
  if (stack) {
    db.prepare('UPDATE tasks SET stack = ? WHERE id = ?').run(JSON.stringify(stack), taskId);
    console.log('  기존 스택 이어받음');
  }
  const areaOf = (k) => ROLE_BY_KEY[k]?.stackKey || null;
  const contracts = contractsBrief(project);
  const backlog = backlogBrief(project);
  const guide = KIND_GUIDE[kind] || KIND_GUIDE.new;
  const kindNote = `[일감 성격] ${guide.label} — ${guide.note}`;
  const codebase = [kindNote, codebaseBrief(project), historyContext(project)]
    .filter(Boolean).join('\n\n');
  const outputs = {};            // "fe#0" -> 산출물
  const done = new Set();
  const failed = new Set();
  const budgetLeft = () => budget <= 0 || totalCost < budget;

  const exec = await runExecutionLoop(db, {
    roster, outputs, done, failed, stageIds, idOf, taskId,
    requirement, runDir, signal, budgetLeft, review,
    stack, areaOf, codebase, kind, contracts, backlog,
    onCost: (c) => { totalCost += c; },
  });
  stack = exec.stack;
  const overBudget = exec.overBudget;

  const qaPerson = roster.find((p) => p.key === 'qa');
  const round = await runReworkLoop(db, {
    roster, outputs, done, failed, stageIds, idOf,
    requirement, runDir, signal, maxRework, budgetLeft,
    getStack: () => stack, codebase, kind, contracts, backlog,
    onCost: (c) => { totalCost += c; },
  });

  // PM이 있으면 마지막에 진행을 점검한다 (실제 소요·재작업 데이터를 근거로)
  const pmPerson = roster.find((p) => ROLE_BY_KEY[p.key]?.watchdog);
  if (pmPerson && !signal.cancelled && budgetLeft() && done.has(idOf(pmPerson))) {
    try {
      const rows = db
        .prepare('SELECT * FROM stages WHERE task_id = ? ORDER BY order_index').all(taskId);
      const res = await runStandup(db, pmPerson, {
        requirement, runDir, taskId,
        data: buildTimingReport(rows, roster, round),
      });
      totalCost += res.cost;
    } catch { /* 점검 실패가 실행을 망치지는 않는다 */ }
  }

  for (const p of roster) {
    const id = idOf(p);
    if (!done.has(id) && !failed.has(id)) {
      db.prepare("UPDATE stages SET status = 'blocked' WHERE id = ?").run(stageIds[id]);
    }
  }

  const status = signal.cancelled
    ? 'cancelled'
    : overBudget ? 'over_budget' : failed.size > 0 ? 'failed' : 'done';
  if (signal.cancelled) {
    db.prepare(
      "UPDATE stages SET status = 'cancelled', completed_at = datetime('now') WHERE task_id = ? AND status IN ('running','pending')"
    ).run(taskId);
  }
  if (overBudget) console.warn(`  예산 $${budget} 초과로 중단 (사용 $${totalCost.toFixed(2)})`);

  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);

  // ── 코드를 repo 에 남긴다 ─────────────────────────────
  let gitResults = [];
  if (status === 'done' && repos.length && !signal.cancelled) {
    gitResults = await commitToRepos({
      db, taskId, requirement, kind, repos, roster, outputs, stack, idOf,
    });
  }

  recordRun(db, project, {
    taskId, requirement, kind, status, runDir, roster, reason, outputs, idOf, qaPerson,
  });

  return { taskId, totalCost, runDir, status, roster, kind, gitResults, reworkRounds: round };
}

/**
 * 팀을 병렬로 돌린다.
 *
 * 선행이 끝난 사람은 바로 시작한다. 순서는 사람 목록이 아니라 의존 관계가
 * 정한다 — 그래서 FE/BE 처럼 서로 안 기다려도 되는 사람은 동시에 일한다.
 *
 * outputs·done·failed 는 호출자와 공유하는 그릇이고, 비용은 onCost 로 넘긴다.
 * 스택은 이 안에서 확정되므로 최종값을 돌려준다.
 */
async function runExecutionLoop(db, ctx) {
  const { roster, outputs, done, failed, stageIds, idOf, taskId,
          requirement, runDir, signal, budgetLeft, review,
          areaOf, codebase, kind, contracts, backlog, onCost } = ctx;

  let stack = ctx.stack;
  const running = new Map();
  let overBudget = false;

  const saveStack = (v) => {
    stack = v;
    db.prepare('UPDATE tasks SET stack = ? WHERE id = ?').run(JSON.stringify(stack), taskId);
  };

  const ready = () =>
    roster.filter((p) => {
      const id = idOf(p);
      if (done.has(id) || failed.has(id) || running.has(id)) return false;
      return personDeps(p, roster).every((d) => done.has(idOf(d)));
    });

  while (done.size + failed.size < roster.length) {
    if (signal.cancelled) break;
    if (!budgetLeft()) { overBudget = true; break; }

    for (const p of ready()) {
      const id = idOf(p);
      running.set(
        id,
        runPerson(db, p, { roster, stageId: stageIds[id], requirement, outputs, runDir, signal,
          getStack: () => stack, codebase, kind, contracts, backlog })
          .then(async (res) => {
            outputs[id] = res.output;
            onCost(res.cost);

            // 혼자 확정하지 못한다 — 관련자 승인을 받는다
            if (review && !signal.cancelled && budgetLeft()) {
              const gate = await reviewGate(db, p, {
                roster, stageId: stageIds[id], requirement, runDir, outputs, signal,
                getStack: () => stack, artifact: res.output,
              });
              onCost(gate.cost);
              if (gate.revised) outputs[id] = gate.output;
            }
            done.add(id);
            // 스택을 정하는 사람이 끝나면 그 결정을 팀 전체가 따른다
            if (ROLE_BY_KEY[p.key]?.decidesStack && !stack) {
              const decided = parseStack(res.output);
              if (decided) {
                saveStack(fillGaps(decided, roster, areaOf));
                console.log(`  기술 스택 확정 (${personTitle(p)})`);
              }
            }
          })
          .catch(() => { failed.add(id); })
          .finally(() => { running.delete(id); })
      );
    }

    if (running.size === 0) break;
    await Promise.race(running.values());

    // 정할 사람이 실패했거나 이미 끝났는데 스택이 없으면 기본값으로 간다.
    // 여기서 안 채우면 뒤에 올 구현자들이 스택 없이 시작한다.
    if (!stack && roster.some((p) => areaOf(p.key) && !done.has(idOf(p)))) {
      const decider = roster.find((p) => ROLE_BY_KEY[p.key]?.decidesStack);
      if (!decider || done.has(idOf(decider)) || failed.has(idOf(decider))) {
        saveStack(fillGaps(DEFAULT_STACK, roster, areaOf));
      }
    }
  }

  return { stack, overBudget };
}

/**
 * 이미 굴러가던 프로젝트면 코드를 먼저 읽는다.
 *
 * 모르는 채로 만들면 기존 관례를 무시한 코드가 나온다. 다만 파악에 실패해도
 * 실행은 계속한다 — 아무것도 못 하는 것보다는 낫다.
 */
async function onboardIfNeeded(db, project, repos, { taskId, signal }) {
  if (signal.cancelled || !needsOnboarding(project, repos)) return 0;

  console.log('  기존 코드 파악 중…');
  db.prepare("UPDATE tasks SET status = 'onboarding' WHERE id = ?").run(taskId);
  let cost = 0;
  try {
    const r = await runOnboarding(project, repos, { signal });
    cost = r.cost;
    if (r.ok) console.log('  코드베이스 파악 완료 → knowledge/CODEBASE.md');
  } catch (e) {
    console.warn('  코드 파악 실패 (계속 진행):', e.message);
  }
  db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(taskId);
  return cost;
}

/**
 * PM 에게 넘길 실측 표.
 *
 * "일한 시간"과 "기다린 시간"을 나눠서 준다. 둘을 구분하지 못하면 병목이
 * 순서 문제인지 작업량 문제인지 알 수 없고, 해법이 달라진다.
 */
function buildTimingReport(rows, roster, round) {
  const ms = (t) => (t ? Date.parse(t + 'Z') : null);
  const starts = rows.map((r) => ms(r.started_at)).filter(Boolean);
  const t0 = starts.length ? Math.min(...starts) : NaN;

  const mmss = (sec) => `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  const rel = (t) => {
    const v = ms(t);
    if (!v || !Number.isFinite(t0)) return '—';
    const sec = Math.round((v - t0) / 1000);
    return `+${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  // 선행이 다 끝난 시각부터 본인이 시작한 시각까지가 대기 시간이다
  const waitedFor = (r) => {
    const person = roster.find((p) => personTitle(p) === r.role);
    const depEnds = (person ? personDeps(person, roster) : [])
      .map((d) => rows.find((x) => x.role === personTitle(d)))
      .map((x) => ms(x?.completed_at))
      .filter(Boolean);
    const readyAt = depEnds.length ? Math.max(...depEnds) : t0;
    return ms(r.started_at) && readyAt
      ? Math.max(0, Math.round((ms(r.started_at) - readyAt) / 1000))
      : 0;
  };

  const table = rows.map((r) => {
    const secs = ms(r.started_at) && ms(r.completed_at)
      ? Math.round((ms(r.completed_at) - ms(r.started_at)) / 1000) : 0;
    return `| ${r.role} | ${r.status} | ${rel(r.started_at)} | ${rel(r.completed_at)} | ` +
      `${mmss(secs)} | ${waitedFor(r)}초 | $${(r.cost_usd || 0).toFixed(2)} | ` +
      `${r.attempt || 0}회 | ${r.assignment || '전체'} |`;
  }).join('\n');

  const ends = rows.map((r) => ms(r.completed_at)).filter(Boolean);
  const wall = ends.length && Number.isFinite(t0)
    ? mmss(Math.round((Math.max(...ends) - t0) / 1000))
    : '—';

  return `시작(+)·종료(+)는 첫 작업 시작 시점 기준 경과 시간입니다.\n` +
    `대기는 선행 작업이 모두 끝난 뒤 이 사람이 시작하기까지 걸린 시간입니다.\n\n` +
    `| 담당자 | 상태 | 시작 | 종료 | 소요 | 대기 | 비용 | 재작업 | 맡은 범위 |\n` +
    `|---|---|---|---|---|---|---|---|---|\n${table}\n\n` +
    `실제 경과 시간(첫 시작~마지막 종료): ${wall}\n` +
    `재작업 라운드: ${round}회 · 팀 규모: ${roster.length}명`;
}

/**
 * QA 가 FAIL 을 내면 구현자들이 다시 만들고 QA 가 다시 본다.
 *
 * 몇 번이고 돌면 돈이 끝없이 나가므로 maxRework 로 막고, 매 회차마다 예산과
 * 중단 신호를 다시 확인한다. 비용은 onCost 로 바깥에 알려야 예산 계산이 맞는다.
 *
 * outputs / failed 는 바깥 것을 그대로 고친다. 재작업 결과가 이후 단계에
 * 반영되어야 하기 때문이다.
 */
async function runReworkLoop(db, ctx) {
  const {
    roster, outputs, done, failed, stageIds, idOf,
    requirement, runDir, signal, maxRework, budgetLeft,
    getStack, codebase, kind, contracts, backlog, onCost,
  } = ctx;

  const qaPerson = roster.find((p) => p.key === 'qa');
  const builders = roster.filter((p) => BUILDERS.includes(p.key));
  const resetStage = db.prepare(
    "UPDATE stages SET status = 'pending', step_index = NULL WHERE id = ?"
  );
  let round = 0;

  const needsRework = () =>
    !signal.cancelled && budgetLeft() && round < maxRework &&
    qaPerson && done.has(idOf(qaPerson)) &&
    /판정:\s*FAIL/.test(outputs[idOf(qaPerson)] || '') &&
    builders.length > 0 && builders.every((p) => done.has(idOf(p)));

  while (needsRework()) {
    round++;
    const report = outputs[idOf(qaPerson)];
    const shared = {
      roster, requirement, outputs, runDir, signal,
      getStack, codebase, kind, contracts, backlog,
    };

    builders.forEach((p) => resetStage.run(stageIds[idOf(p)]));
    await Promise.all(builders.map((p) =>
      runPerson(db, p, {
        ...shared, stageId: stageIds[idOf(p)], feedback: report, attempt: round,
      })
        .then((res) => { outputs[idOf(p)] = res.output; onCost(res.cost); })
        .catch(() => { failed.add(idOf(p)); })
    ));

    resetStage.run(stageIds[idOf(qaPerson)]);
    try {
      const res = await runPerson(db, qaPerson, {
        ...shared, stageId: stageIds[idOf(qaPerson)], attempt: round,
      });
      outputs[idOf(qaPerson)] = res.output;
      onCost(res.cost);
    } catch { failed.add(idOf(qaPerson)); break; }
  }

  return round;
}

/**
 * 실행이 끝난 뒤 남길 기록들.
 *
 * 여기서 실패해도 이미 만들어진 산출물은 그대로다. 문서를 못 쓴다고 작업 자체를
 * 실패로 만들지 않는다.
 */
function recordRun(db, project, ctx) {
  const { taskId, requirement, kind, status, runDir, roster, reason, outputs, idOf, qaPerson } = ctx;

  const finalStages = db
    .prepare('SELECT * FROM stages WHERE task_id = ? ORDER BY order_index').all(taskId);
  writeRunDocs(runDir, { taskId, requirement, status, stages: finalStages, roster, reason });

  // 이번에 정한 계약을 프로젝트 차원에 남긴다 (다음 작업이 이어받는다)
  const contractPerson = roster.find((p) => p.key === 'lead')
    || roster.find((p) => p.key === 'architect');
  if (contractPerson && outputs[idOf(contractPerson)] && status !== 'cancelled') {
    try {
      appendContract(project, {
        taskId, requirement, kind,
        contract: outputs[idOf(contractPerson)],
        at: new Date().toISOString(),
      });
    } catch (e) { console.warn('  계약 누적 실패:', e.message); }
  }

  // 여기저기 흩어진 "이번엔 안 함"을 한 곳에 모은다
  if (status !== 'cancelled') {
    try {
      const deferred = collectDeferred(finalStages);
      const r = appendBacklog(project, {
        taskId, requirement, items: deferred, at: new Date().toISOString(),
      });
      if (r.added) console.log(`  남은 일 ${r.added}건 기록`);
    } catch (e) { console.warn('  백로그 기록 실패:', e.message); }
  }

  appendKnowledge(project, taskId, qaPerson ? outputs[idOf(qaPerson)] : null);
  writeTrackRecord(project, db);
  writeRunsIndex(project, db);
  writeProjectReadme(project, db);
}

// ────────────────────────────────────────────────────────

async function runPerson(db, person, ctx) {
  const { roster, stageId, requirement, outputs, runDir, feedback, attempt,
          signal = { cancelled: false }, getStack, reviewNotes } = ctx;
  const role = ROLE_BY_KEY[person.key];
  const stack = getStack ? getStack() : null;
  const fileName = artifactName(person, stack);

  // 선행 산출물이 그대로 다 들어가면 단계마다 프롬프트가 불어난다.
  // QA 처럼 코드 둘을 동시에 보는 역할에서 특히 심하다.
  const DEP_CAP = 14000;
  const context = personDeps(person, roster)
    .map((d) => {
      const raw = outputs[`${d.key}#${d.instance}`] ?? '';
      const body = raw.length > DEP_CAP
        ? `${raw.slice(0, DEP_CAP)}\n\n…(${raw.length - DEP_CAP}자 생략 — 전문은 산출물 파일에 있습니다)`
        : raw;
      return `[${personTitle(d)} 산출물]\n${body}`;
    })
    .join('\n\n---\n\n');

  const mine = person.total > 1
    ? `\n\n[당신이 맡은 범위]\n${person.assignment}\n같은 직무의 다른 담당자가 나머지를 맡습니다. 당신 범위에만 집중하세요.`
    : '';

  const brief = stackBrief(stack);
  const codebase = ctx.codebase || '';
  // 계약을 쓰는 사람은 이전 약속을 반드시 보고 시작해야 한다
  const priorContracts = (role.key === 'lead' || role.key === 'architect')
    ? (ctx.contracts || '')
    : '';
  // 범위를 정하는 사람만 남은 일을 본다. 구현자에게 주면 범위만 흔들린다.
  const pending = (role.key === 'pm' || role.key === 'planner') ? (ctx.backlog || '') : '';
  // 배경 문서(코드베이스·git 내력)는 첫 단계와 회귀 점검에만 전부 싣는다.
  // 매 단계 다시 보내면 같은 내용에 계속 돈을 낸다.
  const makeBase = (stepIndex, stepLabel) => {
    const needsBackground = stepIndex === 0 || /회귀/.test(stepLabel || '');
    const bg = needsBackground ? codebase : '';
    return `[요구사항]\n${requirement}` +
      (bg ? `\n\n---\n\n${bg}\n기존 코드의 관례를 따르세요. 이미 있는 것을 새로 만들지 마세요.` : '') +
      (priorContracts ? `\n\n---\n\n${priorContracts}` : '') +
      (pending ? `\n\n---\n\n${pending}` : '') +
      (brief ? `\n\n---\n\n${brief}\n이 스택을 그대로 사용하세요.` : '') +
      (context ? `\n\n---\n\n${context}` : '') + mine +
      (feedback ? `\n\n---\n\n[QA 지적 — 재작업 ${attempt}차]\n${feedback}\n\n위 지적을 반드시 반영하세요.` : '') +
      (reviewNotes
        ? `\n\n---\n\n[검토 의견 — 반영 필요]\n${reviewNotes}\n\n` +
          `위 지적을 반영해 처음부터 다시 작성하세요. 동의하지 않는 지적이 있으면 그 이유를 문서에 명시하고 대안을 제시하세요.`
        : '');
  };
  const base = makeBase(0, role.steps?.[0]?.label);

  let steps = role.steps?.length ? role.steps : [{ label: '작업', prompt: '맡은 일을 수행하세요.' }];

  // 기존 코드를 건드린 작업이면 QA 가 회귀까지 본다.
  // 새로 만드는 일에는 깨질 기존 동작이 없으므로 넣지 않는다.
  if (role.regressionStep && ctx.kind && ctx.kind !== 'new') {
    steps = [...steps.slice(0, -1), role.regressionStep, steps[steps.length - 1]];
  }

  db.prepare(
    "UPDATE stages SET status = 'running', input = ?, started_at = datetime('now'), step_total = ?, attempt = ? WHERE id = ?"
  ).run(base, steps.length, attempt || 0, stageId);

  let accumulated = '';
  let cost = 0;
  let usage = null;

  for (let i = 0; i < steps.length; i++) {
    if (signal.cancelled) break;
    const step = steps[i];
    db.prepare('UPDATE stages SET step_index = ?, step_label = ? WHERE id = ?').run(i, step.label, stageId);

    const carry = accumulated ? buildCarry(role, accumulated) : '';
    const prompt = `${makeBase(i, step.label)}${carry}\n\n---\n\n[${i + 1}/${steps.length} 단계: ${step.label}]\n${step.prompt}`;

    const res = await runStep(db, role, stageId, prompt, accumulated);
    cost += res.cost;
    if (res.usage) usage = res.usage;

    accumulated = role.mode === 'revise'
      ? (extractCode(res.text) || accumulated)
      : (accumulated ? `${accumulated}\n\n${res.text.trim()}` : res.text.trim());

    fs.writeFileSync(path.join(runDir, fileName), accumulated.trimEnd() + '\n');
    db.prepare('UPDATE stages SET output = ? WHERE id = ?').run(accumulated, stageId);
  }

  const artifactPath = path.join(runDir, fileName);
  db.prepare(
    `UPDATE stages SET status = 'done', output = ?, cost_usd = ?,
     tokens_input = ?, tokens_output = ?, tokens_cache_read = ?, tokens_cache_creation = ?,
     artifact_path = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(
    accumulated, cost,
    usage?.input_tokens ?? 0, usage?.output_tokens ?? 0,
    usage?.cache_read_input_tokens ?? 0, usage?.cache_creation_input_tokens ?? 0,
    artifactPath, stageId
  );

  return { output: accumulated, cost };
}

/**
 * 다음 단계로 넘길 내용.
 *
 * 코드는 전체가 있어야 이어서 고칠 수 있으므로 자르지 않는다.
 * 문서는 길어지면 앞부분을 제목만 남기고 접는다 — 단계가 늘수록 같은 내용을
 * 반복해서 실어 보내는 게 비용의 대부분이다.
 */
const CARRY_CAP = 9000;

function buildCarry(role, accumulated) {
  if (role.mode === 'revise') {
    return `\n\n---\n\n[현재 파일]\n${accumulated}`;
  }
  if (accumulated.length <= CARRY_CAP) {
    return `\n\n---\n\n[지금까지 작성한 문서]\n${accumulated}`;
  }
  const heads = [...accumulated.matchAll(/^#{2,4}\s+(.+)$/gm)].map((m) => `- ${m[1]}`).join('\n');
  const tail = accumulated.slice(-CARRY_CAP);
  return `\n\n---\n\n[지금까지 작성한 문서]\n` +
    `앞부분은 제목만 싣습니다 (전문은 산출물 파일에 있습니다):\n${heads}\n\n` +
    `--- 최근 내용 ---\n${tail}`;
}

/** 한 단계 실행 — 쓰는 동안의 텍스트를 흘려보내 진행량을 보여준다 */
async function runStep(db, role, stageId, prompt, carried) {
  const saveProgress = db.prepare('UPDATE stages SET output = ? WHERE id = ?');
  let text = '';
  let cost = 0;
  let usage = null;
  let lastFlush = 0;

  try {
    for await (const message of query({
      prompt,
      options: {
        systemPrompt: role.systemPrompt,
        maxTurns: 6,
        // allowedTools 는 자동승인 목록일 뿐 제한이 아니다. 실제로 막으려면 여기.
        disallowedTools: NO_TOOLS,
        includePartialMessages: true,
      },
    })) {
      if (message.type === 'stream_event') {
        const ev = message.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          text += ev.delta.text;
          const now = Date.now();
          if (now - lastFlush > 1000) {
            lastFlush = now;
            saveProgress.run(role.mode === 'revise' ? text : (carried ? `${carried}\n\n${text}` : text), stageId);
          }
        }
      } else if (message.type === 'result') {
        cost = message.total_cost_usd || 0;
        usage = message.usage || null;
      }
    }
    return { text, cost, usage };
  } catch (err) {
    db.prepare("UPDATE stages SET status = 'failed', output = ?, completed_at = datetime('now') WHERE id = ?")
      .run(String(err), stageId);
    throw err;
  }
}

/**
 * 검토 게이트.
 *
 * 개발리드가 계약을 혼자 확정하고 구현자들이 그대로 따르면, 리드가 틀렸을 때
 * 팀 전체가 틀린다. 그래서 중요한 산출물은 관련자가 자기 직무의 눈으로 보고
 * 승인하거나 보완을 요구한다. 보완 요구가 있으면 작성자가 한 번 고친다.
 */
async function reviewGate(db, person, ctx) {
  const { roster, stageId, requirement, runDir, outputs, signal, getStack, artifact } = ctx;
  const role = ROLE_BY_KEY[person.key];
  const reviewerKeys = role.reviewedBy || [];
  if (!reviewerKeys.length || !artifact) return { cost: 0, revised: false };

  // 이번에 실제로 뽑혔고 이미 일을 마친 사람만 검토할 수 있다
  const reviewers = roster.filter(
    (r) => reviewerKeys.includes(r.key) && outputs[`${r.key}#${r.instance}`]
  );
  if (!reviewers.length) return { cost: 0, revised: false };

  db.prepare("UPDATE stages SET review_status = 'reviewing' WHERE id = ?").run(stageId);

  let cost = 0;
  const verdicts = [];

  for (const reviewer of reviewers) {
    if (signal.cancelled) break;
    const rRole = ROLE_BY_KEY[reviewer.key];
    const lens = REVIEW_LENS[reviewer.key] || '자기 직무 관점에서 문제가 없는가';
    const mine = outputs[`${reviewer.key}#${reviewer.instance}`] || '';

    const prompt =
      `[요구사항]\n${requirement}\n\n---\n\n` +
      `[당신이 앞서 작성한 문서]\n${mine.slice(0, 4000)}\n\n---\n\n` +
      `[검토 대상 — ${personTitle(person)}의 산출물]\n${artifact.slice(0, 12000)}\n\n---\n\n` +
      `## 검토\n\n당신의 검토 관점: ${lens}\n\n` +
      `자기 직무 범위 밖은 지적하지 마세요. 취향 문제로 반려하지 마세요.\n` +
      `실제로 다음 단계가 막히거나 잘못 만들어질 문제만 지적합니다.\n\n` +
      `문제가 있으면 무엇이 왜 문제인지, 어떻게 바꿔야 하는지 구체적으로 쓰세요.\n` +
      `마지막 줄에 반드시 "검토: 승인" 또는 "검토: 보완요청" 중 하나만 쓰세요.`;

    let text = '';
    try {
      for await (const m of query({
        prompt,
        options: { systemPrompt: rRole.systemPrompt, maxTurns: 3, disallowedTools: NO_TOOLS },
      })) {
        if (m.type === 'assistant') {
          text += m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        } else if (m.type === 'result') {
          cost += m.total_cost_usd || 0;
        }
      }
    } catch { continue; }

    const approved = !/검토:\s*보완요청/.test(text);
    verdicts.push({ who: personTitle(reviewer), approved, text });
  }

  if (!verdicts.length) return { cost, revised: false };

  const changesWanted = verdicts.filter((v) => !v.approved);
  writeReviewDoc(runDir, person, verdicts);

  if (!changesWanted.length) {
    db.prepare("UPDATE stages SET review_status = 'approved' WHERE id = ?").run(stageId);
    return { cost, revised: false };
  }

  // 보완 요구가 있으면 작성자가 한 번 반영한다
  db.prepare("UPDATE stages SET review_status = 'revising' WHERE id = ?").run(stageId);
  const notes = changesWanted.map((v) => `[${v.who}의 지적]\n${v.text}`).join('\n\n');

  try {
    const res = await runPerson(db, person, {
      roster, stageId, requirement, outputs, runDir, signal, getStack,
      reviewNotes: notes,
    });
    db.prepare("UPDATE stages SET review_status = 'revised' WHERE id = ?").run(stageId);
    return { cost: cost + res.cost, revised: true, output: res.output };
  } catch {
    db.prepare("UPDATE stages SET review_status = 'changes_requested' WHERE id = ?").run(stageId);
    return { cost, revised: false };
  }
}

function writeReviewDoc(runDir, person, verdicts) {
  const name = `${artifactName(person).replace(/\.[^.]+$/, '')}-review.md`;
  const body = `# ${personTitle(person)} 산출물 검토

${verdicts.map((v) => `## ${v.who} — ${v.approved ? '승인' : '보완요청'}

${v.text.trim()}`).join('\n\n---\n\n')}
`;
  try { fs.writeFileSync(path.join(runDir, name), body); } catch { /* 문서 실패는 치명적이지 않다 */ }
}

/** PM 진행 점검 — 별도 산출물로 남긴다 */
async function runStandup(db, person, { requirement, runDir, taskId, data }) {
  const role = ROLE_BY_KEY[person.key];
  const spec = role.standup;
  const prompt = `[요구사항]\n${requirement}\n\n---\n\n[이번 실행 실측 데이터]\n${data}\n\n---\n\n${spec.prompt}`;

  let text = '';
  let cost = 0;
  for await (const m of query({
    prompt,
    options: { systemPrompt: role.systemPrompt, maxTurns: 4, disallowedTools: NO_TOOLS },
  })) {
    if (m.type === 'assistant') {
      text += m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    } else if (m.type === 'result') {
      cost = m.total_cost_usd || 0;
    }
  }
  fs.writeFileSync(path.join(runDir, `99-${spec.artifact}`), text.trimEnd() + '\n');
  return { cost };
}

function extractCode(text) {
  const fence = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return fence ? fence[1].trimEnd() : null;
}

function writeRoster(runDir, roster, reason) {
  const body = `# 이번 팀

**편성 이유**  ${reason}

| 직무 | 담당 |
|---|---|
${roster.map((p) => `| ${personTitle(p)} | ${p.assignment}${p.hiredBecause ? ` _(${p.hiredBecause} 보강)_` : ''} |`).join('\n')}
`;
  fs.writeFileSync(path.join(runDir, '00-team.md'), body);
}

function runFolderName(taskId, requirement) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const slug = requirement
    .replace(/[^가-힣a-zA-Z0-9\s-]/g, ' ')
    .trim().split(/\s+/).slice(0, 5).join('-')
    .slice(0, 40).replace(/-+$/, '') || `task-${taskId}`;
  return `${stamp}-${slug}`;
}

function linkLatest(runsDir, runDir) {
  const link = path.join(runsDir, 'latest');
  try { if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link); } catch { /* none */ }
  try { fs.symlinkSync(path.basename(runDir), link, 'dir'); } catch { /* optional */ }
}
