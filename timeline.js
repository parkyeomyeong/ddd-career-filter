// 왼쪽 세로 타임라인 (원조 필터 프레임 분석 기준).
// 노란 점(테두리 없음)이 일정한 속도로 내려간다. 점이 노드를 지나면 노드가 노란색으로 채워지고 값이 뜬다.
// 지나갈 때 점과 노드가 물방울처럼 늘어났다 떨어진다. 선은 첫 노드~마지막 노드 사이에만.
export const STEP_MS = 4000; // 노드 사이 이동 시간 = 값 공개 간격
export const HOLD_MS = 3000; // 마지막 값 공개 후 리액션 여유
const INTRO_MS = 1500; // 시작: 점이 첫 노드 위에서 천천히 나타나는 시간 (이동 없음)
const POP_MS = 350; // 점이 노드를 지날 때 살짝 커졌다 돌아오는 시간
const POP_SCALE = 0.3; // 최대 30% 커짐

const LINE_X = 210;
const NODE_GAP = 300;
const FIRST_Y = 380;
const FOCUS_Y = 560; // 움직이는 점이 이 높이를 넘으면 목록이 위로 스크롤
const NODE_R = 26;
const DOT_R = 30;
const STRETCH = 2.4; // 노드-점 거리가 NODE_R * STRETCH 보다 가까우면 물방울 연결
const FADE_MS = 200;
const YELLOW = '#ffd400';
const GRAY = '#8a8a8a';

const clamp01 = (t) => Math.min(1, Math.max(0, t));

// 첫 노드는 페이드인이 끝나는 순간 공개, 이후 STEP_MS 간격
export const revealTime = (i) => INTRO_MS + i * STEP_MS;

// elapsed(ms) → 점 위치(노드 단위), 공개된 개수, 종료 여부
export function progress(elapsedMs, count) {
  const position = Math.min(Math.max(0, elapsedMs - INTRO_MS) / STEP_MS, count - 1);
  let revealed = 0;
  while (revealed < count && revealTime(revealed) <= elapsedMs) revealed++;
  const done = elapsedMs >= revealTime(count - 1) + HOLD_MS;
  return { position, revealed, done };
}

function circle(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

// 지나간 노드와 점 사이를 잇는 목: 가까울수록 굵고, 멀어지면 가늘어지다 끊긴다.
function drawNeck(ctx, nodeY, dotY) {
  const d = dotY - nodeY;
  const max = NODE_R * STRETCH;
  if (d <= 0 || d >= max) return;
  const w = NODE_R * 2 * (1 - d / max) ** 0.7;
  ctx.fillStyle = YELLOW;
  ctx.fillRect(LINE_X - w / 2, nodeY, w, d);
}

function fitFont(ctx, text, maxWidth, size) {
  let s = size;
  do {
    ctx.font = `700 ${s}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
  } while (ctx.measureText(text).width > maxWidth && --s > 20);
}

// 흰 글씨 + 얇은 검정 테두리
function outlinedText(ctx, text, x, y) {
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

// 0 → 1 → 0 로 부풀었다 돌아오는 비율
const popScale = (age) => (age < 0 || age > POP_MS ? 1 : 1 + POP_SCALE * Math.sin((Math.PI * age) / POP_MS));

export function drawTimeline(ctx, categories, picks, elapsedMs) {
  const { width, height } = ctx.canvas;
  const { position, revealed } = progress(elapsedMs, categories.length);
  const dotY = FIRST_Y + position * NODE_GAP;
  const offset = Math.max(0, dotY - FOCUS_Y);
  const y = (i) => FIRST_Y + i * NODE_GAP - offset;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;

  const top = y(0);
  const bottom = y(categories.length - 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(LINE_X - 3, top, 6, bottom - top);

  categories.forEach((c, i) => {
    const ny = y(i);
    if (ny < -NODE_R * 3 || ny > height + NODE_R * 3) return;
    const shown = i < revealed;
    const age = elapsedMs - revealTime(i);
    circle(ctx, LINE_X, ny, NODE_R, shown ? YELLOW : GRAY, true);

    ctx.save();
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    fitFont(ctx, c.name, LINE_X - 50, 36);
    outlinedText(ctx, c.name, LINE_X - 44, ny);

    if (shown) {
      ctx.globalAlpha = clamp01(age / FADE_MS);
      ctx.textAlign = 'left';
      fitFont(ctx, picks[i], width - LINE_X - 80, 48);
      outlinedText(ctx, picks[i], LINE_X + 50, ny);
    }
    ctx.restore();
  });

  ctx.shadowBlur = 0;
  if (elapsedMs >= 0) {
    // 대기 중엔 점 없음. 시작하면 첫 노드 위에서 천천히 페이드인.
    ctx.globalAlpha = clamp01(elapsedMs / INTRO_MS);
    if (revealed > 0) drawNeck(ctx, y(revealed - 1), dotY - offset);
    const lastAge = revealed > 0 ? elapsedMs - revealTime(revealed - 1) : -1;
    circle(ctx, LINE_X, dotY - offset, DOT_R * popScale(lastAge), YELLOW, false);
  }
  ctx.restore();
}
