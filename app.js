// 캐시 무효화: index.html 이 붙여 준 ?v=값을 하위 모듈에도 그대로 붙여 항상 새 파일을 받는다.
const V = new URL(import.meta.url).search;
const { parseValues, pickRandom } = await import(`./values.js${V}`);
const { drawTimeline, progress } = await import(`./timeline.js${V}`);

const VERSION = 10; // 배포할 때마다 +1 (오른쪽 위 표시, 녹화엔 안 들어감)
const VALUES_URL = './filter-values.md';
const SIGNAL_MS = 1200; // 시작 신호 길이
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const camera = document.getElementById('camera');
const preview = document.getElementById('preview');
const msg = document.getElementById('msg');
const signal = document.getElementById('signal');
const cameraBtn = document.getElementById('camera-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const saveBtn = document.getElementById('save-btn');
const retryBtn = document.getElementById('retry-btn');

let stream = null;
let categories = [];
let picks = [];
let recorder = null;
let videoTrack = null;
let captureMode = '-';
let startedAt = 0; // 0 = 대기 중 (타임라인 정지)
let frozenElapsed = -SIGNAL_MS;
let recordedFile = null;

const show = (...buttons) => {
  for (const b of [cameraBtn, startBtn, stopBtn, saveBtn, retryBtn]) b.hidden = !buttons.includes(b);
};

function drawCamera() {
  const { width: cw, height: ch } = canvas;
  const vw = camera.videoWidth;
  const vh = camera.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.save();
  ctx.translate(cw, 0);
  ctx.scale(-1, 1); // 셀카처럼 좌우 반전
  ctx.drawImage(camera, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  ctx.restore();
}

// 시작 신호는 canvas가 아닌 화면 위 요소로 띄워서 녹화 영상에는 안 남게 한다.
function showSignal() {
  signal.classList.remove('on');
  void signal.offsetWidth; // 애니메이션 재시작
  signal.classList.add('on');
}

// 진단용 (화면에만 표시, 녹화엔 안 들어감): 그리기 fps / 카메라 영상 시간 / 녹화 상태
// 화면 멈춤 원인 구분: fps 가 떨어지면 그리기 문제, cam 시간이 멈추면 카메라 문제, 둘 다 정상이면 녹화 문제
const ver = document.getElementById('ver');
let frames = 0;
let lastCamTime = -1;
setInterval(() => {
  const cam = camera.currentTime;
  const camState = camera.paused ? '정지' : cam === lastCamTime ? '멈춤' : '정상';
  lastCamTime = cam;
  ver.textContent = `v${VERSION} · ${frames * 2}fps · 카메라 ${camState} · 녹화 ${recorder?.state ?? '-'} (${captureMode})`;
  frames = 0;
}, 500);
ver.textContent = `v${VERSION}`;

function renderLoop() {
  frames++;
  if (camera.paused && stream) camera.play().catch(() => {}); // iOS가 카메라 영상을 멈추면 다시 재생
  const elapsed = startedAt ? performance.now() - startedAt - SIGNAL_MS : frozenElapsed;
  drawCamera();
  drawTimeline(ctx, categories, picks, elapsed);
  if (videoTrack?.requestFrame && recorder?.state === 'recording') videoTrack.requestFrame();
  if (startedAt && progress(elapsed, categories.length).done) stopRecording();
  requestAnimationFrame(renderLoop);
}

async function loadValues() {
  const res = await fetch(VALUES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`값 파일을 못 읽었어요 (${res.status})`);
  const parsed = parseValues(await res.text());
  if (!parsed.length) throw new Error('값 파일에 항목이 없어요');
  return parsed;
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    msg.textContent = '이 브라우저는 카메라를 지원하지 않아요. HTTPS 주소인지 확인해 주세요.';
    return;
  }
  try {
    categories = await loadValues();
  } catch (err) {
    msg.textContent = `${err.message} — web 폴더에서 서버를 켰는지 확인해 주세요.`;
    console.error(err);
    return;
  }
  picks = categories.map(() => '');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch (err) {
    msg.textContent = `카메라/마이크를 열 수 없어요: ${err.name}`;
    console.error(err);
    return;
  }
  camera.srcObject = stream;
  await camera.play();
  renderLoop();
  msg.textContent = '';
  show(startBtn);
}

function startRecording() {
  if (typeof MediaRecorder === 'undefined') {
    msg.textContent = '이 브라우저는 녹화를 지원하지 않아요.';
    return;
  }
  const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  // iOS 에서 captureStream(30) 자동 캡처가 녹화 도중 프레임을 멈추는 증상 → 그린 직후 프레임을 직접 밀어 넣는다.
  videoTrack = canvas.captureStream(0).getVideoTracks()[0];
  captureMode = 'manual';
  if (typeof videoTrack.requestFrame !== 'function') {
    videoTrack.stop();
    videoTrack = canvas.captureStream(30).getVideoTracks()[0];
    captureMode = 'auto';
  }
  const mixed = new MediaStream([videoTrack, ...stream.getAudioTracks()]);
  const chunks = [];
  recorder = new MediaRecorder(mixed, {
    ...(mimeType && { mimeType }),
    videoBitsPerSecond: 4_000_000,
  });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onerror = (e) => {
    msg.textContent = `녹화 오류: ${e.error?.name ?? 'unknown'}`;
    console.error(e);
  };
  recorder.onstop = () => {
    const type = recorder.mimeType || mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    recordedFile = new File([blob], `ddd-filter-${Date.now()}.${ext}`, { type });
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
    canvas.style.display = 'none';
    // 진단용: 소리 문제 원인 파악 (M1 끝나면 제거)
    const mic = stream.getAudioTracks()[0];
    const micInfo = mic ? `${mic.label} / ${mic.readyState} / muted=${mic.muted} / enabled=${mic.enabled}` : '마이크 트랙 없음';
    msg.textContent = `녹화 완료 (${type}, ${(blob.size / 1024 / 1024).toFixed(1)}MB) · 마이크: ${micInfo}`;
    show(saveBtn, retryBtn);
  };

  picks = categories.map((c) => pickRandom(c.values));
  recorder.start(1000); // 1초마다 조각 저장 (한 번에 몰아 쓰지 않게)
  startedAt = performance.now();
  showSignal();
  msg.textContent = '';
  show(stopBtn);
}

// 자동 종료와 "중단" 버튼이 같이 쓴다. 여러 번 불려도 한 번만 멈춘다.
function stopRecording() {
  if (!startedAt) return;
  frozenElapsed = performance.now() - startedAt - SIGNAL_MS;
  startedAt = 0;
  if (recorder?.state === 'recording') recorder.stop();
}

// Safari는 사용자 탭 안에서만 공유 시트를 허용하므로 저장은 버튼 클릭에서 호출한다.
async function save() {
  if (!recordedFile) return;
  if (navigator.canShare?.({ files: [recordedFile] })) {
    try {
      await navigator.share({ files: [recordedFile] });
      retry(); // 저장 끝 → 다시 촬영 대기 화면으로
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 공유 시트 취소 → 저장 버튼 유지
      console.error(err);
    }
  }
  const a = document.createElement('a');
  a.href = preview.src;
  a.download = recordedFile.name;
  a.click();
  retry();
}

function retry() {
  const oldUrl = preview.src;
  setTimeout(() => URL.revokeObjectURL(oldUrl), 60_000); // 다운로드 진행 중일 수 있어 바로 해제하지 않음
  preview.removeAttribute('src');
  preview.style.display = 'none';
  canvas.style.display = 'block';
  recordedFile = null;
  picks = categories.map(() => '');
  frozenElapsed = -SIGNAL_MS;
  msg.textContent = '';
  show(startBtn);
}

cameraBtn.addEventListener('click', openCamera);
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
saveBtn.addEventListener('click', save);
retryBtn.addEventListener('click', retry);
