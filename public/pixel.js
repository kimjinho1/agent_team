// 픽셀 아트 원시 함수들.
//
// 여기 있는 함수는 모두 첫 인자로 칠하기 함수 p(x, y, w, h, color) 를 받는다.
// 캔버스도, 앱 상태도 직접 건드리지 않는다 — 좌표와 색만 계산한다.
// 사무실을 실제로 조립하는 쪽(drawOffice)은 dashboard.html 에 남아 있다.
//
// 빌드 단계가 없으므로 브라우저가 이 파일을 그대로 읽는다. dashboard.html 의
// 인라인 스크립트보다 먼저 실행되어야 하므로 script 태그 순서를 바꾸지 말 것.

const ROLE_COLORS = {
  ceo: '#f0d24a', pm: '#6d7ff0', planner: '#a87bf0',
  researcher: '#7be0d0', designer: '#f06ba8',
  lead: '#e0645c', architect: '#e08a3c',
  fe: '#4aa8f0', be: '#3dc9a8', mobile: '#8ad46a',
  data: '#c98cf0', ml: '#f08ac9', devops: '#6ac9e0',
  security: '#d95f5f', qa: '#f0a23d', writer: '#9fb3c8',
};
const ROLE_INITIALS = {
  ceo: '사장', pm: 'PM', planner: '기획', researcher: '리서',
  designer: '디자', lead: '리드', architect: '아키', fe: 'FE', be: 'BE',
  mobile: '모바', data: '데이', ml: 'ML', devops: 'Ops',
  security: '보안', qa: 'QA', writer: '문서',
};
const LOOKS = {
  ceo: { hair: '#5a5a5a', hi: '#7c7c7c', style: 5 },
  pm: { hair: '#3a2a1c', hi: '#54402c', style: 0 },
  planner: { hair: '#7b4a2a', hi: '#96603a', style: 1 },
  researcher: { hair: '#2e4a3a', hi: '#456b55', style: 2 },
  designer: { hair: '#c9a227', hi: '#e3bc45', style: 2 },
  lead: { hair: '#2e2620', hi: '#463a30', style: 5 },
  architect: { hair: '#4a3520', hi: '#66492c', style: 0 },
  fe: { hair: '#151515', hi: '#2e2e2e', style: 4 },
  be: { hair: '#221a12', hi: '#3a2e22', style: 0 },
  mobile: { hair: '#3f5a2a', hi: '#557a3a', style: 1 },
  data: { hair: '#402a4a', hi: '#5a3e66', style: 2 },
  ml: { hair: '#5a2a40', hi: '#7a3a57', style: 1 },
  devops: { hair: '#1f3a44', hi: '#2f555f', style: 4 },
  security: { hair: '#1a1a1a', hi: '#333', style: 4 },
  qa: { hair: '#8b3a2f', hi: '#a8503f', style: 5 },
  writer: { hair: '#6a6a55', hi: '#8a8a70', style: 0 },
};
const FALLBACK_LOOK = { hair: '#3a2a1c', hi: '#54402c', style: 0 };
const ROLE_LOOK = {
  ceo: { hat: null, back: 'suit' },
  pm: { hat: null, back: 'suspenders' },
  planner: { hat: null, back: 'cardigan' },
  researcher: { hat: null, back: 'cardigan' },
  designer: { hat: 'beret', back: 'apron' },
  lead: { hat: null, back: 'vest' },
  architect: { hat: null, back: 'vest' },
  fe: { hat: 'hood', back: 'hoodie' },
  be: { hat: 'cap', back: 'plaid' },
  mobile: { hat: 'cap', back: 'hoodie' },
  data: { hat: null, back: 'plaid' },
  ml: { hat: null, back: 'coat' },
  devops: { hat: 'cap', back: 'plaid' },
  security: { hat: 'cap', back: 'coat' },
  qa: { hat: null, back: 'coat' },
  writer: { hat: null, back: 'cardigan' },
};

// 화면 전체가 쓰는 팔레트
const C = {
  wood: '#c9a273', woodHi: '#e2c79c', woodLo: '#a8824f', grain: '#bd9666', leg: '#7d5a32',
  floor: '#7d5233', floorHi: '#8d5f3c', floorLine: '#66401f',
  wall: '#2b3245', wallHi: '#39415a', wallLo: '#1b2130', base: '#232a3b',
  lounge: '#3d6d96', loungeHi: '#4a7ca8', loungeLine: '#34608a',
  skin: '#f0c9a0', skinSh: '#d5a87f',
  chair: '#5b8f45', chairHi: '#74a85c', chairLo: '#3d6a2e',
  shell: '#e6e9ef', shellSh: '#aeb5c1', bezel: '#cbd2dc',
  screenOn: '#14301e', screenOff: '#333c4a', code: '#7ef0a8',
  sheet: '#f4f2ea', sheetSh: '#d8d5c9',
};

