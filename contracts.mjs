import fs from 'node:fs';
import path from 'node:path';
import { orgDir } from './db.mjs';

// 계약은 실행 하나짜리가 아니다.
//
// 첫 작업에서 정한 `{ data, error }` 응답 형식이나 에러 코드는 두 번째 작업에서도
// 그대로 지켜져야 한다. 그런데 실행마다 계약을 새로 쓰면 이전 약속이 사라지고,
// 두 번째 작업이 형식을 멋대로 바꿔 기존 클라이언트를 깬다.
//
// 그래서 프로젝트 차원에 하나의 CONTRACTS.md 를 두고, 실행이 끝날 때마다
// 그 실행의 계약을 "이력"으로 덧붙인다. 다음 실행의 리드는 이 문서를 받아
// 기존 약속을 유지한 채 필요한 것만 더한다.

const file = (project) => path.join(orgDir(project), 'knowledge', 'CONTRACTS.md');

const HEADER = `# 인터페이스 계약 (누적)

이 프로젝트에서 지금까지 확정된 약속입니다. **새 작업은 아래 계약을 깨지 않아야 합니다.**
바꿔야 한다면 왜 바꾸는지와 기존 사용처에 미치는 영향을 먼저 적으세요.

아래는 실행 순서대로 쌓인 기록이며, **나중 항목이 앞 항목을 덮어쓰지 않습니다.**
충돌이 보이면 그 자체가 검토 대상입니다.
`;

/** 계약 문서에서 엔드포인트처럼 보이는 줄만 추려 빠르게 훑을 수 있게 */
function extractEndpoints(text) {
  const found = new Set();
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/:{}.]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) found.add(`${m[1]} ${m[2]}`);
  return [...found].slice(0, 40);
}

/** 이번 실행의 계약을 프로젝트 계약서에 덧붙인다 */
export function appendContract(project, { taskId, requirement, kind, contract, at }) {
  if (!contract || !contract.trim()) return null;

  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });

  const endpoints = extractEndpoints(contract);
  const stamp = (at || new Date().toISOString()).slice(0, 16).replace('T', ' ');

  const entry = `

---

## Task #${taskId} · ${requirement}

_${stamp} · ${kind || 'new'}_
${endpoints.length ? `\n**이번에 정해진 엔드포인트**\n${endpoints.map((e) => `- \`${e}\``).join('\n')}\n` : ''}
<details>
<summary>계약 전문 펼치기</summary>

${contract.trim()}

</details>
`;

  const prev = fs.existsSync(file(project)) ? fs.readFileSync(file(project), 'utf8') : HEADER;
  fs.writeFileSync(file(project), prev.trimEnd() + entry);
  return { endpoints };
}

/**
 * 다음 실행의 리드에게 넘길 요약.
 *
 * 전문을 다 넣으면 실행이 쌓일수록 프롬프트가 터진다. 그래서 엔드포인트 목록과
 * 최근 계약 본문만 싣는다. 전문은 문서에 남아 있다.
 */
export function contractsBrief(project, { recent = 1, limit = 5000 } = {}) {
  if (!fs.existsSync(file(project))) return '';
  const raw = fs.readFileSync(file(project), 'utf8');

  const endpoints = extractEndpoints(raw);
  const blocks = raw.split(/\n---\n/).slice(1);        // 헤더 제외
  const tail = blocks.slice(-recent).join('\n---\n');

  const parts = ['[기존 인터페이스 계약 — 이 약속을 깨지 마세요]'];
  if (endpoints.length) {
    parts.push(`이미 확정된 엔드포인트:\n${endpoints.map((e) => `- ${e}`).join('\n')}`);
  }
  if (tail.trim()) {
    parts.push(`가장 최근 계약:\n${tail.slice(0, limit)}`);
  }
  parts.push(
    '위 계약의 경로·필드명·응답 형식·에러 코드를 그대로 유지하세요.\n' +
    '바꿔야 한다면 계약 문서에 "변경 사유"와 "기존 사용처 영향"을 명시하세요.'
  );
  return parts.join('\n\n');
}
