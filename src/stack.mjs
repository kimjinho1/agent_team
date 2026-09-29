// 기술 스택은 사람이 정한다. 아키텍트가 있으면 아키텍트가, 없으면 개발리드가.
// 둘 다 없는 작은 팀이면 기본값으로 간다.
//
// 결정은 그들의 산출물 안 JSON 블록으로 들어오고, 파이프라인이 그걸 읽어
// 구현 직무의 파일명과 언어를 확정한다.

const AREAS = ['frontend', 'backend', 'mobile', 'database', 'ml'];

/** 아무도 정해주지 않았을 때 — 가장 단순한 선택 */
export const DEFAULT_STACK = {
  frontend: { tech: '바닐라 HTML/CSS/JS', entry: 'index.html', lang: 'html' },
  backend: { tech: 'Node.js + Express', entry: 'server.js', lang: 'js' },
  mobile: { tech: null, entry: null, lang: null },
  database: { tech: null, entry: null, lang: null },
  ml: { tech: null, entry: null, lang: null },
};

/** 산출물에서 스택 선언 JSON을 찾아낸다. 못 찾으면 null. */
export function parseStack(text) {
  if (!text) return null;

  // ```json 블록을 뒤에서부터 본다 (마지막 선언이 최종 결정)
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const raw of blocks.reverse()) {
    const parsed = tryParse(raw);
    if (parsed) return parsed;
  }

  // 코드펜스 없이 쓴 경우도 한 번 훑는다
  const loose = text.match(/\{[^{}]*"frontend"[\s\S]*?\}\s*\}/);
  return loose ? tryParse(loose[0]) : null;
}

function tryParse(raw) {
  try {
    const obj = JSON.parse(raw.trim());
    if (!AREAS.some((a) => obj[a])) return null;

    const out = {};
    for (const area of AREAS) {
      const v = obj[area] || {};
      const tech = clean(v.tech);
      out[area] = tech
        ? { tech, entry: cleanEntry(v.entry) || null, lang: clean(v.lang) || null }
        : { tech: null, entry: null, lang: null };
    }
    return out;
  } catch {
    return null;
  }
}

function clean(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'null' || s === '없음' || s === '-') return null;
  return s.slice(0, 120);
}

/**
 * 파일 경로는 작업 폴더 안의 상대경로만 받는다.
 * `src/server.js` 같은 정상 경로는 살리고, 절대경로나 `..` 로 빠져나가는 건 버린다.
 */
function cleanEntry(v) {
  const s = clean(v);
  if (!s) return null;
  const norm = s.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null;   // 절대경로
  if (norm.split('/').includes('..')) return null;                     // 상위로 탈출
  if (!/^[가-힣A-Za-z0-9._\-/]+$/.test(norm)) return null;
  return norm.slice(0, 120);
}

/** 스택이 비어 있는 영역을 기본값으로 메운다 (구현자가 있는 영역만) */
export function fillGaps(stack, roster, roleAreaOf) {
  const merged = { ...DEFAULT_STACK, ...(stack || {}) };
  for (const p of roster) {
    const area = roleAreaOf(p.key);
    if (!area) continue;
    if (!merged[area]?.entry) {
      merged[area] = DEFAULT_STACK[area]?.entry
        ? { ...DEFAULT_STACK[area] }
        : { tech: '직접 판단', entry: null, lang: null };
    }
  }
  return merged;
}

/** 프롬프트에 넣을 한 문단 */
export function stackBrief(stack) {
  const lines = AREAS
    .filter((a) => stack?.[a]?.tech)
    .map((a) => `- ${a}: ${stack[a].tech}${stack[a].entry ? ` (파일: ${stack[a].entry})` : ''}`);
  return lines.length ? `[확정된 기술 스택]\n${lines.join('\n')}` : '';
}