const W = 500, H = 264;

// ---- rooms ----

function drawVignette(p) {
  for (let i = 0; i < 10; i++) {
    const a = `rgba(4,7,12,${0.05 + i * 0.012})`;
    p(0, i, W, 1, a); p(0, H - 1 - i, W, 1, a);
    p(i, 0, 1, H, a); p(W - 1 - i, 0, 1, H, a);
  }
}

function drawWorkRoom(p) {
  // wall
  p(8, 8, 296, 36, C.wall);
  dither(p, 8, 8, 296, 14, 'rgba(255,255,255,0.05)', 2);
  dither(p, 8, 30, 296, 8, 'rgba(0,0,0,0.16)', 2);
  p(8, 8, 296, 3, C.wallHi);
  p(8, 38, 296, 3, C.base);
  p(8, 41, 296, 3, C.wallLo);
  // wood floor, staggered planks
  p(8, 44, 296, 212, C.floor);
  for (let r = 0, y = 44; y < 256; y += 14, r++) {
    p(8, y, 296, 2, C.floorHi);
    p(8, y + 13, 296, 1, C.floorLine);
    const off = r % 2 ? 24 : 0;
    for (let x = 8 + off; x < 304; x += 48) p(x, y, 1, 13, C.floorLine);
  }
  // ceiling lamps, each dropping a pool of light on the floor
  [54, 154, 254].forEach((lx) => {
    p(lx - 10, 8, 20, 3, '#3c465e');
    p(lx - 7, 11, 14, 3, '#e8e2c8');
    p(lx - 5, 14, 10, 1, 'rgba(255,240,190,0.55)');
  });
  [56, 112, 168].forEach((ry, ri) => {
    [54, 154, 254].forEach((lx) => lightPool(p, lx, ry + 30, 44, 26, '255,232,170'));
  });
  drawBookshelf(p, 22, 13);
  drawBookshelf(p, 130, 13);
  drawBookshelf(p, 238, 13);
  drawClock(p, 100, 24);
  drawPlant(p, 276, 228);
  drawBin(p, 120, 232);
  drawCooler(p, 278, 48);
}

function drawLounge(p) {
  p(316, 8, 180, 36, C.wall);
  dither(p, 316, 8, 180, 14, 'rgba(255,255,255,0.05)', 2);
  dither(p, 316, 30, 180, 8, 'rgba(0,0,0,0.16)', 2);
  p(316, 8, 180, 3, C.wallHi);
  p(316, 38, 180, 3, C.base);
  p(316, 41, 180, 3, C.wallLo);
  p(316, 44, 180, 212, C.lounge);
  for (let y = 44; y < 256; y += 16) {
    p(316, y, 180, 1, C.loungeHi);
    p(316, y + 15, 180, 1, C.loungeLine);
  }
  // checkerboard strip near the door
  for (let x = 316; x < 496; x += 8) {
    for (let y = 240; y < 256; y += 8) {
      const on = ((x / 8) + (y / 8)) % 2 === 0;
      p(x, y, 8, 8, on ? '#e8ecf2' : '#232a3b');
    }
  }
  lightPool(p, 406, 120, 74, 90, '150,200,255');
  dither(p, 316, 44, 180, 30, 'rgba(255,255,255,0.05)', 4);
  drawArt(p, 350, 14, '#c9a227', '#7a5f12');
  drawArt(p, 396, 14, '#7fb069', '#3f6b30');
  drawArt(p, 442, 14, '#c96f6f', '#7d3a3a');
  drawPlant(p, 470, 226);
}

function drawBookshelf(p, x, y) {
  p(x, y, 50, 24, '#6d4520');
  p(x, y, 50, 2, '#8b5a2b');
  p(x + 1, y + 2, 48, 9, '#4e3117');
  p(x + 1, y + 13, 48, 9, '#4e3117');
  const books = ['#d94f4f', '#e2c044', '#5b9bd5', '#7fb069', '#b07fd5', '#e08a3c', '#4fc3d9'];
  for (let shelf = 0; shelf < 2; shelf++) {
    const by = y + 2 + shelf * 11;
    let bx = x + 2;
    let k = shelf * 3;
    while (bx < x + 47) {
      const w = 2 + (k % 3);
      const h = 7 + (k % 3);
      p(bx, by + (9 - h), w, h, books[k % books.length]);
      p(bx, by + (9 - h), w, 1, '#ffffff33');
      bx += w + 1;
      k++;
    }
  }
  p(x, y + 24, 50, 2, '#3a2412');
}

function drawClock(p, cx, cy) {
  disc(p, cx, cy, 9, '#1d2231');
  disc(p, cx, cy, 8, '#c0392b');
  disc(p, cx, cy, 6, '#f4f6fa');
  p(cx - 1, cy - 7, 2, 1, '#8a93a5');
  p(cx - 1, cy + 6, 2, 1, '#8a93a5');
  p(cx - 7, cy - 1, 1, 2, '#8a93a5');
  p(cx + 6, cy - 1, 1, 2, '#8a93a5');
  p(cx, cy - 4, 1, 4, '#2b3140');
  p(cx, cy, 4, 1, '#5c6578');
  p(cx, cy, 1, 1, '#1d2231');
}

