import './env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, orgDir } from './db.mjs';
import { resolveProject, currentBranch, isDirty } from './projects.mjs';
import { runPipeline } from './pipeline.mjs';
import { hireTeam, personTitle, KIND_GUIDE } from './staffing.mjs';
import { codebaseBrief, needsOnboarding, runOnboarding, hasExistingCode } from './onboarding.mjs';
import { checkWritable } from './git.mjs';
import { repoHistory } from './history.mjs';
import { backlogStats, openItems } from './backlog.mjs';
import { CATALOG, ROLE_BY_KEY } from './roles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 대시보드 파일이 있는 곳 — 이 파일은 src/ 안에 있으므로 한 단계 위다 */
const publicDir = path.resolve(__dirname, '..', 'public');

/** public/ 에서 내보낼 파일 종류 */
const STATIC_TYPES = { '.css': 'text/css', '.js': 'text/javascript' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** 뽑힌 팀 안에서 동시에 일할 수 있는 묶음 */
function buildWaves(roster) {
  const hired = new Set(roster.map((p) => p.key));
  const depsOf = (key) => {
    const found = new Set();
    const seen = new Set();
    const walk = (k) => {
      for (const d of ROLE_BY_KEY[k]?.deps || []) {
        if (seen.has(d)) continue;
        seen.add(d);
        if (hired.has(d)) found.add(d); else walk(d);
      }
    };
    walk(key);
    return [...found];
  };
  const depth = {};
  const of = (p) => {
    const id = `${p.key}#${p.instance}`;
    if (depth[id] != null) return depth[id];
    const ds = roster.filter((o) => depsOf(p.key).includes(o.key));
    depth[id] = ds.length ? 1 + Math.max(...ds.map(of)) : 0;
    return depth[id];
  };
  const out = [];
  roster.forEach((p) => {
    const d = of(p);
    (out[d] = out[d] || []).push(p.total > 1 ? `${ROLE_BY_KEY[p.key].label} ${p.instance + 1}` : ROLE_BY_KEY[p.key].label);
  });
  return out.filter(Boolean);
}

export function startServer({ workspace, port = 4747, budget = 0, maxRework = 1, review = true, portPinned = false }) {
  const project = resolveProject(workspace);
  const db = openDb(project);
  const root = path.resolve(orgDir(project));

  // a previous process may have been killed mid-run; those rows would otherwise
  // show as permanently "working"
  const stale = db
    .prepare("UPDATE stages SET status = 'failed', completed_at = datetime('now') WHERE status = 'running'")
    .run().changes;
  db.prepare("UPDATE tasks SET status = 'failed' WHERE status = 'running'").run();
  if (stale > 0) console.log(`  (중단된 작업 ${stale}건 정리함)`);

  const queue = [];
  let processing = false;
  let currentSignal = null;   // lets a running pipeline be stopped
  let onboardingState = { running: false, at: null, error: null };
  const briefings = new Map();  // requirement -> 미리 짜둔 팀

  async function processQueue() {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
      const requirement = queue.shift();
      currentSignal = { cancelled: false };
      const preHired = briefings.get(requirement) || null;
      briefings.delete(requirement);
      try {
        await runPipeline(db, requirement, project, { budget, maxRework, review, preHired, signal: currentSignal });
      } catch (err) {
        console.error('파이프라인 실패:', err);
      } finally {
        currentSignal = null;
      }
    }
    processing = false;
  }

  function getState() {
    const task = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').get();

    const cumulativeByRole = db
      .prepare(
        `SELECT role,
                COUNT(*) AS stage_count,
                SUM(COALESCE(cost_usd, 0)) AS cost,
                SUM(COALESCE(tokens_input, 0)) AS tokens_input,
                SUM(COALESCE(tokens_output, 0)) AS tokens_output,
                SUM(COALESCE(tokens_cache_read, 0)) AS tokens_cache_read,
                SUM(COALESCE(tokens_cache_creation, 0)) AS tokens_cache_creation
         FROM stages WHERE status = 'done' GROUP BY role`
      )
      .all();
    const cumMap = Object.fromEntries(cumulativeByRole.map((r) => [r.role, r]));

    const stages = task
      ? db.prepare('SELECT * FROM stages WHERE task_id = ? ORDER BY order_index').all(task.id)
      : [];
    const employees = stages.map((st) => {
      const role = ROLE_BY_KEY[st.role_key] || {};
      const cum = cumMap[st.role] || {
        stage_count: 0, cost: 0, tokens_input: 0, tokens_output: 0,
        tokens_cache_read: 0, tokens_cache_creation: 0,
      };
      return {
        key: `${st.role_key}#${st.instance || 0}`,
        roleKey: st.role_key,
        label: st.role,
        category: role.category || '',
        assignment: st.assignment || '',
        deps: (role.deps || []).filter((d) => stages.some((x) => x.role_key === d)),
        status: st.status,
        startedAt: st.started_at,
        completedAt: st.completed_at,
        steps: (role.steps || []).map((x) => x.label),
        attempt: st.attempt || 0,
        reviewStatus: st.review_status || null,
        reviewedBy: (ROLE_BY_KEY[st.role_key]?.reviewedBy || []).filter((k) => stages.some((x) => x.role_key === k)),
        stepIndex: st.step_index,
        stepTotal: st.step_total,
        stepLabel: st.step_label,
        currentOutput: st.output,
        currentCost: st.cost_usd,
        artifact: st.artifact_path ? path.basename(st.artifact_path) : null,
        artifactPath: st.artifact_path,
        currentTokens: st.status === 'done' ? {
          input: st.tokens_input, output: st.tokens_output,
          cacheRead: st.tokens_cache_read, cacheCreation: st.tokens_cache_creation,
        } : null,
        cumulative: cum,
      };
    });

    return {
      task, stages, employees,
      queueLength: queue.length,
      busy: !!currentSignal,
      workspace,
      project: project.name,
      onboarding: {
        hasCode: hasExistingCode(project.workspace),
        done: fs.existsSync(path.join(orgDir(project), 'knowledge', 'CODEBASE.md')),
        running: onboardingState.running,
        stale: project.repos.length ? needsOnboarding(project, project.repos) : false,
      },
      repos: project.repos.map((r) => r.name),
      runDir: task ? task.run_dir : null,
      hireReason: task ? task.hire_reason : null,
      catalogSize: CATALOG.length,
    };
  }

  async function readJsonBody(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    return body ? JSON.parse(body) : {};
  }

  // 경로별 처리기. "METHOD 경로" 를 먼저 찾고 없으면 "* 경로" 를 찾는다 —
  // POST 만 받는 라우트와 메서드를 가리지 않는 라우트를 구분하기 위한 것이다.
  // 표에 없는 경로는 아래에서 정적 파일로, 그것도 아니면 404 로 떨어진다.
  // / 와 /index.html 이 같은 페이지를 내보내므로 처리기를 하나만 둔다
  const serveDashboard = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(publicDir, 'dashboard.html')));
  };

  const ROUTES = {
    'POST /api/tasks': async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const requirement = String(body.requirement || '').trim();
        if (!requirement) {
          sendJson(res, 400, { error: 'requirement is required' });
          return;
        }
        queue.push(requirement);
        processQueue();
        sendJson(res, 202, { queued: true, queueLength: queue.length });
      } catch (e) {
        sendJson(res, 400, { error: 'invalid body' });
      }
    },
    // stop the running pipeline after the step in flight finishes
    'POST /api/cancel': async (req, res) => {
      const dropped = queue.length;
      queue.length = 0;
      if (currentSignal) currentSignal.cancelled = true;
      sendJson(res, 200, { cancelling: !!currentSignal, droppedFromQueue: dropped });
    },
    // one past run, for the history view
    '* /api/run': async (req, res, url) => {
      const id = Number(url.searchParams.get('id'));
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!task) { res.writeHead(404); res.end('not found'); return; }
      const stages = db.prepare('SELECT * FROM stages WHERE task_id = ? ORDER BY order_index').all(id);
      sendJson(res, 200, { task, stages });
    },
    // serve a produced artifact — confined to the workspace's .agent-org dir
    '* /api/artifact': async (req, res, url) => {
      const target = path.resolve(url.searchParams.get('path') || '');
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(target);
      const type = ext === '.html' ? 'text/html' : 'text/plain';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(fs.readFileSync(target));
    },
    // 코드 파악을 지금 시작한다 (업무를 던지지 않아도 눌러서 할 수 있게)
    'POST /api/onboard': async (req, res) => {
      if (onboardingState.running) {
        sendJson(res, 409, { error: '이미 파악 중입니다' });
        return;
      }
      if (!hasExistingCode(project.workspace)) {
        sendJson(res, 400, { error: '이 폴더에는 파악할 코드가 없습니다' });
        return;
      }

      onboardingState = { running: true, at: new Date().toISOString(), error: null };
      sendJson(res, 202, { started: true });

      // 응답은 바로 주고 뒤에서 돌린다 (몇 분 걸린다)
      runOnboarding(project, project.repos)
        .then((r) => { onboardingState = { running: false, at: null, error: r.ok ? null : '결과가 비어 있습니다' }; })
        .catch((e) => { onboardingState = { running: false, at: null, error: String(e.message || e) }; });
    },
    '* /api/onboard/status': async (req, res) => {
      sendJson(res, 200, {
        ...onboardingState,
        onboarded: fs.existsSync(path.join(orgDir(project), 'knowledge', 'CODEBASE.md')),
      });
    },
    // 이 프로젝트가 무엇인지 — 팀이 파악한 내용을 한 화면에
    '* /api/project': async (req, res) => {
      const section = (file, title) => {
        try {
          const raw = fs.readFileSync(path.join(orgDir(project), 'knowledge', file), 'utf8');
          const m = raw.match(new RegExp(`^##\\s*${title}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm'));
          return m ? m[1].trim() : null;
        } catch { return null; }
      };

      const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 8').all();
      const totals = db.prepare('SELECT COUNT(*) n FROM tasks').get();
      const cost = db.prepare('SELECT SUM(COALESCE(cost_usd,0)) c FROM stages').get().c || 0;
      const verdicts = db.prepare(
        "SELECT output FROM stages WHERE role_key='qa' AND output IS NOT NULL"
      ).all();

      const hist = project.repos.map((r) => {
        const h = repoHistory(r.path, r.name);
        return h.empty ? { name: r.name, empty: true } : {
          name: h.name, commits: h.count, convention: h.convention,
          first: h.first.slice(0, 10), last: h.last.slice(0, 10),
          fixes: h.fixes, tags: h.tags.slice(0, 3),
          hotspots: h.hotspots.slice(0, 6),
          recent: h.recent.slice(0, 8),
          contributors: h.contributors.slice(0, 4),
        };
      });

      sendJson(res, 200, {
        name: project.name,
        workspace: project.workspace,
        docsDir: orgDir(project),
        related: project.related || [],
        repos: project.repos.map((r) => ({
          name: r.name, origin: r.origin,
          branch: currentBranch(r.path), dirty: isDirty(r.path),
        })),
        onboarded: fs.existsSync(path.join(orgDir(project), 'knowledge', 'CODEBASE.md')),
        onboarding: onboardingState.running,
        onboardError: onboardingState.error,
        hasCode: hasExistingCode(project.workspace),
        stale: project.repos.length ? needsOnboarding(project, project.repos) : false,
        contracts: (() => {
          try {
            const raw = fs.readFileSync(path.join(orgDir(project), 'knowledge', 'CONTRACTS.md'), 'utf8');
            const eps = [...new Set(
              (raw.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_\-/:{}.]*/g) || [])
            )].slice(0, 30);
            const tasks = (raw.match(/^## Task #/gm) || []).length;
            return { has: true, endpoints: eps, entries: tasks };
          } catch { return { has: false, endpoints: [], entries: 0 }; }
        })(),
        backlog: { ...backlogStats(project), items: openItems(project) },
        summary: section('CODEBASE.md', '한 줄 요약'),
        flow: section('CODEBASE.md', '지금까지의 흐름'),
        interfaces: section('CODEBASE.md', '기존 인터페이스'),
        conventions: section('CODEBASE.md', '코드 관례'),
        risky: section('CODEBASE.md', '건드리면 위험한 곳'),
        teamRules: section('CODEBASE.md', '팀 규칙'),
        history: hist,
        stats: {
          runs: totals.n,
          cost,
          pass: verdicts.filter((v) => /판정:\s*PASS/.test(v.output)).length,
          fail: verdicts.filter((v) => /판정:\s*FAIL/.test(v.output)).length,
        },
        recent: tasks.map((t) => ({
          id: t.id, requirement: t.requirement, status: t.status, kind: t.kind,
          at: (t.created_at || '').slice(0, 16),
          git: t.git_result ? JSON.parse(t.git_result) : null,
        })),
      });
    },
    // 착수 브리핑 — 실제로 일을 시키기 전에 "이 팀으로 하겠다"를 보여준다
    'POST /api/plan': async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const requirement = String(body.requirement || '').trim();
        if (!requirement) {
          sendJson(res, 400, { error: 'requirement is required' });
          return;
        }
        const hired = await hireTeam(requirement, codebaseBrief(project, 2500));
        briefings.set(requirement, hired);

        const byKey = {};
        hired.roster.forEach((p) => { byKey[p.key] = (byKey[p.key] || 0) + 1; });

        const guide = KIND_GUIDE[hired.kind] || KIND_GUIDE.new;
        const writable = project.repos.length ? checkWritable(project.repos) : { ok: true, problems: [] };

        sendJson(res, 200, {
          requirement,
          reason: hired.reason,
          cost: hired.cost,
          kind: hired.kind,
          kindLabel: guide.label,
          kindNote: guide.note,
          // 브리핑 시점의 실제 상태를 읽는다 (서버 시작 때 값은 이미 낡았을 수 있다)
          repos: project.repos.map((r) => ({
            name: r.name, origin: r.origin,
            branch: currentBranch(r.path), dirty: isDirty(r.path),
          })),
          warnings: writable.problems,
          team: hired.roster.map((p) => ({
            key: p.key,
            title: personTitle(p),
            label: ROLE_BY_KEY[p.key]?.label || p.key,
            category: ROLE_BY_KEY[p.key]?.category || '',
            blurb: ROLE_BY_KEY[p.key]?.blurb || '',
            assignment: p.assignment,
            instance: p.instance,
            total: p.total,
            hiredBecause: p.hiredBecause || null,
            reviewedBy: (ROLE_BY_KEY[p.key]?.reviewedBy || [])
              .filter((k) => hired.roster.some((o) => o.key === k))
              .map((k) => ROLE_BY_KEY[k]?.label || k),
          })),
          waves: buildWaves(hired.roster),
        });
      } catch (e) {
        sendJson(res, 500, { error: String(e.message || e) });
      }
    },
    // 직원 명부 — 어떤 직무가 있고, 어떤 프롬프트로 일하는지
    '* /api/catalog': async (req, res) => {
      const stats = db.prepare(
        `SELECT role_key,
                COUNT(*) AS hires,
                SUM(COALESCE(cost_usd,0)) AS cost,
                AVG(COALESCE(cost_usd,0)) AS avg_cost,
                SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
         FROM stages WHERE role_key IS NOT NULL GROUP BY role_key`
      ).all();
      const statMap = Object.fromEntries(stats.map((r) => [r.role_key, r]));

      const employedNow = new Set(
        (db.prepare('SELECT role_key FROM stages WHERE task_id = (SELECT MAX(id) FROM tasks)').all() || [])
          .map((r) => r.role_key)
      );

      sendJson(res, 200, CATALOG.map((r) => ({
        key: r.key, label: r.label, category: r.category, blurb: r.blurb,
        artifact: r.defaultArtifact, stackKey: r.stackKey || null,
        decidesStack: !!r.decidesStack, watchdog: !!r.watchdog,
        reviewedBy: r.reviewedBy || [],
        mode: r.mode, deps: r.deps,
        core: !!r.core, splittable: !!r.splittable,
        systemPrompt: r.systemPrompt,
        steps: (r.steps || []).map((x) => ({ label: x.label, prompt: x.prompt })),
        handsTo: CATALOG.filter((x) => x.deps.includes(r.key)).map((x) => x.label),
        stats: statMap[r.key] || { hires: 0, cost: 0, avg_cost: 0, done: 0 },
        employedNow: employedNow.has(r.key),
      })));
    },
    // the whole .agent-org tree, so the docs can be browsed from the dashboard
    '* /api/tree': async (req, res) => {
      const walk = (dir, rel = '') => {
        let out = [];
        for (const name of fs.readdirSync(dir).sort()) {
          if (name === 'agent-org.db' || name.startsWith('agent-org.db-')) continue;
          const full = path.join(dir, name);
          const relPath = rel ? `${rel}/${name}` : name;
          if (fs.statSync(full).isDirectory()) {
            out.push({ type: 'dir', name, path: relPath, children: walk(full, relPath) });
          } else {
            out.push({ type: 'file', name, path: relPath, abs: full, size: fs.statSync(full).size });
          }
        }
        return out;
      };
      sendJson(res, 200, fs.existsSync(root) ? walk(root) : []);
    },
    '* /api/runs': async (req, res) => {
      const rows = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 30').all();
      sendJson(res, 200, rows);
    },
    '* /events': async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      let last = '';
      const tick = () => {
        const json = JSON.stringify(getState());
        if (json !== last) { last = json; res.write(`data: ${json}\n\n`); }
      };
      tick();
      const interval = setInterval(tick, 500);
      req.on('close', () => clearInterval(interval));
    },
    '* /': serveDashboard,
    '* /index.html': serveDashboard,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    const handler = ROUTES[`${req.method} ${url.pathname}`] || ROUTES[`* ${url.pathname}`];
    if (handler) { await handler(req, res, url); return; }

    // 대시보드가 직접 불러오는 정적 파일. 빌드 단계를 두지 않으므로 브라우저가
    // css·js 를 그대로 읽는다. public/ 바로 아래 한 겹만 허용한다 —
    // 이름에 / 가 들어가면 거부하므로 상위 경로로 나갈 방법이 없다.
    const name = url.pathname.slice(1);
    if (STATIC_TYPES[path.extname(name)] && !name.includes('/')) {
      const target = path.join(publicDir, name);
      if (fs.existsSync(target)) {
        res.writeHead(200, { 'Content-Type': `${STATIC_TYPES[path.extname(name)]}; charset=utf-8` });
        res.end(fs.readFileSync(target));
        return;
      }
    }

    res.writeHead(404);
    res.end('not found');
  });

  // If the port is taken, walk forward instead of dying — but only when the
  // user did not pin a port explicitly.
  let attempts = 0;
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (portPinned || attempts >= 12) {
      console.error(`\n  포트 ${port} 이미 사용 중입니다.`);
      if (port === 5000 || port === 7000) {
        console.error('  (macOS는 5000/7000을 AirPlay 수신이 점유합니다 — 시스템 설정에서 끄거나 다른 포트를 쓰세요)');
      }
      console.error(`  예: agent-org --port ${port + 1}\n`);
      process.exit(1);
    }
    attempts++;
    const next = port + attempts;
    console.log(`  포트 ${port + attempts - 1} 사용 중 → ${next} 로 시도합니다.`);
    server.listen(next);
  });

  server.listen(port, () => {
    const actual = server.address().port;
    console.log(`\n  AI Org 대시보드  http://localhost:${actual}`);
    console.log(`  작업 폴더        ${workspace}`);
    console.log(`  프로젝트         ${project.name}${project.repos.length ? `  (repo ${project.repos.map((r) => r.name).join(', ')})` : '  (git repo 없음)'}`);
    console.log(`  문서·기록        ${path.join(orgDir(project), 'runs')}  (최신: runs/latest)`);
    console.log(`  작업당 예산       ${budget > 0 ? '$' + budget : '제한 없음'}`);
    console.log(`  상호 검토         ${review ? '켬' : '끔'}\n`);
  });

  return server;
}

// `node server.mjs` still works, using the current directory as the workspace
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  startServer({ workspace: process.cwd(), port: Number(process.env.PORT) || 4747 });
}
