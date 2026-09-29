import fs from 'node:fs';
import path from 'node:path';
import { orgDir } from './db.mjs';

// 실행이 끝날 때마다 "이번엔 안 하기로 한 것"이 여기저기서 나온다.
//
//   기획자 → 이번 범위 밖 항목
//   리드   → 확장 지점
//   보안   → 나중에 해도 되는 것
//   QA     → 비차단 사항, 다음 검증에 넘길 것
//   PM     → 다음에 바꿀 것
//
// 지금까지는 각자 문서에 적히고 끝이라 다음 실행이 전혀 몰랐다. 그래서 같은 걸
// 또 미루거나, 이미 미뤄둔 걸 모르고 다시 논의한다.
// 이 파일은 그 항목들을 한 곳에 모아 다음 PM 이 보고 판단할 수 있게 한다.

const file = (project) => path.join(orgDir(project), 'knowledge', 'BACKLOG.md');

/** 어느 역할의 어느 섹션이 "미룬 것"인지 */
const SOURCES = [
  { role: 'planner', patterns: [/범위\s*밖/, /다음\s*범위/, /이번엔?\s*안/] },
  { role: 'lead', patterns: [/확장\s*지점/] },
  { role: 'architect', patterns: [/확장\s*지점/, /나중에/] },
  { role: 'security', patterns: [/나중에/, /우선순위\s*낮/] },
  { role: 'qa', patterns: [/비차단/, /다음\s*검증/, /PASS\s*조건/] },
  { role: 'pm', patterns: [/다음에\s*바꿀/, /다음\s*단계/] },
];

/** 문서에서 해당 섹션의 불릿만 뽑는다 */
function itemsFromSections(text, patterns) {
  if (!text) return [];
  const out = [];
  const lines = text.split('\n');
  let inside = false;

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      inside = patterns.some((p) => p.test(heading[1]));
      continue;
    }
    if (!inside) continue;

    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
    if (!bullet) continue;

    const t = bullet[1]
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();
    // 표 줄이나 너무 짧은 조각은 버린다
    if (t.length < 8 || t.startsWith('|')) continue;
    out.push(t.slice(0, 180));
  }
  return out.slice(0, 8);   // 한 역할이 백로그를 도배하지 않게
}

// 프롬프트에 20개, 화면 패널에 12개까지만 보낸다
const BRIEF_ITEMS = 20;
const PANEL_ITEMS = 12;

const norm = (s) => s.toLowerCase().replace(/[^가-힣a-z0-9]/g, '').slice(0, 60);

/** 이번 실행에서 미룬 것들을 모은다 */
export function collectDeferred(stages) {
  const found = [];
  for (const src of SOURCES) {
    const stage = stages.find((s) => s.role_key === src.role);
    if (!stage?.output) continue;
    for (const text of itemsFromSections(stage.output, src.patterns)) {
      found.push({ from: stage.role, text });
    }
  }
  return found;
}

/** 프로젝트 백로그에 덧붙인다 (이미 있는 항목은 건너뛴다) */
export function appendBacklog(project, { taskId, requirement, items, at }) {
  if (!items?.length) return { added: 0 };

  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });

  const prev = fs.existsSync(file(project)) ? fs.readFileSync(file(project), 'utf8') : '';
  // 저장 형식은 `- [ ] 본문 — 역할` 이다. 역할이 아니라 본문으로 중복을 판단한다.
  const seen = new Set(
    [...prev.matchAll(/^- \[[ x]\] (.+?)\s*—\s*\S+\s*$/gm)].map((m) => norm(m[1]))
  );

  const fresh = items.filter((i) => {
    const k = norm(i.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return { added: 0 };

  const header = prev || `# 남은 일

팀이 **이번엔 안 하기로 한 것**들입니다. 다음 작업을 정할 때 여기서 고르면 됩니다.

\`[ ]\` 는 아직 안 한 것, \`[x]\` 는 처리한 것입니다. 직접 고쳐도 됩니다.
`;

  const stamp = (at || new Date().toISOString()).slice(0, 10);
  const block = `

## Task #${taskId} 에서 미룸 — ${requirement}

_${stamp}_

${fresh.map((i) => `- [ ] ${i.text} — ${i.from}`).join('\n')}
`;

  fs.writeFileSync(file(project), header.trimEnd() + block);
  return { added: fresh.length };
}

/** 다음 PM 이 받을 요약 — 열려 있는 항목만 */
export function backlogBrief(project) {
  if (!fs.existsSync(file(project))) return '';
  const raw = fs.readFileSync(file(project), 'utf8');

  const open = [...raw.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1].trim());
  if (!open.length) return '';

  return `[남은 일 — 이전 작업에서 미룬 것]\n${open.slice(0, BRIEF_ITEMS).map((t) => `- ${t}`).join('\n')}\n\n` +
    `이번 요구사항과 관련된 항목이 있으면 범위에 넣을지 판단하세요. ` +
    `관련 없으면 무시하고, 넣지 않기로 했다면 굳이 언급하지 마세요.`;
}

export function backlogStats(project) {
  if (!fs.existsSync(file(project))) return { open: 0, done: 0 };
  const raw = fs.readFileSync(file(project), 'utf8');
  return {
    open: (raw.match(/^- \[ \] /gm) || []).length,
    done: (raw.match(/^- \[x\] /gim) || []).length,
  };
}

export function openItems(project) {
  if (!fs.existsSync(file(project))) return [];
  const raw = fs.readFileSync(file(project), 'utf8');
  return [...raw.matchAll(/^- \[ \] (.+?)\s*—\s*(\S+)\s*$/gm)]
    .map((m) => ({ text: m[1].trim(), from: m[2] }))
    .slice(0, PANEL_ITEMS);
}