function drawArt(p, x, y, inner, shade) {
  p(x, y, 20, 18, '#8b5a2b');
  p(x, y, 20, 2, '#a8703a');
  p(x + 2, y + 2, 16, 14, inner);
  p(x + 2, y + 10, 16, 6, shade);
  p(x + 5, y + 5, 4, 4, '#ffffff66');
  p(x + 2, y + 16, 16, 2, '#00000033');
}

function drawPlant(p, x, y) {
  // pot
  p(x + 4, y + 16, 14, 12, '#b5651d');
  p(x + 4, y + 16, 14, 3, '#d07c2c');
  p(x + 4, y + 25, 14, 3, '#8a4a14');
  p(x + 6, y + 19, 10, 2, '#3a2a12');
  // leaves
  p(x + 9, y + 6, 4, 11, '#2f7d32');
  p(x + 2, y + 9, 7, 4, '#3f9a42');
  p(x + 1, y + 12, 5, 3, '#2f7d32');
  p(x + 13, y + 7, 7, 4, '#4caf50');
  p(x + 15, y + 11, 5, 3, '#3f9a42');
  p(x + 8, y + 1, 5, 6, '#4caf50');
  p(x + 10, y + 2, 2, 4, '#6fcf73');
}

function drawBin(p, x, y) {
  p(x, y + 3, 12, 14, '#5a6272');
  p(x, y + 3, 12, 2, '#79839a');
  p(x + 3, y + 6, 1, 9, '#4a5160');
  p(x + 7, y + 6, 1, 9, '#4a5160');
  p(x - 1, y, 14, 3, '#79839a');
}

function drawCooler(p, x, y) {
  p(x + 2, y + 8, 14, 22, '#c8d2de');
  p(x + 2, y + 8, 14, 2, '#e6ecf3');
  p(x + 4, y, 10, 9, '#6fb7dd');
  p(x + 5, y + 1, 8, 7, '#9ad6f0');
  p(x + 5, y + 14, 8, 4, '#8a93a5');
  p(x + 2, y + 26, 14, 4, '#98a3b3');
}

// ---- desk ----

function drawDesk(p, x, y, working, t, roleKey) {
  const blink = Math.floor(t / 4) % 2;
  p(x + 2, y + 26, 76, 3, '#00000026');
  p(x, y, 76, 22, C.wood);
  p(x, y, 76, 2, C.woodHi);
  p(x, y + 20, 76, 2, C.woodLo);
  for (let i = 0; i < 3; i++) p(x + 5, y + 6 + i * 5, 66, 1, C.grain);
  p(x, y + 22, 76, 4, '#9b7746');
  p(x + 4, y + 26, 5, 7, C.leg);
  p(x + 67, y + 26, 5, 7, C.leg);

  drawMonitor(p, x + 24, y + 1, working, t);
  p(x + 24, y + 16, 22, 5, '#b9c0cb');
  p(x + 24, y + 16, 22, 1, '#d7dce4');
  for (let k = 0; k < 7; k++) {
    const lit = working && (Math.floor(t / 3) + k) % 7 === 0;
    p(x + 26 + k * 3, y + 18, 2, 1, lit ? '#ffd23d' : '#78808f');
  }
  p(x + 48, y + 17, 5, 4, '#cdd3dc');
  p(x + 50, y + 18, 1, 2, '#8a93a5');

  drawRoleProps(p, x, y, roleKey, working, t, blink);
}

