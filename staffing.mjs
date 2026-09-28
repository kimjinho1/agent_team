import { query } from '@anthropic-ai/claude-agent-sdk';
import { CATALOG, ROLE_BY_KEY, BUILDERS } from './roles.mjs';

// 일을 받으면 먼저 팀을 짠다. 사람을 미리 정해두지 않고, 그 일에 필요한
// 직무를 필요한 인원만큼만 고용한다. 같은 직무를 여러 명 뽑으면 일을 쪼갠다.

const HIRE_PROMPT = `당신은 이 회사의 인사 담당자입니다. 아래 일감을 보고 팀을 짜세요.

[고용 가능한 직무]
${CATALOG.map((r) => `- ${r.key} (${r.label}): ${r.blurb}${r.splittable ? ' [여러 명 가능]' : ''}`).join('\n')}

[규칙]
1. 그 일에 실제로 필요한 직무만 고용하세요. 안 쓸 사람은 뽑지 마세요.
2. [여러 명 가능] 직무는 일이 충분히 크고 독립적으로 나뉠 때만 2명 이상 뽑으세요.
3. 여러 명을 뽑으면 각자 맡을 범위를 서로 겹치지 않게 한 문장으로 적으세요.
4. 전체 인원은 3명 이상 9명 이하로 유지하세요.
5. 기술 스택은 아키텍트나 개발리드가 정합니다. 구현 규모가 크거나 기술 선택이 중요하면 아키텍트를 뽑으세요.

[일감 성격]
먼저 이 일이 어떤 성격인지 정하세요. 성격에 따라 필요한 사람이 다릅니다.
- new       : 처음부터 만든다
- feature   : 이미 있는 것 위에 기능을 더한다
- bugfix    : 잘못 동작하는 것을 고친다 (최소 인원으로)
- refactor  : 동작은 그대로 두고 구조를 바꾼다
- chore     : 문서·설정 등 잡일

bugfix 와 chore 는 사람을 적게 쓰세요. 버그 하나에 사장까지 부르지 마세요.
기존 코드베이스 정보가 아래에 있으면 그걸 근거로 판단하세요.

[출력 형식]
설명 없이 JSON만 출력하세요.
{"kind":"feature","team":[{"role":"pm","count":1,"split":["전체"]},{"role":"fe","count":2,"split":["목록과 상세 화면","입력 폼과 검증"]}],"reason":"한 문장"}`;

const KINDS = ['new', 'feature', 'bugfix', 'refactor', 'chore'];

/** 성격별로 팀이 어떻게 달라지는지 */
export const KIND_GUIDE = {
  new: { label: '신규 제작', note: '처음부터 만든다' },
  feature: { label: '기능 추가', note: '기존 코드 위에 더한다. 기존 동작을 깨지 않는 게 우선이다' },
  bugfix: { label: '버그 수정', note: '재현 경로를 먼저 정하고, 원인만 최소로 고친다. 김에 다른 걸 고치지 않는다' },
  refactor: { label: '리팩터링', note: '겉보기 동작은 그대로 둔다. 바꾼 뒤에도 같게 동작하는지 확인이 핵심이다' },
  chore: { label: '잡일', note: '문서·설정 정리. 코드 동작은 건드리지 않는다' },
};

/** LLM이 팀을 제안하고, 규칙에 맞게 보강한 뒤 확정한다. */
export async function hireTeam(requirement, context = '') {
  let proposed = null;
  let cost = 0;

  try {
    let text = '';
    for await (const m of query({
      prompt: `${HIRE_PROMPT}\n\n[일감]\n${requirement}` +
              (context ? `\n\n---\n\n${context.slice(0, 3000)}` : ''),
      options: {
        systemPrompt: '당신은 인사 담당자입니다. JSON만 출력합니다.',
        maxTurns: 3,
        disallowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'Task'],
      },
    })) {
      if (m.type === 'assistant') {
        text += m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      } else if (m.type === 'result') {
        cost = m.total_cost_usd || 0;
      }
    }
    const json = text.match(/\{[\s\S]*\}/);
    if (json) proposed = JSON.parse(json[0]);
  } catch {
    proposed = null; // 실패하면 기본 팀으로 간다
  }

  const kind = KINDS.includes(proposed?.kind) ? proposed.kind : (context ? 'feature' : 'new');
  const roster = reinforce(normalize(proposed), kind);
  return { roster, cost, kind, reason: proposed?.reason || '기본 편성' };
}

