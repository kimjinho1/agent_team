import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { orgDir } from './db.mjs';
import { writeHistory, historyBrief } from './history.mjs';

// 이미 굴러가던 프로젝트에 팀을 투입하면, 팀은 그 코드를 모른다.
// 모르는 채로 만들면 기존 관례를 무시한 코드가 나온다.
// 그래서 첫 진입 때 한 번 훑어서 CODEBASE.md 를 만들어 둔다.
//
// 이 단계만 파일 읽기를 허용한다. 쓰기·실행·네트워크는 막는다.

// allowedTools 는 "물어보지 않고 허용" 목록이고, 실제로 막는 건 disallowedTools 다.
const ALLOWED = ['Read', 'Glob', 'Grep'];
const BLOCKED = [
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Bash', 'BashOutput', 'KillShell',
  'WebFetch', 'WebSearch', 'Task', 'Agent',
];

const PROMPT = `당신은 이 프로젝트에 새로 합류한 개발자입니다.
코드를 읽고 **다음 사람이 작업을 시작할 수 있는 최소 정보**를 정리하세요.

규칙
- 실제로 파일을 열어 확인한 것만 쓰세요. 추측하지 마세요.
- 파일을 전부 읽으려 하지 마세요. 진입점·설정·대표 모듈 위주로 10~20개면 충분합니다.
- README, docs/, CHANGELOG 가 있으면 **먼저** 읽으세요. 의도가 거기 적혀 있습니다.
- 아래 [git 내력]은 이미 추출된 사실입니다. 다시 조사하지 말고 해석에만 쓰세요.
- 코드를 그대로 옮기지 마세요. 구조와 규칙을 요약하세요.

아래 형식으로 쓰세요.

## 한 줄 요약
이 프로젝트가 무엇인지 한 문장.

## 지금까지의 흐름
git 내력과 README·문서를 근거로, 이 프로젝트가 **무엇을 만들어왔고 지금 어디로
가고 있는지** 3~5문장. 최근 커밋이 어느 방향을 향하는지 반드시 언급하세요.
중단된 것처럼 보이는 작업이 있으면 적으세요.

## 기술 스택
언어·프레임워크·주요 라이브러리. 확인한 파일(package.json 등)을 근거로.
마지막에 아래 JSON 블록을 포함하세요. 없는 영역은 null.

\`\`\`json
{"frontend":{"tech":null,"entry":null,"lang":null},
 "backend":{"tech":null,"entry":null,"lang":null},
 "mobile":{"tech":null,"entry":null,"lang":null},
 "database":{"tech":null,"entry":null,"lang":null},
 "ml":{"tech":null,"entry":null,"lang":null}}
\`\`\`

## 폴더 구조
중요한 폴더와 그 역할. 트리로.

## 진입점
실행이 시작되는 파일과 실행 방법.

## 기존 인터페이스
이미 있는 API 엔드포인트·주요 함수·데이터 모델. 없으면 "없음".

## 코드 관례
이 프로젝트가 따르는 규칙. 네이밍·파일 배치·에러 처리·테스트 방식 등
**코드에서 관찰된 것만**. 새로 작업할 사람이 어기면 안 되는 것들.

## 건드리면 위험한 곳
바꿀 때 조심해야 할 파일이나 패턴.
**자주 바뀐 파일과 되돌림·수정 커밋이 몰린 곳을 근거로** 짚으세요.
없으면 "특이사항 없음".

## 팀 규칙
커밋 메시지 형식, 브랜치 규칙 등 히스토리에서 관찰되는 이 팀의 약속.
새로 합류한 사람이 어기면 안 되는 것. 없으면 "특이사항 없음".`;