// each desk is dressed for the job it belongs to
function drawRoleProps(p, x, y, roleKey, working, t, blink) {
  switch (roleKey) {
    case 'pm': { // clipboard, gantt-ish chart, coffee
      p(x + 4, y + 4, 13, 16, '#b07a3c');
      p(x + 5, y + 5, 11, 14, C.sheet);
      p(x + 8, y + 3, 5, 3, '#8a93a5');
      for (let i = 0; i < 4; i++) {
        p(x + 6, y + 8 + i * 3, 2, 2, '#d94f4f');
        p(x + 9, y + 8 + i * 3, 2 + i, 2, '#5b9bd5');
      }
      drawMug(p, x + 60, y + 9, working, blink);
      break;
    }
    case 'planner': { // stacked specs, sticky notes, pen
      p(x + 5, y + 10, 14, 10, C.sheetSh);
      p(x + 4, y + 7, 14, 10, C.sheet);
      for (let i = 0; i < 3; i++) p(x + 6, y + 9 + i * 3, 10, 1, '#a9a599');
      p(x + 56, y + 3, 8, 8, '#ffe066');
      p(x + 56, y + 3, 8, 1, '#fff3a8');
      p(x + 64, y + 6, 7, 7, '#ff9de0');
      p(x + 58, y + 14, 12, 2, '#3a4252');
      p(x + 68, y + 14, 3, 2, '#d94f4f');
      break;
    }
    case 'designer': { // drawing tablet, stylus, colour swatches
      p(x + 3, y + 5, 18, 14, '#3a4252');
      p(x + 4, y + 6, 16, 12, '#586275');
      p(x + 6, y + 8, 12, 8, working ? '#f06ba8' : '#6b7486');
      if (working) { p(x + 7, y + 10 + (blink ? 0 : 1), 6, 1, '#ffd6ea'); p(x + 11, y + 13, 5, 1, '#ffd6ea'); }
      p(x + 21, y + 3, 2, 12, '#c9ced8');
      p(x + 21, y + 14, 2, 3, '#3a4252');
      const sw = ['#d94f4f', '#e2c044', '#5b9bd5', '#7fb069', '#b07fd5'];
      sw.forEach((c, i) => p(x + 56 + i * 3, y + 6, 3, 6, c));
      p(x + 56, y + 13, 15, 1, '#8a7a5c');
      break;
    }
    case 'fe': { // laptop, headphones, energy drink
      p(x + 3, y + 8, 17, 11, '#c9ced8');
      p(x + 4, y + 9, 15, 9, '#2b3245');
      if (working) {
        p(x + 5, y + 10 + (blink ? 0 : 1), 7, 1, '#7ef0a8');
        p(x + 5, y + 13, 10, 1, '#4fd0e0');
        p(x + 5, y + 15, 5, 1, '#7ef0a8');
      }
      p(x + 3, y + 19, 17, 2, '#aeb5c1');
      p(x + 56, y + 4, 3, 10, '#2b3245');   // headphones
      p(x + 68, y + 4, 3, 10, '#2b3245');
      p(x + 56, y + 2, 15, 3, '#3a4252');
      p(x + 55, y + 8, 5, 5, '#4aa8f0');
      p(x + 67, y + 8, 5, 5, '#4aa8f0');
      p(x + 62, y + 14, 5, 7, '#7fb069'); // can
      p(x + 62, y + 14, 5, 2, '#a8d98a');
      break;
    }
    case 'be': { // mini server rack, terminal readout, cables
      p(x + 3, y + 2, 15, 18, '#2b3245');
      p(x + 4, y + 3, 13, 16, '#3a4252');
      for (let i = 0; i < 4; i++) {
        p(x + 5, y + 4 + i * 4, 11, 3, '#232a38');
        const on = working && (Math.floor(t / 4) + i) % 4 === 0;
        p(x + 6, y + 5 + i * 4, 1, 1, on ? '#7ef0a8' : '#2f7d4f');
        p(x + 8, y + 5 + i * 4, 1, 1, i % 2 ? '#ffb14a' : '#3a4252');
      }
      p(x + 18, y + 16, 6, 1, '#4a5362');
      p(x + 20, y + 17, 8, 1, '#4a5362');
      drawMug(p, x + 62, y + 10, working, blink);
      break;
    }
    case 'lead': { // architecture board: boxes wired together + schema doc
      p(x + 3, y + 3, 20, 17, '#e8ecf2');
      p(x + 3, y + 3, 20, 2, '#b9c0cb');
      p(x + 5, y + 7, 6, 4, '#4aa8f0');
      p(x + 15, y + 7, 6, 4, '#3dc9a8');
      p(x + 10, y + 16, 7, 4, '#e0645c');
      p(x + 11, y + 9, 4, 1, '#3a4252');
      p(x + 8, y + 11, 1, 5, '#3a4252');
      p(x + 17, y + 11, 1, 5, '#3a4252');
      p(x + 9, y + 16, 2, 1, '#3a4252');
      p(x + 16, y + 16, 2, 1, '#3a4252');
      p(x + 56, y + 5, 14, 14, C.sheet);
      for (let i = 0; i < 4; i++) p(x + 58, y + 8 + i * 3, 10, 1, '#a9a599');
      p(x + 58, y + 5, 10, 2, '#e0645c');
      break;
    }
    case 'qa': { // checklist with pass/fail marks, magnifier, red pen
      p(x + 4, y + 4, 14, 16, C.sheet);
      p(x + 4, y + 4, 14, 2, '#d8d5c9');
      for (let i = 0; i < 4; i++) {
        p(x + 6, y + 8 + i * 3, 2, 2, i < 3 ? '#2e9e5b' : '#d94f4f');
        p(x + 9, y + 9 + i * 3, 7, 1, '#a9a599');
      }
      disc(p, x + 62, y + 8, 5, '#c9ced8');   // magnifier
      disc(p, x + 62, y + 8, 3, working ? '#bfe6ff' : '#8a93a5');
      p(x + 65, y + 11, 5, 5, '#6b4a2a');
      p(x + 56, y + 16, 10, 2, '#d94f4f');
      break;
    }
    default:
      drawPapers(p, x + 6, y + 7);
  }
}

