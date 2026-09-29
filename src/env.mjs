// .env 를 읽어 process.env 에 넣는다. dotenv/config 가 하던 일이고,
// Node 20.12+ 의 process.loadEnvFile 이 같은 일을 내장으로 한다 —
// 이미 있는 환경변수는 덮어쓰지 않아 우선순위도 같다.
//
// 함수가 아니라 모듈 본문으로 둔 이유: ES 모듈은 본문보다 import 가 먼저
// 평가되므로, 이걸 맨 위에서 import 해야 뒤따르는 모듈들이 평가될 때
// 환경변수가 이미 준비돼 있다.
try {
  process.loadEnvFile();          // 실행한 폴더의 .env
} catch { /* 없으면 넘긴다 — dotenv 도 조용히 넘겼다 */ }