function normalize(proposed) {
  const out = [];
  for (const item of proposed?.team || []) {
    const role = ROLE_BY_KEY[item.role];
    if (!role) continue;
    const max = role.splittable ? 3 : 1;
    const count = Math.min(Math.max(1, Number(item.count) || 1), max);
    const split = Array.isArray(item.split) ? item.split : [];
    for (let i = 0; i < count; i++) {
      out.push({
        key: role.key,
        instance: i,
        total: count,
        assignment: (split[i] || '').trim() || '전체',
      });
    }
  }
  return out;
}

/**
 * 빠진 사람을 채운다. FE 없이 UI를 볼 수 없고, 계약 없이 병렬 개발이 안 되는 것처럼
 * 팀이 성립하려면 반드시 있어야 하는 자리가 있다.
 */
function reinforce(roster, kind = 'new') {
  const has = (k) => roster.some((p) => p.key === k);
  const add = (k, why) => {
    if (has(k)) return;
    roster.push({ key: k, instance: 0, total: 1, assignment: '전체', hiredBecause: why });
  };

  // 만들 사람이 아무도 없으면 아무것도 안 나온다
  if (!BUILDERS.some(has)) add('fe', '만들 사람이 없어서');

  // 무엇을 만들지 정하는 사람과, 됐는지 보는 사람은 항상 필요하다.
  // 다만 버그 하나 고치는 데 요구사항 정의부터 하지는 않는다.
  if (kind === 'bugfix' || kind === 'chore') {
    add('qa', '고쳐졌는지 확인해야 해서');
  } else {
    CATALOG.filter((r) => r.core).forEach((r) => add(r.key, '필수 직무'));
  }

  // 구현 인원이 둘 이상이면 서로 부딪히지 않게 계약이 필요하다
  const builderKinds = BUILDERS.filter(has).length;
  const builderHeads = roster.filter((p) => BUILDERS.includes(p.key)).length;
  if (builderKinds > 1 || builderHeads > 1) add('lead', '구현 인원이 여럿이라 계약이 필요해서');

  // 선행 직무는 "뽑혔으면 기다린다"일 뿐, 없다고 억지로 채우지 않는다.
  // 작은 일에 사장·기획자까지 끌어오면 비용만 늘고 결과는 그대로다.

  const order = Object.fromEntries(CATALOG.map((r, i) => [r.key, i]));
  roster.sort((a, b) => order[a.key] - order[b.key] || a.instance - b.instance);

  const counts = {};
  roster.forEach((p) => { counts[p.key] = (counts[p.key] || 0) + 1; });
  roster.forEach((p) => { p.total = counts[p.key]; });

  return roster;
}

/** "FE 2번" 처럼 부를 이름 */
export function personTitle(p) {
  const label = ROLE_BY_KEY[p.key].label;
  return p.total > 1 ? `${label} ${p.instance + 1}` : label;
}

/**
 * 이 사람이 기다려야 하는 사람들.
 *
 * 선행 직무가 이번에 안 뽑혔다면 그 자리를 건너뛰되, 그 위의 선행까지 거슬러
 * 올라가 "뽑힌 사람"을 찾는다. 기획자를 안 뽑았다고 개발리드가 PM보다 먼저
 * 시작해서는 안 되기 때문이다.
 */
export function personDeps(p, roster) {
  const hired = new Set(roster.map((o) => o.key));
  const found = new Set();
  const seen = new Set();

  const walk = (key) => {
    for (const dep of ROLE_BY_KEY[key]?.deps || []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (hired.has(dep)) found.add(dep);
      else walk(dep);            // 빈 자리는 통과해서 그 위를 본다
    }
  };
  walk(p.key);

  return roster.filter((o) => found.has(o.key) && o.key !== p.key);
}