function drawMonitor(p, x, y, working, t) {
  const f = Math.floor(t / 4) % 2;
  const scan = Math.floor(t / 2) % 8;
  p(x - 1, y + 13, 20, 2, '#00000022');
  p(x, y, 26, 15, C.shell);
  p(x, y, 26, 2, '#f4f6fa');
  p(x + 24, y, 2, 15, C.shellSh);
  p(x, y + 13, 26, 2, C.shellSh);
  p(x + 2, y + 2, 22, 10, C.bezel);
  p(x + 3, y + 3, 20, 8, working ? C.screenOn : C.screenOff);
  if (working) {
    const r = f ? 0 : 1;
    p(x + 4, y + 4 + r, 11, 1, C.code);
    p(x + 4, y + 6, 15, 1, C.code);
    p(x + 4, y + 8 - r, 8, 1, C.code);
    p(x + 16, y + 8 - r, 5, 1, '#4fd0e0');
    p(x + 4, y + 10, 13, 1, '#4fd0e0');
    p(x + 3, y + 3 + scan, 20, 1, '#ffffff14');
  } else {
    p(x + 4, y + 4, 6, 1, '#454f5e');
    p(x + 4, y + 6, 9, 1, '#3d4654');
  }
  p(x + 10, y + 15, 6, 3, C.shellSh);
  p(x + 7, y + 18, 12, 2, '#9aa3b0');
}

function drawMug(p, x, y, hot, f) {
  p(x, y + 2, 8, 8, '#e8ecf2');
  p(x, y + 2, 8, 2, '#ffffff');
  p(x + 1, y + 4, 6, 3, '#6b4a2a');
  p(x + 8, y + 4, 2, 4, '#c8d0da');
  if (hot) {
    p(x + 2, y - 2 - (f ? 1 : 0), 1, 3, '#ffffff55');
    p(x + 5, y - 4 + (f ? 1 : 0), 1, 3, '#ffffff44');
  }
}

function drawPapers(p, x, y) {
  p(x + 1, y + 1, 11, 9, C.sheetSh);
  p(x, y, 11, 9, C.sheet);
  for (let i = 0; i < 3; i++) p(x + 2, y + 2 + i * 2, 7, 1, '#a9a599');
}

// ---- characters ----

