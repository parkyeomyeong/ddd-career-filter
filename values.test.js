import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseValues, pickRandom } from './values.js';
import { progress, revealTime, STEP_MS, HOLD_MS } from './timeline.js';

test('항목 제목과 값만 뽑고 주석·설명 줄은 무시한다', () => {
  const md = '# 제목\n> 설명 - 아님\n\n## 1. 회사 규모\n<!-- 정상 3 -->\n- 스타트업\n- 1인 기업\n\n## 2. 연봉\n- 100원\n';
  assert.deepEqual(parseValues(md), [
    { name: '회사 규모', values: ['스타트업', '1인 기업'] },
    { name: '연봉', values: ['100원'] },
  ]);
});

test('실제 값 파일이 항목마다 값을 가진다', () => {
  const md = readFileSync(new URL('./filter-values.md', import.meta.url), 'utf8');
  const categories = parseValues(md);
  assert.ok(categories.length >= 5);
  for (const c of categories) assert.ok(c.values.length > 0, c.name);
});

test('pickRandom 은 random 값에 따라 목록 끝까지 고른다', () => {
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0.999), 'c');
});

test('progress: 일정 속도로 내려가며 3.5초 간격 공개, 마지막 후 HOLD 유지 후 종료', () => {
  assert.equal(progress(-1, 5).revealed, 0);
  assert.equal(progress(revealTime(0) - 1, 5).revealed, 0);
  assert.equal(progress(revealTime(0), 5).revealed, 1);
  assert.equal(revealTime(1) - revealTime(0), STEP_MS);
  assert.equal(progress(revealTime(2), 5).revealed, 3);
  // 시작 페이드인 동안은 첫 노드에 정지
  assert.equal(progress(revealTime(0) - 1, 5).position, 0);
  // 그 뒤 일정 속도: 같은 시간 → 같은 이동 거리
  const t0 = revealTime(0);
  const a = progress(t0 + 1000, 5).position - progress(t0, 5).position;
  const b = progress(t0 + 3000, 5).position - progress(t0 + 2000, 5).position;
  assert.ok(a > 0 && Math.abs(a - b) < 1e-9);
  assert.equal(progress(STEP_MS * 99, 5).revealed, 5);
  assert.equal(progress(STEP_MS * 99, 5).position, 4); // 마지막 노드에서 멈춤
  assert.equal(progress(revealTime(4) + HOLD_MS - 1, 5).done, false);
  assert.equal(progress(revealTime(4) + HOLD_MS, 5).done, true);
});