/** repo 들의 현재 커밋. 많이 달라졌으면 다시 훑어야 한다. */
function fingerprint(repos) {
  return repos
    .map((r) => {
      try {
        const head = execFileSync('git', ['-C', r.path, 'rev-parse', 'HEAD'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim().slice(0, 12);
        return `${r.name}:${head}`;
      } catch {
        return `${r.name}:none`;
      }
    })
    .sort()
    .join(' ');
}

/** 이 폴더에 볼 만한 코드가 있는가 (빈 폴더면 온보딩할 게 없다) */
export function hasExistingCode(workspace) {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'agent-org']);
  let count = 0;
  const walk = (dir, depth) => {
    if (depth > 3 || count > 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
      else if (/\.(js|mjs|ts|tsx|jsx|py|go|rb|java|kt|swift|rs|php|html|css|sql)$/.test(e.name)) count++;
      if (count > 0) return;
    }
  };
  walk(workspace, 0);
  return count > 0;
}

const notePath = (project) => path.join(orgDir(project), 'knowledge', 'CODEBASE.md');
const stampPath = (project) => path.join(orgDir(project), '.state', 'onboarding.json');

/** 온보딩이 필요한가 — 처음이거나, 코드가 그새 많이 바뀌었거나 */
export function needsOnboarding(project, repos) {
  if (!hasExistingCode(project.workspace)) return false;
  if (!fs.existsSync(notePath(project))) return true;
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath(project), 'utf8'));
    return stamp.fingerprint !== fingerprint(repos);
  } catch {
    return true;
  }
}

/**
 * 코드를 읽고 CODEBASE.md 를 만든다.
 * 읽기 도구만 허용하고 작업 폴더 안으로 제한한다.
 */
export async function runOnboarding(project, repos, { signal = { cancelled: false } } = {}) {
  const repoList = repos.length
    ? repos.map((r) => `- ${r.name} (${r.origin || '로컬'})`).join('\n')
    : '- (git repo 없음)';

  // git 에서 뽑을 수 있는 건 모델에게 묻지 않는다 (정확하고 공짜다)
  let gitBrief = '';
  try {
    writeHistory(project, repos);
    gitBrief = historyBrief(repos);
  } catch { /* 내력 추출 실패해도 코드 파악은 진행 */ }

  let text = '';
  let cost = 0;

  for await (const m of query({
    prompt: `${PROMPT}\n\n---\n\n[작업 폴더]\n${project.workspace}\n\n[repo]\n${repoList}` +
            (gitBrief ? `\n\n---\n\n${gitBrief}` : ''),
    options: {
      systemPrompt: '당신은 낯선 코드베이스를 빠르게 파악하는 개발자입니다. 읽은 것만 근거로 씁니다.',
      cwd: project.workspace,
      allowedTools: ALLOWED,
      disallowedTools: BLOCKED,
      permissionMode: 'dontAsk',
      maxTurns: 30,
    },
  })) {
    if (signal.cancelled) break;
    if (m.type === 'assistant') {
      text += m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    } else if (m.type === 'result') {
      cost = m.total_cost_usd || 0;
    }
  }

  if (!text.trim()) return { cost, ok: false };

  // 모델이 앞에 붙이는 혼잣말("파일 4개 다 읽었다" 같은)은 문서에 넣지 않는다
  const firstHeading = text.indexOf('## ');
  const body = firstHeading > 0 ? text.slice(firstHeading) : text;

  const dir = path.join(orgDir(project), 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    notePath(project),
    `# 코드베이스 파악\n\n_${new Date().toISOString().slice(0, 16).replace('T', ' ')} 기준_\n\n${body.trim()}\n`
  );

  fs.mkdirSync(path.dirname(stampPath(project)), { recursive: true });
  fs.writeFileSync(
    stampPath(project),
    JSON.stringify({ fingerprint: fingerprint(repos), at: new Date().toISOString() }, null, 2)
  );

  return { cost, ok: true, text };
}

/** 팀에게 넘겨줄 요약 (프롬프트에 싣는다) */
export function codebaseBrief(project, limit = 4000) {
  try {
    const raw = fs.readFileSync(notePath(project), 'utf8');
    return `[기존 코드베이스]\n${raw.slice(0, limit)}`;
  } catch {
    return '';
  }
}