function drawWorker(p, cx, cy, look, role, roleKey, t) {
  const rl = ROLE_LOOK[roleKey] || { hat: null, back: null };
  const type = Math.floor(t / 3) % 4;          // 4-frame typing cycle
  const lift = [0, 1, 0, 1][type];
  const lArm = [0, 1, 1, 0][type];
  const rArm = [1, 0, 0, 1][type];
  const breathe = Math.floor(t / 14) % 2;
  const bob = lift || breathe;

  // chair: padded seat, armrests, gas lift, star base
  p(cx - 6, cy + 11, 6, 14, C.chairLo);
  p(cx + 22, cy + 11, 6, 14, C.chairLo);
  p(cx - 6, cy + 11, 6, 2, C.chairHi);
  p(cx + 22, cy + 11, 6, 2, C.chairHi);
  p(cx - 2, cy + 13, 26, 16, C.chair);
  p(cx - 2, cy + 13, 26, 2, C.chairHi);
  p(cx - 2, cy + 27, 26, 2, C.chairLo);
  p(cx + 2, cy + 16, 18, 1, C.chairLo);
  p(cx + 9, cy + 29, 4, 6, '#454c5a');
  p(cx + 3, cy + 35, 16, 3, '#3a4150');
  p(cx + 1, cy + 37, 4, 2, '#2e3440');
  p(cx + 17, cy + 37, 4, 2, '#2e3440');

  const bodyY = cy + 7 + bob;
  const dark = shade(role, 0.62);

  // silhouette outline, then torso with light from the monitor
  p(cx, bodyY - 1, 22, 17, dark);
  p(cx + 1, bodyY, 20, 15, role);
  p(cx + 1, bodyY, 20, 2, shade(role, 1.22));
  p(cx + 17, bodyY, 4, 15, shade(role, 0.82));
  p(cx + 1, bodyY, 2, 15, shade(role, 1.08));

  // back-of-outfit detail per profession
  if (rl.back === 'suspenders') {
    p(cx + 5, bodyY, 2, 15, '#2b3245');
    p(cx + 15, bodyY, 2, 15, '#2b3245');
    p(cx + 5, bodyY + 7, 12, 2, '#2b3245');
    p(cx + 1, bodyY, 20, 2, '#f4f6fa');
  } else if (rl.back === 'apron') {
    p(cx + 4, bodyY + 1, 2, 13, '#f4f0e6');
    p(cx + 16, bodyY + 1, 2, 13, '#f4f0e6');
    for (let i = 0; i < 7; i++) p(cx + 6 + i, bodyY + 3 + i, 2, 1, '#f4f0e6');
    for (let i = 0; i < 7; i++) p(cx + 16 - i, bodyY + 3 + i, 2, 1, '#f4f0e6');
  } else if (rl.back === 'hoodie') {
    p(cx, bodyY + 1, 22, 6, shade(role, 0.78));   // hood bunched at the neck
    p(cx + 1, bodyY + 1, 20, 2, shade(role, 0.9));
    p(cx + 8, bodyY + 7, 2, 6, '#f4f6fa');
    p(cx + 13, bodyY + 7, 2, 5, '#f4f6fa');
    p(cx + 1, bodyY + 12, 20, 3, shade(role, 0.86));
  } else if (rl.back === 'plaid') {
    for (let i = 0; i < 4; i++) p(cx + 3 + i * 5, bodyY, 1, 15, shade(role, 0.72));
    for (let j = 0; j < 4; j++) p(cx + 1, bodyY + 2 + j * 4, 20, 1, shade(role, 0.72));
  } else if (rl.back === 'coat') {
    p(cx + 10, bodyY, 2, 15, '#c3c9d4');          // coat seam
    p(cx + 2, bodyY + 10, 5, 4, '#dfe4ec');
    p(cx + 15, bodyY + 10, 5, 4, '#dfe4ec');
  } else if (rl.back === 'vest') {
    p(cx + 1, bodyY, 20, 3, '#f4f6fa');
    p(cx + 3, bodyY + 3, 16, 12, shade(role, 0.7));
    p(cx + 3, bodyY + 3, 16, 1, shade(role, 0.85));
    p(cx + 9, bodyY, 2, 8, '#2b3245');
    p(cx + 9, bodyY + 8, 4, 3, '#c9ced8');
  } else if (rl.back === 'suit') {
    p(cx + 1, bodyY, 20, 15, '#2b3245');
    p(cx + 1, bodyY, 20, 2, '#3f4a63');
    p(cx + 8, bodyY, 6, 4, '#f4f6fa');
    p(cx + 10, bodyY + 3, 2, 7, role);
  } else if (rl.back === 'cardigan') {
    p(cx + 10, bodyY, 2, 15, shade(role, 0.75));
    p(cx + 1, bodyY + 13, 20, 2, shade(role, 0.7));
  }

  // arms out to the keyboard, alternating on the typing cycle
  p(cx - 3, cy + 3 + lArm, 6, 13, dark);
  p(cx + 19, cy + 3 + rArm, 6, 13, dark);
  p(cx - 2, cy + 3 + lArm, 5, 12, role);
  p(cx + 19, cy + 3 + rArm, 5, 12, role);
  p(cx - 2, cy + 1 + lArm, 5, 4, C.skin);
  p(cx + 19, cy + 1 + rArm, 5, 4, C.skin);
  p(cx - 2, cy + 1 + lArm, 5, 1, '#ffe0c0');
  p(cx + 19, cy + 1 + rArm, 5, 1, '#ffe0c0');

  // light from the monitor catches the top of the shoulders
  p(cx + 1, bodyY, 20, 1, 'rgba(255,226,160,0.5)');
  dither(p, cx + 1, bodyY + 1, 20, 4, 'rgba(255,214,120,0.16)', 2);
  dither(p, cx + 1, bodyY + 10, 20, 5, 'rgba(0,0,0,0.18)', 2);

  // head
  const hx = cx + 4, hy = cy - 5 + bob;
  p(hx - 1, hy + 1, 16, 15, '#00000033');
  p(hx, hy + 2, 14, 12, C.skin);
  p(hx, hy + 12, 14, 2, C.skinSh);
  p(hx - 1, hy + 6, 2, 4, C.skinSh);
  p(hx + 13, hy + 6, 2, 4, C.skinSh);
  drawHair(p, hx, hy, rl.hat && rl.hat !== 'beret' ? { ...look, style: 0 } : look);
  dither(p, hx, hy, 14, 3, 'rgba(255,226,170,0.28)', 2);   // sheen on the hair
  dither(p, hx, hy + 9, 14, 4, 'rgba(0,0,0,0.20)', 2);
  if (rl.hat) drawHat(p, hx, hy, rl.hat, role);
  p(cx + 5, cy + 7 + bob, 12, 2, C.skinSh);
}

function drawHair(p, hx, hy, look) {
  const h = look.hair, hi = look.hi, lo = shade(h, 0.7);
  switch (look.style) {
    case 0:
      p(hx, hy, 14, 8, h); p(hx + 2, hy + 1, 6, 2, hi); p(hx, hy + 7, 14, 1, lo);
      p(hx, hy + 8, 2, 4, h); p(hx + 12, hy + 8, 2, 4, h);
      break;
    case 1:
      p(hx, hy, 14, 8, h); p(hx + 3, hy + 1, 6, 2, hi);
      p(hx - 2, hy + 6, 4, 17, h); p(hx + 12, hy + 6, 4, 17, h);
      p(hx - 2, hy + 6, 1, 15, hi); p(hx - 2, hy + 21, 4, 2, lo); p(hx + 12, hy + 21, 4, 2, lo);
      break;
    case 2:
      p(hx, hy, 14, 7, h); p(hx + 3, hy + 1, 5, 2, hi);
      disc(p, hx + 7, hy - 5, 5, h); disc(p, hx + 6, hy - 6, 2, hi);
      p(hx + 4, hy - 1, 7, 1, lo);
      p(hx, hy + 7, 2, 3, h); p(hx + 12, hy + 7, 2, 3, h);
      break;
    case 3:
      disc(p, hx + 7, hy + 3, 10, lo); disc(p, hx + 7, hy + 3, 9, h);
      disc(p, hx + 4, hy, 3, hi); p(hx, hy + 6, 14, 6, h);
      break;
    case 4:
      p(hx + 1, hy + 1, 12, 5, h); p(hx + 3, hy + 2, 5, 1, hi); p(hx + 1, hy + 6, 12, 1, lo);
      break;
    case 5:
      p(hx, hy, 14, 7, h); p(hx, hy, 5, 10, h); p(hx + 1, hy + 1, 2, 6, hi);
      p(hx + 12, hy + 7, 2, 3, h); p(hx, hy + 7, 14, 1, lo);
      break;
  }
}

function drawHat(p, hx, hy, kind, role) {
  if (kind === 'beret') {
    p(hx - 1, hy - 4, 16, 6, '#1f2530');
    p(hx, hy - 3, 14, 5, '#c0392b');
    p(hx + 2, hy - 2, 5, 2, '#d9584a');
    p(hx + 11, hy - 6, 3, 3, '#8f2a20');
    p(hx - 1, hy + 1, 16, 1, '#8f2a20');
  } else if (kind === 'hood') {
    const d = shade(role, 0.62), m = shade(role, 0.8), l = shade(role, 0.95);
    p(hx - 5, hy - 5, 24, 6, d);      // hood crown
    p(hx - 5, hy - 5, 6, 20, d);      // left side
    p(hx + 13, hy - 5, 6, 20, d);     // right side
    p(hx - 4, hy - 4, 22, 2, l);
    p(hx - 4, hy + 1, 4, 17, m);
    p(hx + 14, hy + 1, 4, 17, m);
    p(hx, hy, 14, 2, '#00000055');    // shadow under the hood opening
  } else if (kind === 'cap') {
    p(hx - 1, hy - 3, 16, 6, '#1f2530');
    p(hx, hy - 2, 14, 5, '#2f4858');
    p(hx + 1, hy - 1, 5, 2, '#3f5c70');
    p(hx - 3, hy + 2, 5, 2, '#263a47');
  }
}

function drawSleeper(p, x, y, look, role, roleKey, t) {
  const breathe = Math.floor(t / 16) % 2;
  const hx = x + 17, hy = y + 3;
  const h = look.hair, hi = look.hi;
  // hair framing the face (lying face-up)
  p(hx - 1, hy - 3, 17, 5, h);
  p(hx + 2, hy - 2, 6, 2, hi);
  p(hx - 2, hy + 1, 3, 10, h);
  p(hx + 14, hy + 1, 3, 10, h);
  if (look.style === 1) { p(hx - 4, hy + 6, 3, 9, h); p(hx + 16, hy + 6, 3, 9, h); }
  if (look.style === 2) { p(hx + 5, hy - 7, 7, 5, h); p(hx + 6, hy - 6, 3, 2, hi); }
  if (look.style === 3) { p(hx - 4, hy - 4, 4, 12, h); p(hx + 15, hy - 4, 4, 12, h); p(hx - 1, hy - 5, 17, 3, h); }
  // face
  p(hx + 1, hy, 13, 13, C.skin);
  p(hx + 1, hy + 11, 13, 2, C.skinSh);
  p(hx + 3, hy + 6, 3, 1, '#3a2a1c');
  p(hx + 9, hy + 6, 3, 1, '#3a2a1c');
  p(hx + 6, hy + 9, 3, 1, '#c98d78');
  p(hx + 1, hy + 7, 2, 2, '#e8a98f');
  p(hx + 12, hy + 7, 2, 2, '#e8a98f');
  // shoulders (blanket is drawn over them afterwards)
  p(x + 10, y + 15 - breathe, 28, 9 + breathe, shade(role, 0.62));
  p(x + 11, y + 16 - breathe, 26, 8 + breathe, role);
  p(x + 11, y + 16 - breathe, 26, 2, shade(role, 1.15));
}

// drawn after the blanket so the arms rest on top of it
function drawSleeperArms(p, x, y, role) {
  p(x + 4, y + 21, 6, 8, role);
  p(x + 38, y + 21, 6, 8, role);
  p(x + 4, y + 21, 6, 1, shade(role, 1.15));
  p(x + 38, y + 21, 6, 1, shade(role, 1.15));
  p(x + 4, y + 27, 6, 4, C.skin);
  p(x + 38, y + 27, 6, 4, C.skin);
}

// ---- bed ----

function drawCotBase(p, x, y) {
  p(x + 3, y + 30, 46, 3, '#00000026');
  p(x, y, 48, 32, '#8b4a2b');
  p(x, y, 48, 3, '#a75f38');
  p(x + 2, y + 3, 44, 27, '#efe9db');
  p(x + 2, y + 3, 44, 2, '#ffffff');
  p(x + 11, y + 1, 26, 12, '#ffffff');
  p(x + 11, y + 11, 26, 2, '#d8d4c8');
  p(x, y + 32, 4, 5, '#6f3a20');
  p(x + 44, y + 32, 4, 5, '#6f3a20');
}

function drawBlanket(p, x, y, occupied) {
  const bl = occupied ? '#4f74c8' : '#8ea4cc';
  p(x + 2, y + 21, 44, 9, bl);
  p(x + 2, y + 21, 44, 2, occupied ? '#6d8cd8' : '#a6b8d8');
  p(x + 2, y + 25, 44, 1, occupied ? '#4263ad' : '#7e94bd');
  p(x + 2, y + 28, 44, 1, occupied ? '#4263ad' : '#7e94bd');
}

// ---- fx ----

// three z's drifting up and fading, on a smooth loop
function drawFloatZ(p, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const phase = ((t + i * 16) % 48) / 48;
    const zy = y - phase * 22;
    const zx = x + Math.round(Math.sin(phase * 6.283) * 3) + i;
    const size = 7 - i;
    const fade = phase > 0.75 ? '#ffffff44' : (i === 0 ? '#c3d0e0' : '#e2e9f2');
    drawZ(p, zx, zy, size, fade);
  }
}

function drawZ(p, x, y, s, c) {
  const u = Math.max(1, Math.round(s / 4));
  p(x, y, s, u, c);
  p(x + s - 2 * u, y + u, u, u, c);
  p(x + u, y + 2 * u, u, u, c);
  p(x, y + 3 * u, s, u, c);
}
function drawCheck(p, x, y, c) {
  p(x, y + 5, 2, 3, c); p(x + 2, y + 7, 2, 3, c); p(x + 4, y + 5, 2, 3, c);
  p(x + 6, y + 2, 2, 3, c); p(x + 8, y - 1, 2, 3, c);
}
function drawBang(p, x, y, c) { p(x, y, 3, 8, c); p(x, y + 10, 3, 3, c); }

// checkerboard dither: classic way to fake a gradient step in pixel art
function dither(p, x, y, w, h, c, density) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const on = density === 2
        ? ((dx + dy) % 2 === 0)
        : density === 4
          ? ((dx % 2 === 0) && (dy % 2 === 0))
          : ((dx + dy) % 2 === 0) || (dx % 2 === 0 && dy % 2 === 0);
      if (on) p(x + dx, y + dy, 1, 1, c);
    }
  }
}

// soft pool of light, built from concentric dithered rings
function lightPool(p, cx, cy, rx, ry, rgb) {
  for (let i = 3; i >= 1; i--) {
    const fx = rx * (i / 3), fy = ry * (i / 3);
    const alpha = 0.05 + (3 - i) * 0.045;
    for (let dy = -fy; dy <= fy; dy++) {
      const span = Math.floor(fx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (fy * fy))));
      if (span <= 0) continue;
      const y = Math.round(cy + dy);
      if (i === 3) dither(p, Math.round(cx - span), y, span * 2, 1, `rgba(${rgb},${alpha + 0.02})`, 2);
      else p(Math.round(cx - span), y, span * 2, 1, `rgba(${rgb},${alpha})`);
    }
  }
}

function disc(p, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    p(cx - half, cy + dy, half * 2 + 1, 1, c);
  }
}

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((n >> 16) & 255) * factor);
  const g = cl(((n >> 8) & 255) * factor);
  const b = cl((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}
function drawPortrait(roleKey) { drawPortraitOn('portrait', roleKey); }

function drawPortraitOn(canvasId, roleKey) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const p = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const W0 = cv.width, H0 = cv.height;
  p(0, 0, W0, H0, '#20283a');
  p(0, H0 - 18, W0, 18, '#2b3550');
  dither(p, 0, H0 - 24, W0, 8, 'rgba(255,255,255,0.05)', 2);
  const look = LOOKS[roleKey] || FALLBACK_LOOK;
  drawWorker(p, Math.round(W0 / 2) - 11, H0 - 40, look, ROLE_COLORS[roleKey] || '#8b7bff', roleKey, 0);
}
