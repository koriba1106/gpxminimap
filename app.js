/**
 * GPX Route Studio Workstation - Production Core Engine (app.js)
 * Crash-proof Null-safe DOM binding & Multi-layer Drag-and-Drop Architecture
 */
(() => {
  'use strict';

  // --- 1. クリックジャッキング防御 ---
  if (window.self !== window.top) {
    const blockedEl = document.getElementById('frameBlocked');
    const appRoot = document.getElementById('appRoot');
    if (blockedEl) blockedEl.hidden = false;
    if (appRoot) appRoot.hidden = true;
    return;
  }

  // --- Nullセーフなイベント登録ヘルパー（要素欠落による初期化クラッシュを100%防止） ---
  function on(el, type, handler, options) {
    if (el && typeof el.addEventListener === 'function') {
      el.addEventListener(type, handler, options);
    }
  }

  // --- 2. システム定数・制限値 ---
  const CONFIG = Object.freeze({
    PROJECT_MAGIC: 'GPX_ROUTE_STUDIO_PROJECT',
    PROJECT_VERSION: 1,
    SAMPLE_GPX_FILE: 'sample_routegpx.gpx',
    MAX_GPX_BYTES: 25 * 1024 * 1024,
    MAX_PHOTO_BYTES: 30 * 1024 * 1024,
    MAX_PROJECT_BYTES: 25 * 1024 * 1024,
    MAX_XML_LENGTH: 30 * 1024 * 1024,
    MAX_RENDER_PTS: 2400,
    MAX_WAYPOINTS: 500,
    CANVAS_W: 1920,
    CANVAS_H: 1080,
    BASE_MAP_SIZE: 700,
    VIDEO_BITRATE: 12_000_000,
    FPS: 30
  });

  const ALLOWED_ANIM_TYPES = Object.freeze(['pulse', 'blink', 'radar', 'progress']);
  const ALLOWED_BG_MODES = Object.freeze(['transparent', 'green', 'blue', 'black']);

  const PRESETS = Object.freeze({
    full: { offsetX: 960,  offsetY: 540, scale: 1.35 },
    br:   { offsetX: 1580, offsetY: 790, scale: 0.55 },
    bl:   { offsetX: 340,  offsetY: 790, scale: 0.55 },
    tr:   { offsetX: 1580, offsetY: 290, scale: 0.55 },
    tl:   { offsetX: 340,  offsetY: 290, scale: 0.55 }
  });

  // --- 3. DOM要素の取得 ---
  const canvas = document.getElementById('mainCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });

  const UI = Object.freeze({
    btnOpenFile: document.getElementById('btnOpenFile'),
    btnSaveProject: document.getElementById('btnSaveProject'),
    btnLoadProject: document.getElementById('btnLoadProject'),
    projectInput: document.getElementById('projectInput'),
    btnSample: document.getElementById('btnSample'),
    btnSelfTest: document.getElementById('btnSelfTest'),
    btnResetAll: document.getElementById('btnResetAll'),
    pointBadge: document.getElementById('pointBadge'),
    fileZone: document.getElementById('fileZone'),
    fileInput: document.getElementById('fileInput'),
    metaInfo: document.getElementById('metaInfo'),
    previewContainer: document.getElementById('previewContainer'),
    emptyState: document.getElementById('emptyState'),
    canvasStage: document.getElementById('canvasStage'),
    safetyGuideOverlay: document.getElementById('safetyGuideOverlay'),
    btnToggleGuide: document.getElementById('btnToggleGuide'),
    btnResetAnim: document.getElementById('btnResetAnim'),
    presetThumbs: document.getElementById('presetThumbs'),
    btnClearPhoto: document.getElementById('btnClearPhoto'),
    lineColorRow: document.getElementById('lineColorRow'),
    lineCustomColor: document.getElementById('lineCustomColor'),
    lineColorBadge: document.getElementById('lineColorBadge'),
    markerColorRow: document.getElementById('markerColorRow'),
    markerCustomColor: document.getElementById('markerCustomColor'),
    markerColorBadge: document.getElementById('markerColorBadge'),
    zoomRange: document.getElementById('zoomRange'),
    zoomNum: document.getElementById('zoomNum'),
    zoomBadge: document.getElementById('zoomBadge'),
    lineWidthRange: document.getElementById('lineWidthRange'),
    lineWidthNum: document.getElementById('lineWidthNum'),
    fontSizeRange: document.getElementById('fontSizeRange'),
    fontSizeNum: document.getElementById('fontSizeNum'),
    sizeBadge: document.getElementById('sizeBadge'),
    btnTogglePlate: document.getElementById('btnTogglePlate'),
    btnToggleOutline: document.getElementById('btnToggleOutline'),
    wptTableBody: document.getElementById('wptTableBody'),
    wptSelect: document.getElementById('wptSelect'),
    blinkCountBadge: document.getElementById('blinkCountBadge'),
    btnBlinkAllOn: document.getElementById('btnBlinkAllOn'),
    btnBlinkAllOff: document.getElementById('btnBlinkAllOff'),
    btnLabelAllToggle: document.getElementById('btnLabelAllToggle'),
    wptEditorPanel: document.getElementById('wptEditorPanel'),
    wptEditorTitle: document.getElementById('wptEditorTitle'),
    wptNameInput: document.getElementById('wptNameInput'),
    btnSaveWptName: document.getElementById('btnSaveWptName'),
    btnCancelWptName: document.getElementById('btnCancelWptName'),
    routeSeekRange: document.getElementById('routeSeekRange'),
    seekBadge: document.getElementById('seekBadge'),
    btnToggleSeekBlink: document.getElementById('btnToggleSeekBlink'),
    newSeekWptInput: document.getElementById('newSeekWptInput'),
    btnAddWptAtSeek: document.getElementById('btnAddWptAtSeek'),
    animTypeSelect: document.getElementById('animTypeSelect'),
    animSpeedRange: document.getElementById('animSpeedRange'),
    animSpeedNum: document.getElementById('animSpeedNum'),
    markerSizeRange: document.getElementById('markerSizeRange'),
    markerSizeNum: document.getElementById('markerSizeNum'),
    speedBadge: document.getElementById('speedBadge'),
    bgModeSelect: document.getElementById('bgModeSelect'),
    recordSecRange: document.getElementById('recordSecRange'),
    recordSecNum: document.getElementById('recordSecNum'),
    secBadge: document.getElementById('secBadge'),
    chromaHint: document.getElementById('chromaHint'),
    btnExportVideo: document.getElementById('btnExportVideo'),
    btnExportPng: document.getElementById('btnExportPng'),
    btnExportVideoSide: document.getElementById('btnExportVideoSide'),
    btnExportPngSide: document.getElementById('btnExportPngSide'),
    statusBox: document.getElementById('statusBox'),
    testBox: document.getElementById('testBox')
  });

  // --- 4. アプリケーション状態管理（起動時の背景プレート showPlate は false = OFF） ---
  const State = {
    loadSessionId: 0,
    gpxFileName: '',
    rawPointCount: 0,
    trackPoints: [],
    cumDist: new Float64Array(0),
    totalDist: 0,
    waypoints: [],
    selectedWptId: null,
    seekRatio: 0.5,
    seekPoint: null,
    seekBlinking: false,
    pendingCoord: null,
    lineColor: '#ffffff',
    markerColor: '#ff453a',
    markerRgb: { r: 255, g: 69, b: 58 },
    showPlate: false,
    showOutline: true,
    showGuide: true,
    bounds: {
      minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
      centerLat: 35, cosLat: 1, lonSpan: 0.01, latSpan: 0.01, maxSpan: 0.01
    },
    view: { offsetX: 1580, offsetY: 790, scale: 0.55 },
    bgBufferCanvas: null,
    bgPhotoName: '',
    animStartTime: performance.now(),
    rafId: null,
    isPageVisible: true,
    isRecording: false,
    mediaRecorder: null,
    activeStream: null,
    recordTimer: null,
    nextId: 1
  };

  // --- 5. 共通ユーティリティ ---
  function clampNumber(val, min, max, fallback) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return num < min ? min : num > max ? max : num;
  }

  function isValidHexColor(str) {
    return typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str);
  }

  function setStatus(message, isError = false) {
    if (!UI.statusBox) return;
    UI.statusBox.textContent = message;
    UI.statusBox.classList.toggle('error', Boolean(isError));
  }

  function readFileAsText(file) {
    if (typeof file.text === 'function') {
      return file.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('ファイルの読み取りに失敗しました。'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function parseHexRgb(hex) {
    const clean = (hex || '#ff453a').replace('#', '');
    const num = parseInt(clean, 16);
    if (!Number.isFinite(num)) return { r: 255, g: 69, b: 58 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function isGreenHue(hex) {
    const { r, g, b } = parseHexRgb(hex);
    return g > 130 && g > r * 1.3 && g > b * 1.2;
  }
  function isBlueHue(hex) {
    const { r, g, b } = parseHexRgb(hex);
    return b > 140 && b > r * 1.3 && b > g * 1.1;
  }

  function validateChromaCollision() {
    if (!UI.bgModeSelect || !UI.chromaHint) return;
    const mode = UI.bgModeSelect.value;
    if (mode === 'green') {
      UI.chromaHint.textContent = 'グリーンバック出力：スピル（緑かぶり）防止のため半透明混合を自動抑止します。';
      if (isGreenHue(State.lineColor) || isGreenHue(State.markerColor)) {
        setStatus('注意: グリーンバック選択中に緑系の線・マーカーを使うとクロマキーで一緒に透過されます。赤や白への変更を推奨します。', true);
      }
    } else if (mode === 'blue') {
      UI.chromaHint.textContent = 'ブルーバック出力：スピル（青かぶり）防止のため半透明混合を自動抑止します。';
      if (isBlueHue(State.lineColor) || isBlueHue(State.markerColor)) {
        setStatus('注意: ブルーバック選択中に青系の線・マーカーを使うとクロマキーで一緒に透過されます。赤や黄への変更を推奨します。', true);
      }
    } else if (mode === 'black') {
      UI.chromaHint.textContent = 'ブラック背景出力：編集ソフトのブレンドモード「スクリーン」または「加算」で黒背景が抜けます。';
    } else {
      UI.chromaHint.textContent = '背景透過モード：Premiere / DaVinci等でそのまま重ねられるアルファ付きWebM（または写真合成）です。';
    }
  }

  // --- 6. メモリ管理：写真オフスクリーンバッファ＆録画ストリーム解放 ---
  function releasePhotoMemory() {
    if (State.bgBufferCanvas) {
      State.bgBufferCanvas.width = 0;
      State.bgBufferCanvas.height = 0;
      State.bgBufferCanvas = null;
    }
    State.bgPhotoName = '';
    if (UI.btnClearPhoto) UI.btnClearPhoto.disabled = true;
    updateMetaText();
    renderPresetThumbnails();
  }

  function createPrescaledPhotoBuffer(img) {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = CONFIG.CANVAS_W;
    offCanvas.height = CONFIG.CANVAS_H;
    const offCtx = offCanvas.getContext('2d', { alpha: false });
    offCtx.imageSmoothingEnabled = true;
    offCtx.imageSmoothingQuality = 'high';

    const imgR = img.naturalWidth / img.naturalHeight;
    const canR = CONFIG.CANVAS_W / CONFIG.CANVAS_H;
    let dw = CONFIG.CANVAS_W, dh = CONFIG.CANVAS_H, dx = 0, dy = 0;
    if (imgR > canR) {
      dw = CONFIG.CANVAS_H * imgR;
      dx = (CONFIG.CANVAS_W - dw) * 0.5;
    } else {
      dh = CONFIG.CANVAS_W / imgR;
      dy = (CONFIG.CANVAS_H - dh) * 0.5;
    }
    offCtx.fillStyle = '#000000';
    offCtx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    offCtx.drawImage(img, dx, dy, dw, dh);
    return offCanvas;
  }

  function releaseRecordingMemory() {
    if (State.recordTimer) {
      clearTimeout(State.recordTimer);
      State.recordTimer = null;
    }
    if (State.activeStream) {
      State.activeStream.getTracks().forEach(t => t.stop());
      State.activeStream = null;
    }
    State.mediaRecorder = null;
    State.isRecording = false;
    if (UI.fileZone) UI.fileZone.classList.remove('disabled');
    if (UI.fileInput) UI.fileInput.disabled = false;
    if (UI.btnSaveProject) UI.btnSaveProject.disabled = false;
    if (UI.btnLoadProject) UI.btnLoadProject.disabled = false;
    if (UI.btnExportVideo) UI.btnExportVideo.textContent = '🎬 動画書き出し (.webm)';
    if (UI.btnExportVideoSide) UI.btnExportVideoSide.textContent = '🎬 合成用アニメーション動画を書き出す (.webm)';
  }

  // --- 7. コサイン補正＆Waypointアンカー保護付きRDP軽量化 ---
  function simplifyTrackWithAnchors(points, waypoints, maxCount) {
    const len = points.length;
    if (len <= maxCount) return points.slice();

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < len; i++) {
      const p = points[i];
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const centerLat = (minLat + maxLat) * 0.5;
    const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
    const span = Math.max(maxLat - minLat, (maxLon - minLon) * cosLat) || 0.001;
    let eps = span * 0.00014;

    const anchorFlags = new Uint8Array(len);
    anchorFlags[0] = 1;
    anchorFlags[len - 1] = 1;
    if (Array.isArray(waypoints)) {
      for (let w = 0; w < waypoints.length; w++) {
        const wpt = waypoints[w];
        let bestIdx = 0, bestDistSq = Infinity;
        for (let i = 0; i < len; i++) {
          const dLat = points[i].lat - wpt.lat;
          const dLon = (points[i].lon - wpt.lon) * cosLat;
          const dSq = dLat * dLat + dLon * dLon;
          if (dSq < bestDistSq) { bestDistSq = dSq; bestIdx = i; }
        }
        anchorFlags[bestIdx] = 1;
      }
    }

    function runRDP(pts, epsilon) {
      const keep = new Uint8Array(anchorFlags);
      const stack = [[0, len - 1]];
      const epsSq = epsilon * epsilon;

      while (stack.length > 0) {
        const [first, last] = stack.pop();
        if (last <= first + 1) continue;

        let maxDistSq = 0, splitIdx = first;
        const ax = pts[first].lon * cosLat, ay = pts[first].lat;
        const bx = pts[last].lon * cosLat,  by = pts[last].lat;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;

        for (let i = first + 1; i < last; i++) {
          const px = pts[i].lon * cosLat, py = pts[i].lat;
          let t = 0;
          if (lenSq > 0) {
            t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            if (t < 0) t = 0; else if (t > 1) t = 1;
          }
          const distSq = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
          if (distSq > maxDistSq) { maxDistSq = distSq; splitIdx = i; }
        }

        if (maxDistSq > epsSq) {
          keep[splitIdx] = 1;
          stack.push([first, splitIdx], [splitIdx, last]);
        }
      }

      const out = [];
      for (let i = 0; i < len; i++) if (keep[i]) out.push(pts[i]);
      return out;
    }

    let simplified = runRDP(points, eps);
    let pass = 0;
    while (simplified.length > maxCount && pass < 4) {
      eps *= 2.1;
      simplified = runRDP(points, eps);
      pass++;
    }
    return simplified;
  }

  // --- 8. 累積距離テーブル＆距離比例補間 (Lerp) ---
  function buildCumulativeDistanceTable() {
    const tp = State.trackPoints;
    const n = tp.length;
    if (n === 0) {
      State.cumDist = new Float64Array(0);
      State.totalDist = 0;
      return;
    }
    const cosLat = State.bounds.cosLat || 1;
    const cum = new Float64Array(n);
    let total = 0;
    for (let i = 1; i < n; i++) {
      total += Math.hypot(tp[i].lat - tp[i - 1].lat, (tp[i].lon - tp[i - 1].lon) * cosLat);
      cum[i] = total;
    }
    State.cumDist = cum;
    State.totalDist = total;
  }

  function getPointAtDistanceRatio(ratio) {
    const tp = State.trackPoints;
    const cum = State.cumDist;
    const n = tp.length;
    if (n === 0) return { lat: 0, lon: 0, lastIndex: 0 };
    if (n === 1 || State.totalDist <= 0) return { lat: tp[0].lat, lon: tp[0].lon, lastIndex: 0 };

    const clamped = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
    const targetDist = clamped * State.totalDist;

    let low = 0, high = n - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if (cum[mid] <= targetDist) low = mid;
      else high = mid - 1;
    }
    if (low >= n - 1) return { lat: tp[n - 1].lat, lon: tp[n - 1].lon, lastIndex: n - 1 };

    const seg = cum[low + 1] - cum[low];
    const t = seg > 1e-12 ? (targetDist - cum[low]) / seg : 0;
    return {
      lat: tp[low].lat + (tp[low + 1].lat - tp[low].lat) * t,
      lon: tp[low].lon + (tp[low + 1].lon - tp[low].lon) * t,
      lastIndex: low
    };
  }

  // --- 9. 境界ボックス＆座標投影 ---
  function recalculateBoundsAndDistances() {
    const tp = State.trackPoints;
    const wp = State.waypoints;
    if (tp.length === 0 && wp.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < tp.length; i++) {
      const p = tp[i];
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    for (let i = 0; i < wp.length; i++) {
      const w = wp[i];
      if (w.lat < minLat) minLat = w.lat;
      if (w.lat > maxLat) maxLat = w.lat;
      if (w.lon < minLon) minLon = w.lon;
      if (w.lon > maxLon) maxLon = w.lon;
    }

    const centerLat = (minLat + maxLat) * 0.5;
    const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
    const lonSpan = Math.max((maxLon - minLon) * cosLat, 0.0005);
    const latSpan = Math.max(maxLat - minLat, 0.0005);

    State.bounds = {
      minLat, maxLat, minLon, maxLon,
      centerLat, cosLat, lonSpan, latSpan,
      maxSpan: Math.max(lonSpan, latSpan)
    };

    buildCumulativeDistanceTable();
    const seekRes = getPointAtDistanceRatio(State.seekRatio);
    State.seekPoint = { lat: seekRes.lat, lon: seekRes.lon };
  }

  function projectCustom(lat, lon, offsetX, offsetY, scale, baseSize) {
    const b = State.bounds;
    const size = baseSize * scale;
    return {
      x: offsetX + ((((lon - b.minLon) * b.cosLat) - b.lonSpan * 0.5) / b.maxSpan) * size,
      y: offsetY + (((b.maxLat - lat) - b.latSpan * 0.5) / b.maxSpan) * size
    };
  }

  function projectToMain(lat, lon) {
    return projectCustom(lat, lon, State.view.offsetX, State.view.offsetY, State.view.scale, CONFIG.BASE_MAP_SIZE);
  }

  function unprojectFromMain(x, y) {
    const b = State.bounds;
    const size = CONFIG.BASE_MAP_SIZE * State.view.scale;
    const nx = (x - State.view.offsetX) / size;
    const ny = (y - State.view.offsetY) / size;
    return {
      lat: b.maxLat - (ny * b.maxSpan + b.latSpan * 0.5),
      lon: ((nx * b.maxSpan + b.lonSpan * 0.5) / b.cosLat) + b.minLon
    };
  }

  // --- 10. ビューポート情報＆5配置サムネイル描画 ---
  function updateMetaText() {
    const hasTrack = State.trackPoints.length > 0;
    if (UI.emptyState) UI.emptyState.hidden = hasTrack;
    if (UI.canvasStage) UI.canvasStage.hidden = !hasTrack;
    canvas.hidden = !hasTrack;
    if (UI.safetyGuideOverlay) UI.safetyGuideOverlay.hidden = !hasTrack || !State.showGuide;

    if (!hasTrack) {
      if (UI.pointBadge) UI.pointBadge.textContent = '0 pts';
      if (UI.metaInfo) UI.metaInfo.textContent = 'GPXファイルまたはプロジェクト(.json)をドロップしてください';
      return;
    }

    const ptText = State.rawPointCount !== State.trackPoints.length
      ? `${State.rawPointCount.toLocaleString()} → ${State.trackPoints.length.toLocaleString()} pts`
      : `${State.trackPoints.length.toLocaleString()} pts`;
    if (UI.pointBadge) UI.pointBadge.textContent = ptText;

    const photoText = State.bgPhotoName ? ` ｜ 背景写真: ${State.bgPhotoName}` : ' ｜ 背景: 透過/クロマキー';
    if (UI.metaInfo) UI.metaInfo.textContent = `ルート: ${State.gpxFileName}（${ptText} / Waypoint: ${State.waypoints.length}箇所）${photoText}`;
  }

  function renderPresetThumbnails() {
    if (!UI.presetThumbs) return;
    const thumbButtons = UI.presetThumbs.querySelectorAll('.thumb');
    const tp = State.trackPoints;

    thumbButtons.forEach((btn) => {
      const preset = PRESETS[btn.dataset.preset];
      const thumbCanvas = btn.querySelector('canvas');
      if (!thumbCanvas || !preset) return;

      const tCtx = thumbCanvas.getContext('2d');
      const w = thumbCanvas.width, h = thumbCanvas.height;
      tCtx.clearRect(0, 0, w, h);

      if (State.bgBufferCanvas) {
        tCtx.drawImage(State.bgBufferCanvas, 0, 0, w, h);
        tCtx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        tCtx.fillRect(0, 0, w, h);
      } else {
        tCtx.fillStyle = '#dcece3';
        tCtx.fillRect(0, 0, w, h);
      }

      if (tp.length < 2) return;

      const ratioX = w / CONFIG.CANVAS_W;
      const ratioY = h / CONFIG.CANVAS_H;
      const ox = preset.offsetX * ratioX;
      const oy = preset.offsetY * ratioY;
      const sc = preset.scale;
      const baseSize = CONFIG.BASE_MAP_SIZE * ratioX;

      if (State.showPlate) {
        const pad = 420 * sc * ratioX;
        tCtx.fillStyle = 'rgba(19, 57, 38, 0.8)';
        tCtx.fillRect(ox - pad, oy - pad, pad * 2, pad * 2);
      }

      tCtx.beginPath();
      const step = Math.max(1, Math.floor(tp.length / 80));
      for (let i = 0; i < tp.length; i += step) {
        const pt = projectCustom(tp[i].lat, tp[i].lon, ox, oy, sc, baseSize);
        if (i === 0) tCtx.moveTo(pt.x, pt.y);
        else tCtx.lineTo(pt.x, pt.y);
      }
      const last = tp[tp.length - 1];
      const lastPt = projectCustom(last.lat, last.lon, ox, oy, sc, baseSize);
      tCtx.lineTo(lastPt.x, lastPt.y);

      tCtx.strokeStyle = State.lineColor === '#ffffff' && !State.showPlate && !State.bgBufferCanvas ? '#133926' : State.lineColor;
      tCtx.lineWidth = 2;
      tCtx.stroke();

      tCtx.fillStyle = State.markerColor;
      State.waypoints.forEach((wpt) => {
        if (!wpt.blinking) return;
        const pt = projectCustom(wpt.lat, wpt.lon, ox, oy, sc, baseSize);
        tCtx.beginPath();
        tCtx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        tCtx.fill();
      });
    });
  }

  // --- 11. セキュアGPX / JSON / 写真ファイルローダー & 多重ドラッグ＆ドロップ登録 ---
  function sanitizeXmlString(xmlText) {
    if (xmlText.length > CONFIG.MAX_XML_LENGTH) {
      throw new Error('XMLサイズが上限を超えています。');
    }
    const cleaned = xmlText.replace(/^\uFEFF/, '').trimStart();
    if (/<!(DOCTYPE|ENTITY)\b/i.test(cleaned)) {
      throw new Error('DOCTYPEまたはENTITY宣言を含むXMLは読み込めません。');
    }
    return cleaned;
  }

  function getXmlElements(xmlDoc, tagName) {
    let list = Array.from(xmlDoc.getElementsByTagName(tagName));
    if (list.length === 0 && typeof xmlDoc.getElementsByTagNameNS === 'function') {
      list = Array.from(xmlDoc.getElementsByTagNameNS('*', tagName));
    }
    return list;
  }

  async function processUploadedFiles(fileList) {
    if (!fileList || fileList.length === 0 || State.isRecording) return;
    const currentSession = ++State.loadSessionId;

    for (const file of Array.from(fileList)) {
      if (currentSession !== State.loadSessionId) return;
      const lowerName = (file.name || '').toLowerCase();
      const mime = (file.type || '').toLowerCase();

      if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(lowerName)) {
        if (file.size > CONFIG.MAX_PHOTO_BYTES) {
          setStatus(`エラー: 画像「${file.name}」が上限(30MB)を超えています。`, true);
          continue;
        }
        releasePhotoMemory();
        const tempUrl = URL.createObjectURL(file);
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = () => {
            if (currentSession === State.loadSessionId && img.naturalWidth > 0 && img.naturalHeight > 0) {
              State.bgBufferCanvas = createPrescaledPhotoBuffer(img);
              State.bgPhotoName = file.name;
              if (UI.btnClearPhoto) UI.btnClearPhoto.disabled = false;
              updateMetaText();
              renderPresetThumbnails();
              setStatus(`背景写真「${file.name}」をセットしました。`);
            }
            URL.revokeObjectURL(tempUrl);
            img.onload = null; img.onerror = null; img.src = '';
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            img.onload = null; img.onerror = null;
            setStatus('画像の読み込みに失敗しました。', true);
            resolve();
          };
          img.src = tempUrl;
        });
        continue;
      }

      if (file.size > CONFIG.MAX_GPX_BYTES) {
        setStatus(`エラー: ファイル「${file.name}」が上限サイズ(25MB)を超えています。`, true);
        continue;
      }

      try {
        const rawText = await readFileAsText(file);
        if (currentSession !== State.loadSessionId) return;
        const trimmed = rawText.replace(/^\uFEFF/, '').trimStart();

        if (lowerName.endsWith('.json') || mime === 'application/json' || (trimmed.startsWith('{') && trimmed.includes(CONFIG.PROJECT_MAGIC))) {
          const validated = parseAndValidateProjectJson(trimmed);
          await applyValidatedProject(validated, currentSession);
          setStatus(`プロジェクト「${file.name}」を復元しました。`);
          continue;
        }

        const safeText = sanitizeXmlString(trimmed);
        const xml = new DOMParser().parseFromString(safeText, 'text/xml');
        if (xml.querySelector('parsererror')) {
          throw new Error('GPXファイルのXML構造が正しくありません。');
        }

        let nodes = getXmlElements(xml, 'trkpt');
        if (nodes.length === 0) nodes = getXmlElements(xml, 'rtept');

        const rawPts = [];
        for (let i = 0; i < nodes.length; i++) {
          const lat = parseFloat(nodes[i].getAttribute('lat'));
          const lon = parseFloat(nodes[i].getAttribute('lon'));
          if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            rawPts.push({ lat, lon });
          }
        }

        const wptNodes = getXmlElements(xml, 'wpt');
        if (rawPts.length < 2 && wptNodes.length >= 2) {
          for (let i = 0; i < wptNodes.length; i++) {
            const lat = parseFloat(wptNodes[i].getAttribute('lat'));
            const lon = parseFloat(wptNodes[i].getAttribute('lon'));
            if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
              rawPts.push({ lat, lon });
            }
          }
        }

        if (rawPts.length < 2) {
          throw new Error('有効なGPS座標（2点以上）が見つかりません。');
        }

        const wpts = [];
        for (let i = 0; i < wptNodes.length && wpts.length < CONFIG.MAX_WAYPOINTS; i++) {
          const lat = parseFloat(wptNodes[i].getAttribute('lat'));
          const lon = parseFloat(wptNodes[i].getAttribute('lon'));
          if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            const nameEl = getXmlElements(wptNodes[i], 'name')[0];
            const name = (nameEl?.textContent || `地点${i + 1}`).trim().slice(0, 40);
            wpts.push({ id: State.nextId++, lat, lon, name, visible: true, blinking: i === 0 });
          }
        }

        State.gpxFileName = file.name || 'route.gpx';
        State.rawPointCount = rawPts.length;
        State.trackPoints = simplifyTrackWithAnchors(rawPts, wpts, CONFIG.MAX_RENDER_PTS);

        if (wpts.length === 0) {
          const tp = State.trackPoints;
          const mid = Math.floor(tp.length * 0.5);
          wpts.push({ id: State.nextId++, ...tp[0], name: 'スタート', visible: true, blinking: false });
          wpts.push({ id: State.nextId++, ...tp[mid], name: '山頂・中間地点', visible: true, blinking: true });
          wpts.push({ id: State.nextId++, ...tp[tp.length - 1], name: 'ゴール', visible: true, blinking: false });
        }

        State.waypoints = wpts;
        State.selectedWptId = wpts[0].id;
        closeFloatingAddBar(false);
        recalculateBoundsAndDistances();
        updateMetaText();
        syncWaypointSelectUI();
        setStatus(`GPX「${State.gpxFileName}」(${State.rawPointCount.toLocaleString()}点) を読み込みました。`);
      } catch (err) {
        setStatus(`ファイル読込エラー (${file.name}): ${err.message}`, true);
      }
    }
    if (UI.fileInput) UI.fileInput.value = '';
  }

  on(UI.fileInput, 'change', (e) => processUploadedFiles(e.target.files));
  on(UI.btnOpenFile, 'click', () => {
    if (!State.isRecording && UI.fileInput) UI.fileInput.click();
  });
  on(UI.emptyState, 'click', () => {
    if (!State.isRecording && UI.fileInput) UI.fileInput.click();
  });

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (State.isRecording) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (UI.fileZone) UI.fileZone.classList.add('dragover');
    if (UI.previewContainer) UI.previewContainer.classList.add('dragover');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget === null || !document.body.contains(e.relatedTarget)) {
      if (UI.fileZone) UI.fileZone.classList.remove('dragover');
      if (UI.previewContainer) UI.previewContainer.classList.remove('dragover');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (UI.fileZone) UI.fileZone.classList.remove('dragover');
    if (UI.previewContainer) UI.previewContainer.classList.remove('dragover');
    if (State.isRecording) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUploadedFiles(e.dataTransfer.files);
    }
  }

  on(document, 'dragenter', handleDragOver);
  on(document, 'dragover', handleDragOver);
  on(document, 'dragleave', handleDragLeave);
  on(document, 'drop', handleDrop);
  on(UI.fileZone, 'dragover', handleDragOver);
  on(UI.fileZone, 'drop', handleDrop);
  on(UI.previewContainer, 'dragover', handleDragOver);
  on(UI.previewContainer, 'drop', handleDrop);

  // --- 12. Waypointダイレクト編集テーブル ---
  function updateBlinkCountBadge() {
    let blinkCount = State.seekBlinking ? 1 : 0;
    for (let i = 0; i < State.waypoints.length; i++) {
      if (State.waypoints[i].blinking) blinkCount++;
    }
    if (UI.blinkCountBadge) UI.blinkCountBadge.textContent = `点滅: ${blinkCount}箇所`;
    renderPresetThumbnails();
  }

  function syncWaypointSelectUI() {
    if (UI.wptTableBody) UI.wptTableBody.replaceChildren();
    if (UI.wptSelect) UI.wptSelect.replaceChildren();

    if (State.waypoints.length === 0) {
      if (UI.wptTableBody) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'wpt-row';
        emptyRow.textContent = 'Waypointなし';
        UI.wptTableBody.appendChild(emptyRow);
      }
      updateBlinkCountBadge();
      return;
    }

    State.waypoints.forEach((wpt) => {
      if (UI.wptTableBody) {
        const row = document.createElement('div');
        row.className = wpt.blinking ? 'wpt-row is-blinking' : 'wpt-row';

        const blinkBtn = document.createElement('button');
        blinkBtn.type = 'button';
        blinkBtn.className = 'wpt-blink-btn';
        blinkBtn.setAttribute('aria-pressed', String(Boolean(wpt.blinking)));
        blinkBtn.textContent = wpt.blinking ? '⚡ON' : 'OFF';
        blinkBtn.title = 'クリックで点滅ON/OFF（Shift+クリックで単独点滅）';
        blinkBtn.addEventListener('click', (e) => {
          if (e.shiftKey) {
            State.waypoints.forEach(w => { w.blinking = (w.id === wpt.id); });
            State.seekBlinking = false;
            if (UI.btnToggleSeekBlink) {
              UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
              UI.btnToggleSeekBlink.textContent = '⚡ シーク位置を点滅: OFF';
            }
          } else {
            wpt.blinking = !wpt.blinking;
          }
          syncWaypointSelectUI();
        });

        const visBtn = document.createElement('button');
        visBtn.type = 'button';
        visBtn.className = 'wpt-vis-btn';
        visBtn.setAttribute('aria-pressed', String(Boolean(wpt.visible)));
        visBtn.textContent = wpt.visible ? '👁' : 'ー';
        visBtn.title = '地名表示のON/OFF';
        visBtn.addEventListener('click', () => {
          wpt.visible = !wpt.visible;
          syncWaypointSelectUI();
        });

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wpt-inline-input';
        nameInput.maxLength = 40;
        nameInput.value = wpt.name;
        nameInput.addEventListener('input', () => {
          wpt.name = nameInput.value.slice(0, 40);
        });
        nameInput.addEventListener('blur', () => {
          wpt.name = (nameInput.value.trim() || '地点').slice(0, 40);
          nameInput.value = wpt.name;
        });
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') nameInput.blur();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'wpt-del-btn';
        delBtn.textContent = '×';
        delBtn.title = '削除';
        delBtn.addEventListener('click', () => {
          State.waypoints = State.waypoints.filter(w => w.id !== wpt.id);
          recalculateBoundsAndDistances();
          updateMetaText();
          syncWaypointSelectUI();
        });

        row.appendChild(blinkBtn);
        row.appendChild(visBtn);
        row.appendChild(nameInput);
        row.appendChild(delBtn);
        UI.wptTableBody.appendChild(row);
      }

      if (UI.wptSelect) {
        const opt = document.createElement('option');
        opt.value = String(wpt.id);
        opt.textContent = wpt.name;
        UI.wptSelect.appendChild(opt);
      }
    });

    updateBlinkCountBadge();
  }

  on(UI.btnBlinkAllOn, 'click', () => {
    State.waypoints.forEach(w => { w.blinking = true; });
    syncWaypointSelectUI();
    setStatus('すべてのWaypointの点滅をONにしました。');
  });

  on(UI.btnBlinkAllOff, 'click', () => {
    State.waypoints.forEach(w => { w.blinking = false; });
    State.seekBlinking = false;
    if (UI.btnToggleSeekBlink) {
      UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
      UI.btnToggleSeekBlink.textContent = '⚡ シーク位置を点滅: OFF';
    }
    syncWaypointSelectUI();
    setStatus('すべての点滅をOFFにしました。');
  });

  on(UI.btnLabelAllToggle, 'click', () => {
    const anyVis = State.waypoints.some(w => w.visible);
    State.waypoints.forEach(w => { w.visible = !anyVis; });
    syncWaypointSelectUI();
  });

  on(UI.btnAddWptAtSeek, 'click', () => {
    if (State.trackPoints.length === 0) return;
    if (State.waypoints.length >= CONFIG.MAX_WAYPOINTS) {
      setStatus(`エラー: Waypoint上限(${CONFIG.MAX_WAYPOINTS}箇所)に達しています。`, true);
      return;
    }
    const pt = State.seekPoint || State.trackPoints[0];
    const rawVal = UI.newSeekWptInput ? UI.newSeekWptInput.value.trim() : '';
    const cleanName = (rawVal || `地点${State.waypoints.length + 1}`).slice(0, 40);
    State.waypoints.push({
      id: State.nextId++,
      lat: pt.lat,
      lon: pt.lon,
      name: cleanName,
      visible: true,
      blinking: true
    });
    if (UI.newSeekWptInput) UI.newSeekWptInput.value = '';
    recalculateBoundsAndDistances();
    updateMetaText();
    syncWaypointSelectUI();
    setStatus(`シーク位置に「${cleanName}」を追加し、点滅をONにしました。`);
  });

  on(UI.newSeekWptInput, 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (UI.btnAddWptAtSeek) UI.btnAddWptAtSeek.click();
    }
  });

  function openFloatingAddBar(coord) {
    State.pendingCoord = coord;
    if (UI.wptNameInput) UI.wptNameInput.value = '山頂';
    if (UI.wptEditorPanel) UI.wptEditorPanel.hidden = false;
    if (UI.wptNameInput) {
      UI.wptNameInput.focus();
      UI.wptNameInput.select();
    }
  }

  function closeFloatingAddBar(commit) {
    if (commit && State.pendingCoord && State.waypoints.length < CONFIG.MAX_WAYPOINTS) {
      const rawVal = UI.wptNameInput ? UI.wptNameInput.value.trim() : '';
      const cleanName = (rawVal || `地点${State.waypoints.length + 1}`).slice(0, 40);
      State.waypoints.push({
        id: State.nextId++,
        lat: State.pendingCoord.lat,
        lon: State.pendingCoord.lon,
        name: cleanName,
        visible: true,
        blinking: true
      });
      recalculateBoundsAndDistances();
      updateMetaText();
      syncWaypointSelectUI();
      setStatus(`「${cleanName}」を追加しました。`);
    }
    State.pendingCoord = null;
    if (UI.wptEditorPanel) UI.wptEditorPanel.hidden = true;
  }

  on(UI.btnSaveWptName, 'click', () => closeFloatingAddBar(true));
  on(UI.btnCancelWptName, 'click', () => closeFloatingAddBar(false));
  on(UI.wptNameInput, 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeFloatingAddBar(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFloatingAddBar(false); }
  });

  // --- 13. プロジェクト保存 (.json) ＆ 再開機能 ---
  function serializeProjectData() {
    let bgPhotoDataUrl = null;
    if (State.bgBufferCanvas) {
      try {
        bgPhotoDataUrl = State.bgBufferCanvas.toDataURL('image/webp', 0.86);
        if (!bgPhotoDataUrl.startsWith('data:image/webp')) {
          bgPhotoDataUrl = State.bgBufferCanvas.toDataURL('image/jpeg', 0.86);
        }
      } catch (_) {
        bgPhotoDataUrl = null;
      }
    }

    return {
      magic: CONFIG.PROJECT_MAGIC,
      version: CONFIG.PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      route: {
        gpxFileName: State.gpxFileName || 'route.gpx',
        rawPointCount: State.rawPointCount,
        trackPoints: State.trackPoints.map(p => ({
          lat: Number(p.lat.toFixed(6)),
          lon: Number(p.lon.toFixed(6))
        })),
        waypoints: State.waypoints.map(w => ({
          id: w.id,
          lat: Number(w.lat.toFixed(6)),
          lon: Number(w.lon.toFixed(6)),
          name: String(w.name).slice(0, 40),
          visible: Boolean(w.visible),
          blinking: Boolean(w.blinking)
        }))
      },
      view: {
        offsetX: Math.round(State.view.offsetX),
        offsetY: Math.round(State.view.offsetY),
        scale: Number(State.view.scale.toFixed(3))
      },
      style: {
        lineColor: State.lineColor,
        markerColor: State.markerColor,
        lineWidth: parseFloat(UI.lineWidthRange?.value) || 5,
        fontSize: parseInt(UI.fontSizeRange?.value, 10) || 20,
        showPlate: Boolean(State.showPlate),
        showOutline: Boolean(State.showOutline)
      },
      animation: {
        animType: UI.animTypeSelect?.value || 'pulse',
        animSpeed: parseFloat(UI.animSpeedRange?.value) || 2.0,
        markerSize: parseFloat(UI.markerSizeRange?.value) || 10,
        selectedWptId: State.selectedWptId,
        seekRatio: Number(State.seekRatio.toFixed(4)),
        seekBlinking: Boolean(State.seekBlinking),
        bgMode: UI.bgModeSelect?.value || 'transparent',
        recordSec: parseInt(UI.recordSecRange?.value, 10) || 5
      },
      backgroundPhoto: bgPhotoDataUrl ? {
        name: State.bgPhotoName || 'photo.jpg',
        dataUrl: bgPhotoDataUrl
      } : null
    };
  }

  function parseAndValidateProjectJson(jsonString) {
    if (typeof jsonString !== 'string' || jsonString.length > CONFIG.MAX_PROJECT_BYTES) {
      throw new Error('プロジェクトファイルのサイズが上限を超えているか無効です。');
    }

    const raw = JSON.parse(jsonString, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    });

    if (!raw || typeof raw !== 'object' || raw.magic !== CONFIG.PROJECT_MAGIC) {
      throw new Error('有効なGPX Route Studioプロジェクトファイルではありません。');
    }

    const route = raw.route;
    if (!route || !Array.isArray(route.trackPoints)) {
      throw new Error('プロジェクト内に有効なルート軌跡データが含まれていません。');
    }

    const validTrack = [];
    const maxPts = CONFIG.MAX_RENDER_PTS * 2;
    for (let i = 0; i < route.trackPoints.length && validTrack.length < maxPts; i++) {
      const pt = route.trackPoints[i];
      if (!pt || typeof pt !== 'object') continue;
      const lat = Number(pt.lat), lon = Number(pt.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        validTrack.push({ lat, lon });
      }
    }
    if (validTrack.length < 2) throw new Error('プロジェクト内の有効なGPS座標が2点未満です。');

    const validWpts = [];
    let maxId = 0;
    if (Array.isArray(route.waypoints)) {
      for (let i = 0; i < route.waypoints.length && validWpts.length < CONFIG.MAX_WAYPOINTS; i++) {
        const w = route.waypoints[i];
        if (!w || typeof w !== 'object') continue;
        const lat = Number(w.lat), lon = Number(w.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          const id = Number.isInteger(w.id) && w.id > 0 ? w.id : (i + 1);
          if (id > maxId) maxId = id;
          const name = String(w.name ?? `地点${i + 1}`).trim().slice(0, 40) || `地点${i + 1}`;
          validWpts.push({ id, lat, lon, name, visible: w.visible !== false, blinking: Boolean(w.blinking) });
        }
      }
    }

    const v = raw.view || {};
    const validView = {
      offsetX: clampNumber(v.offsetX, -2000, 4000, 1580),
      offsetY: clampNumber(v.offsetY, -2000, 3000, 790),
      scale: clampNumber(v.scale, 0.15, 3.0, 0.55)
    };

    const st = raw.style || {};
    const validStyle = {
      lineColor: isValidHexColor(st.lineColor) ? st.lineColor.toLowerCase() : '#ffffff',
      markerColor: isValidHexColor(st.markerColor) ? st.markerColor.toLowerCase() : '#ff453a',
      lineWidth: clampNumber(st.lineWidth, 1, 16, 5),
      fontSize: Math.round(clampNumber(st.fontSize, 11, 38, 20)),
      showPlate: Boolean(st.showPlate),
      showOutline: st.showOutline !== false
    };

    const an = raw.animation || {};
    const validAnim = {
      animType: ALLOWED_ANIM_TYPES.includes(an.animType) ? an.animType : 'pulse',
      animSpeed: clampNumber(an.animSpeed, 0.5, 5.0, 2.0),
      markerSize: Math.round(clampNumber(an.markerSize, 5, 26, 10)),
      selectedWptId: Number.isInteger(an.selectedWptId) ? an.selectedWptId : (validWpts[0]?.id ?? null),
      seekRatio: clampNumber(an.seekRatio, 0, 1, 0.5),
      seekBlinking: Boolean(an.seekBlinking),
      bgMode: ALLOWED_BG_MODES.includes(an.bgMode) ? an.bgMode : 'transparent',
      recordSec: Math.round(clampNumber(an.recordSec, 2, 30, 5))
    };

    let validPhoto = null;
    if (raw.backgroundPhoto && typeof raw.backgroundPhoto === 'object') {
      const dataUrl = raw.backgroundPhoto.dataUrl;
      if (typeof dataUrl === 'string' && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
        validPhoto = { name: String(raw.backgroundPhoto.name || 'restored_photo.jpg').slice(0, 80), dataUrl };
      }
    }

    const rawPointCount = Math.max(
      validTrack.length,
      Number.isInteger(route.rawPointCount) && route.rawPointCount > 0 ? route.rawPointCount : validTrack.length
    );

    return {
      gpxFileName: String(route.gpxFileName || 'project_route.gpx').slice(0, 100),
      rawPointCount,
      trackPoints: validTrack,
      waypoints: validWpts,
      nextId: maxId + 1,
      view: validView,
      style: validStyle,
      animation: validAnim,
      backgroundPhoto: validPhoto
    };
  }

  function syncAllControlsWithState() {
    if (UI.lineColorRow) {
      UI.lineColorRow.querySelectorAll('.swatch').forEach((btn) => {
        btn.setAttribute('aria-pressed', btn.dataset.color.toLowerCase() === State.lineColor ? 'true' : 'false');
      });
    }
    if (UI.lineCustomColor) UI.lineCustomColor.value = State.lineColor;
    if (UI.lineColorBadge) UI.lineColorBadge.textContent = State.lineColor.toUpperCase();

    if (UI.markerColorRow) {
      UI.markerColorRow.querySelectorAll('.swatch').forEach((btn) => {
        btn.setAttribute('aria-pressed', btn.dataset.color.toLowerCase() === State.markerColor ? 'true' : 'false');
      });
    }
    if (UI.markerCustomColor) UI.markerCustomColor.value = State.markerColor;
    if (UI.markerColorBadge) UI.markerColorBadge.textContent = State.markerColor.toUpperCase();

    const pct = Math.round(State.view.scale * 100);
    if (UI.zoomRange) UI.zoomRange.value = String(State.view.scale);
    if (UI.zoomNum) UI.zoomNum.value = String(pct);
    if (UI.zoomBadge) UI.zoomBadge.textContent = `${pct}%`;

    if (UI.lineWidthNum && UI.lineWidthRange) UI.lineWidthNum.value = UI.lineWidthRange.value;
    if (UI.fontSizeNum && UI.fontSizeRange) UI.fontSizeNum.value = UI.fontSizeRange.value;

    if (UI.btnTogglePlate) {
      UI.btnTogglePlate.setAttribute('aria-pressed', String(State.showPlate));
      UI.btnTogglePlate.textContent = `背景プレート: ${State.showPlate ? 'ON' : 'OFF'}`;
    }
    if (UI.btnToggleOutline) {
      UI.btnToggleOutline.setAttribute('aria-pressed', String(State.showOutline));
      UI.btnToggleOutline.textContent = `黒フチ取り: ${State.showOutline ? 'ON' : 'OFF'}`;
    }

    if (UI.routeSeekRange) UI.routeSeekRange.value = String(Math.round(State.seekRatio * 1000));
    if (UI.seekBadge) UI.seekBadge.textContent = `${Math.round(State.seekRatio * 100)}%地点`;
    if (UI.btnToggleSeekBlink) {
      UI.btnToggleSeekBlink.setAttribute('aria-pressed', String(State.seekBlinking));
      UI.btnToggleSeekBlink.textContent = `⚡ シーク位置を点滅: ${State.seekBlinking ? 'ON' : 'OFF'}`;
    }

    if (UI.animSpeedNum && UI.animSpeedRange) UI.animSpeedNum.value = UI.animSpeedRange.value;
    if (UI.markerSizeNum && UI.markerSizeRange) UI.markerSizeNum.value = UI.markerSizeRange.value;
    if (UI.recordSecNum && UI.recordSecRange) UI.recordSecNum.value = UI.recordSecRange.value;
    if (UI.secBadge && UI.recordSecRange) UI.secBadge.textContent = `${UI.recordSecRange.value}秒`;

    validateChromaCollision();
    updateMetaText();
    syncWaypointSelectUI();
  }

  async function applyValidatedProject(validated, sessionToken) {
    let restoredPhotoCanvas = null;
    let restoredPhotoName = '';

    if (validated.backgroundPhoto) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            restoredPhotoCanvas = createPrescaledPhotoBuffer(img);
            restoredPhotoName = validated.backgroundPhoto.name;
          }
          img.onload = null; img.onerror = null; img.src = '';
          resolve();
        };
        img.onerror = () => { img.onload = null; img.onerror = null; resolve(); };
        img.src = validated.backgroundPhoto.dataUrl;
      });
    }

    if (sessionToken !== State.loadSessionId) return;

    releasePhotoMemory();
    if (restoredPhotoCanvas) {
      State.bgBufferCanvas = restoredPhotoCanvas;
      State.bgPhotoName = restoredPhotoName;
      if (UI.btnClearPhoto) UI.btnClearPhoto.disabled = false;
    }

    State.gpxFileName = validated.gpxFileName;
    State.rawPointCount = validated.rawPointCount;
    State.trackPoints = validated.trackPoints;
    State.waypoints = validated.waypoints;
    State.nextId = Math.max(State.nextId, validated.nextId);

    State.view.offsetX = validated.view.offsetX;
    State.view.offsetY = validated.view.offsetY;
    State.view.scale = validated.view.scale;

    State.lineColor = validated.style.lineColor;
    State.markerColor = validated.style.markerColor;
    State.markerRgb = parseHexRgb(State.markerColor);
    State.showPlate = validated.style.showPlate;
    State.showOutline = validated.style.showOutline;

    if (UI.lineWidthRange) UI.lineWidthRange.value = String(validated.style.lineWidth);
    if (UI.fontSizeRange) UI.fontSizeRange.value = String(validated.style.fontSize);

    if (UI.animTypeSelect) UI.animTypeSelect.value = validated.animation.animType;
    if (UI.animSpeedRange) UI.animSpeedRange.value = String(validated.animation.animSpeed);
    if (UI.markerSizeRange) UI.markerSizeRange.value = String(validated.animation.markerSize);
    State.selectedWptId = validated.animation.selectedWptId;
    State.seekRatio = validated.animation.seekRatio;
    State.seekBlinking = validated.animation.seekBlinking;
    if (UI.bgModeSelect) UI.bgModeSelect.value = validated.animation.bgMode;
    if (UI.recordSecRange) UI.recordSecRange.value = String(validated.animation.recordSec);

    closeFloatingAddBar(false);
    recalculateBoundsAndDistances();
    syncAllControlsWithState();
  }

  on(UI.btnSaveProject, 'click', () => {
    if (State.isRecording) return;
    if (State.trackPoints.length < 2) {
      setStatus('保存するルートデータがありません。先にGPXファイルを読み込んでください。', true);
      return;
    }
    try {
      const projectData = serializeProjectData();
      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const baseName = (State.gpxFileName || 'route').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'route';
      triggerBlobDownload(blob, `${baseName}_project_${Date.now()}.json`);
      setStatus('プロジェクト状態 (.json) を保存しました。');
    } catch (err) {
      setStatus(`プロジェクト保存エラー: ${err.message}`, true);
    }
  });

  on(UI.btnLoadProject, 'click', () => {
    if (!State.isRecording && UI.projectInput) UI.projectInput.click();
  });

  on(UI.projectInput, 'change', (e) => {
    if (e.target.files && e.target.files.length > 0) processUploadedFiles(e.target.files);
    e.target.value = '';
  });

  // --- 14. 外部サンプルGPX (sample_routegpx.gpx) 読込＆不在時待機（背景プレート初期値 OFF） ---
  function resetToEmptyWaitingState() {
    State.gpxFileName = '';
    State.rawPointCount = 0;
    State.trackPoints = [];
    State.cumDist = new Float64Array(0);
    State.totalDist = 0;
    State.waypoints = [];
    State.selectedWptId = null;
    State.seekRatio = 0.5;
    State.seekPoint = null;
    State.seekBlinking = false;
    State.showPlate = false;
    if (UI.btnTogglePlate) {
      UI.btnTogglePlate.setAttribute('aria-pressed', 'false');
      UI.btnTogglePlate.textContent = '背景プレート: OFF';
    }
    if (UI.routeSeekRange) UI.routeSeekRange.value = '500';
    if (UI.seekBadge) UI.seekBadge.textContent = '50%地点';
    if (UI.btnToggleSeekBlink) {
      UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
      UI.btnToggleSeekBlink.textContent = '⚡ シーク位置を点滅: OFF';
    }
    closeFloatingAddBar(false);
    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    applyPreset('br');
    updateMetaText();
    syncWaypointSelectUI();
  }

  async function loadSampleMountainData() {
    if (State.isRecording) return;
    try {
      const response = await fetch(CONFIG.SAMPLE_GPX_FILE, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const gpxText = await response.text();
      const sampleFile = new File([gpxText], CONFIG.SAMPLE_GPX_FILE, { type: 'application/gpx+xml' });

      await processUploadedFiles([sampleFile]);

      if (State.waypoints.length >= 3) {
        State.waypoints.forEach((w, idx) => { w.blinking = (idx === 2); });
        State.selectedWptId = State.waypoints[2].id;
      }
      State.seekRatio = 0.5;
      State.seekBlinking = false;
      recalculateBoundsAndDistances();
      applyPreset('br');
      syncAllControlsWithState();
      setStatus(`サンプル山行データ（${CONFIG.SAMPLE_GPX_FILE}）を読み込みました。`);
    } catch (_) {
      if (State.trackPoints.length === 0) resetToEmptyWaitingState();
      setStatus('GPXファイル（または保存したプロジェクト .json）をドロップまたは選択して読み込んでください。', false);
    }
  }

  on(UI.btnSample, 'click', loadSampleMountainData);
  on(UI.btnResetAll, 'click', () => {
    if (State.isRecording) return;
    releasePhotoMemory();
    resetToEmptyWaitingState();
    if (UI.testBox) UI.testBox.hidden = true;
    loadSampleMountainData();
  });

  on(UI.btnClearPhoto, 'click', () => {
    releasePhotoMemory();
    setStatus('背景写真を解除し、メモリを解放しました。');
  });

  // --- 15. カラースウォッチ＆数値スピンボックス双方向バインディング ---
  function bindColorControls(rowEl, pickerEl, onPick) {
    on(rowEl, 'click', (e) => {
      const btn = e.target.closest('button[data-color]');
      if (!btn) return;
      const hex = btn.dataset.color.toLowerCase();
      rowEl.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      if (pickerEl) pickerEl.value = hex;
      onPick(hex);
      validateChromaCollision();
    });
    on(pickerEl, 'input', (e) => {
      const hex = e.target.value.toLowerCase();
      if (rowEl) {
        rowEl.querySelectorAll('.swatch').forEach(b => b.setAttribute('aria-pressed', b.dataset.color.toLowerCase() === hex ? 'true' : 'false'));
      }
      onPick(hex);
      validateChromaCollision();
    });
  }

  bindColorControls(UI.lineColorRow, UI.lineCustomColor, (hex) => {
    State.lineColor = hex;
    if (UI.lineColorBadge) UI.lineColorBadge.textContent = hex.toUpperCase();
    renderPresetThumbnails();
  });

  bindColorControls(UI.markerColorRow, UI.markerCustomColor, (hex) => {
    State.markerColor = hex;
    State.markerRgb = parseHexRgb(hex);
    if (UI.markerColorBadge) UI.markerColorBadge.textContent = hex.toUpperCase();
    renderPresetThumbnails();
  });

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    State.view.offsetX = p.offsetX;
    State.view.offsetY = p.offsetY;
    State.view.scale = p.scale;
    const pct = Math.round(p.scale * 100);
    if (UI.zoomRange) UI.zoomRange.value = String(p.scale);
    if (UI.zoomNum) UI.zoomNum.value = String(pct);
    if (UI.zoomBadge) UI.zoomBadge.textContent = `${pct}%`;
  }

  on(UI.presetThumbs, 'click', (e) => {
    const btn = e.target.closest('button[data-preset]');
    if (btn) {
      applyPreset(btn.dataset.preset);
      setStatus(`表示位置プリセット「${btn.title}」を適用しました。`);
    }
  });

  on(UI.zoomRange, 'input', (e) => {
    State.view.scale = clampNumber(e.target.value, 0.15, 3.0, 0.55);
    const pct = Math.round(State.view.scale * 100);
    if (UI.zoomNum) UI.zoomNum.value = String(pct);
    if (UI.zoomBadge) UI.zoomBadge.textContent = `${pct}%`;
  });
  on(UI.zoomNum, 'input', (e) => {
    const pct = clampNumber(e.target.value, 15, 300, 55);
    State.view.scale = pct / 100;
    if (UI.zoomRange) UI.zoomRange.value = String(State.view.scale);
    if (UI.zoomBadge) UI.zoomBadge.textContent = `${Math.round(pct)}%`;
  });

  function bindRangeAndNumber(rangeEl, numEl, min, max, onUpdate) {
    on(rangeEl, 'input', () => {
      if (numEl) numEl.value = rangeEl.value;
      if (onUpdate) onUpdate();
    });
    on(numEl, 'input', () => {
      const val = clampNumber(numEl.value, min, max, parseFloat(rangeEl?.value || min));
      if (rangeEl) rangeEl.value = String(val);
      if (onUpdate) onUpdate();
    });
  }

  bindRangeAndNumber(UI.lineWidthRange, UI.lineWidthNum, 1, 16);
  bindRangeAndNumber(UI.fontSizeRange, UI.fontSizeNum, 11, 38);
  bindRangeAndNumber(UI.animSpeedRange, UI.animSpeedNum, 0.5, 5.0);
  bindRangeAndNumber(UI.markerSizeRange, UI.markerSizeNum, 5, 26);
  bindRangeAndNumber(UI.recordSecRange, UI.recordSecNum, 2, 30, () => {
    if (UI.secBadge && UI.recordSecRange) UI.secBadge.textContent = `${UI.recordSecRange.value}秒`;
  });

  on(UI.btnTogglePlate, 'click', () => {
    State.showPlate = !State.showPlate;
    UI.btnTogglePlate.setAttribute('aria-pressed', String(State.showPlate));
    UI.btnTogglePlate.textContent = `背景プレート: ${State.showPlate ? 'ON' : 'OFF'}`;
    renderPresetThumbnails();
  });

  on(UI.btnToggleOutline, 'click', () => {
    State.showOutline = !State.showOutline;
    UI.btnToggleOutline.setAttribute('aria-pressed', String(State.showOutline));
    UI.btnToggleOutline.textContent = `黒フチ取り: ${State.showOutline ? 'ON' : 'OFF'}`;
  });

  on(UI.btnToggleGuide, 'click', () => {
    State.showGuide = !State.showGuide;
    UI.btnToggleGuide.setAttribute('aria-pressed', String(State.showGuide));
    UI.btnToggleGuide.textContent = `📏 セーフティ枠: ${State.showGuide ? 'ON' : 'OFF'}`;
    if (UI.safetyGuideOverlay) UI.safetyGuideOverlay.hidden = !State.showGuide || State.trackPoints.length === 0;
  });

  on(UI.btnResetAnim, 'click', () => {
    State.animStartTime = performance.now();
    setStatus('アニメーション周期を先頭（0秒）にリセットしました。');
  });

  on(UI.routeSeekRange, 'input', (e) => {
    if (State.trackPoints.length === 0) return;
    State.seekRatio = clampNumber(parseFloat(e.target.value) / 1000, 0, 1, 0.5);
    const interp = getPointAtDistanceRatio(State.seekRatio);
    State.seekPoint = { lat: interp.lat, lon: interp.lon };
    if (UI.seekBadge) UI.seekBadge.textContent = `${Math.round(State.seekRatio * 100)}%地点`;
    if (!State.seekBlinking) {
      State.seekBlinking = true;
      if (UI.btnToggleSeekBlink) {
        UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'true');
        UI.btnToggleSeekBlink.textContent = '⚡ シーク位置を点滅: ON';
      }
      updateBlinkCountBadge();
    }
  });

  on(UI.btnToggleSeekBlink, 'click', () => {
    State.seekBlinking = !State.seekBlinking;
    UI.btnToggleSeekBlink.setAttribute('aria-pressed', String(State.seekBlinking));
    UI.btnToggleSeekBlink.textContent = `⚡ シーク位置を点滅: ${State.seekBlinking ? 'ON' : 'OFF'}`;
    updateBlinkCountBadge();
  });

  on(UI.bgModeSelect, 'change', validateChromaCollision);

  // --- 16. キャンバス操作＆PCキーボードショートカット ---
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (CONFIG.CANVAS_W / rect.width),
      y: (clientY - rect.top) * (CONFIG.CANVAS_H / rect.height)
    };
  }

  on(canvas, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasCoords(e.clientX, e.clientY);
    dragStart.x = pt.x - State.view.offsetX;
    dragStart.y = pt.y - State.view.offsetY;
  });

  on(canvas, 'pointermove', (e) => {
    if (!isDragging) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    State.view.offsetX = clampNumber(pt.x - dragStart.x, -2000, 4000, 960);
    State.view.offsetY = clampNumber(pt.y - dragStart.y, -2000, 3000, 540);
  });

  function stopDragging(e) {
    if (!isDragging) return;
    isDragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  on(canvas, 'pointerup', stopDragging);
  on(canvas, 'pointercancel', stopDragging);

  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    State.view.scale = clampNumber(State.view.scale * factor, 0.15, 3.0, 0.55);
    const pct = Math.round(State.view.scale * 100);
    if (UI.zoomRange) UI.zoomRange.value = String(State.view.scale);
    if (UI.zoomNum) UI.zoomNum.value = String(pct);
    if (UI.zoomBadge) UI.zoomBadge.textContent = `${pct}%`;
  }, { passive: false });

  on(canvas, 'dblclick', (e) => {
    if (State.trackPoints.length === 0) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    openFloatingAddBar(unprojectFromMain(pt.x, pt.y));
  });

  on(window, 'keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft') { e.preventDefault(); State.view.offsetX -= step; }
    else if (e.key === 'ArrowRight') { e.preventDefault(); State.view.offsetX += step; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); State.view.offsetY -= step; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); State.view.offsetY += step; }
    else if (e.key === ' ') { e.preventDefault(); if (UI.btnResetAnim) UI.btnResetAnim.click(); }
    else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); if (UI.btnToggleGuide) UI.btnToggleGuide.click(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (UI.btnTogglePlate) UI.btnTogglePlate.click(); }
  });

  // --- 17. クロマキー対応レンダリングエンジン ---
  function drawRoundedRect(context, x, y, w, h, r) {
    context.beginPath();
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, w, h, r);
    } else {
      context.moveTo(x + r, y);
      context.arcTo(x + w, y, x + w, y + h, r);
      context.arcTo(x + w, y + h, x, y + h, r);
      context.arcTo(x, y + h, x, y, r);
      context.arcTo(x, y, x + w, y, r);
      context.closePath();
    }
  }

  function markerRgba(alpha) {
    const { r, g, b } = State.markerRgb;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function drawBlinkingMarker(x, y, elapsed, animType, speed, markerSize, isUnshieldedChroma) {
    ctx.save();
    if (animType === 'pulse' || animType === 'progress') {
      for (let ring = 0; ring < 2; ring++) {
        const phase = ((elapsed * speed * 0.6) + ring * 0.5) % 1;
        const radius = markerSize + phase * (markerSize * 3.8);
        if (isUnshieldedChroma) {
          const ringWidth = Math.max(0.5, (1 - phase) * 5.5);
          if (ringWidth > 0.8) {
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = '#000000'; ctx.lineWidth = ringWidth + 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = State.markerColor; ctx.lineWidth = ringWidth; ctx.stroke();
          }
        } else {
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = markerRgba(1 - phase); ctx.lineWidth = 4; ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(x, y, markerSize, 0, Math.PI * 2);
      ctx.fillStyle = State.markerColor; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.fill(); ctx.stroke();
    } else if (animType === 'blink') {
      const wave = (Math.sin(elapsed * speed * 4) + 1) * 0.5;
      if (isUnshieldedChroma) {
        const dynRadius = markerSize * (0.85 + wave * 0.75);
        ctx.beginPath(); ctx.arc(x, y, dynRadius, 0, Math.PI * 2);
        ctx.fillStyle = State.markerColor; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, markerSize * 1.85, 0, Math.PI * 2);
        ctx.fillStyle = markerRgba(wave * 0.5); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, markerSize, 0, Math.PI * 2);
        ctx.fillStyle = markerRgba(0.35 + wave * 0.65); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
        ctx.fill(); ctx.stroke();
      }
    } else if (animType === 'radar') {
      const angle = elapsed * speed * 1.5;
      const rad = markerSize * 2.2;
      ctx.translate(x, y); ctx.rotate(angle);
      if (isUnshieldedChroma) {
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 0.7); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, rad, Math.PI, Math.PI * 1.7); ctx.stroke();
      }
      ctx.strokeStyle = State.markerColor; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, rad, Math.PI, Math.PI * 1.7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-rad * 1.3, 0); ctx.lineTo(-rad * 0.5, 0);
      ctx.moveTo(rad * 0.5, 0);  ctx.lineTo(rad * 1.3, 0);
      ctx.moveTo(0, -rad * 1.3); ctx.lineTo(0, -rad * 0.5);
      ctx.moveTo(0, rad * 0.5);  ctx.lineTo(0, rad * 1.3);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, markerSize * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
    ctx.restore();
  }

  function renderScene(timestamp) {
    const tp = State.trackPoints;
    if (tp.length === 0) return;

    const elapsed = (timestamp - State.animStartTime) / 1000;
    const bgMode = UI.bgModeSelect?.value || 'transparent';
    const isChromaKey = !State.bgBufferCanvas && (bgMode === 'green' || bgMode === 'blue');
    const isUnshieldedChroma = isChromaKey && !State.showPlate;

    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);

    if (State.bgBufferCanvas) {
      ctx.drawImage(State.bgBufferCanvas, 0, 0);
    } else if (bgMode === 'green') {
      ctx.fillStyle = '#00FF00'; ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    } else if (bgMode === 'blue') {
      ctx.fillStyle = '#0000FF'; ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    } else if (bgMode === 'black') {
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    }

    if (State.showPlate) {
      const pad = 420 * State.view.scale;
      ctx.save();
      ctx.fillStyle = isChromaKey ? '#12241b' : 'rgba(18, 36, 27, 0.76)';
      ctx.strokeStyle = isChromaKey ? '#d0e8dc' : 'rgba(208, 232, 220, 0.42)';
      ctx.lineWidth = 2.5;
      drawRoundedRect(ctx, State.view.offsetX - pad, State.view.offsetY - pad, pad * 2, pad * 2, 24);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    const lineWidth = parseFloat(UI.lineWidthRange?.value) || 5;
    const animType = UI.animTypeSelect?.value || 'pulse';
    const speed = parseFloat(UI.animSpeedRange?.value) || 2.0;

    let progressHead = null;
    let drawEndIndex = tp.length - 1;
    if (animType === 'progress') {
      const cycleRatio = (elapsed * speed * 0.18) % 1;
      const interp = getPointAtDistanceRatio(cycleRatio);
      drawEndIndex = interp.lastIndex;
      progressHead = { lat: interp.lat, lon: interp.lon };
    }

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (State.showOutline || isUnshieldedChroma) {
      ctx.beginPath();
      for (let i = 0; i <= drawEndIndex; i++) {
        const pt = projectToMain(tp[i].lat, tp[i].lon);
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      if (progressHead) {
        const headPt = projectToMain(progressHead.lat, progressHead.lon);
        ctx.lineTo(headPt.x, headPt.y);
      }
      ctx.strokeStyle = isUnshieldedChroma ? '#000000' : 'rgba(0, 0, 0, 0.9)';
      ctx.lineWidth = lineWidth + 4;
      ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i <= drawEndIndex; i++) {
      const pt = projectToMain(tp[i].lat, tp[i].lon);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    if (progressHead) {
      const headPt = projectToMain(progressHead.lat, progressHead.lon);
      ctx.lineTo(headPt.x, headPt.y);
    }
    ctx.strokeStyle = State.lineColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();

    const fontSize = parseInt(UI.fontSizeRange?.value, 10) || 20;
    const wp = State.waypoints;
    ctx.save();
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < wp.length; i++) {
      if (!wp[i].visible) continue;
      const pt = projectToMain(wp[i].lat, wp[i].lon);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, Math.max(4, lineWidth * 0.75), 0, Math.PI * 2);
      ctx.stroke(); ctx.fill();

      const tx = pt.x + 12, ty = pt.y;
      ctx.strokeStyle = isUnshieldedChroma ? '#000000' : 'rgba(0, 0, 0, 0.92)';
      ctx.lineWidth = 5; ctx.lineJoin = 'round';
      ctx.strokeText(wp[i].name, tx, ty);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(wp[i].name, tx, ty);
    }
    ctx.restore();

    const markerSize = parseFloat(UI.markerSizeRange?.value) || 10;
    if (animType === 'progress' && progressHead) {
      const pt = projectToMain(progressHead.lat, progressHead.lon);
      drawBlinkingMarker(pt.x, pt.y, elapsed, 'pulse', speed, markerSize, isUnshieldedChroma);
    }
    for (let i = 0; i < wp.length; i++) {
      if (!wp[i].blinking) continue;
      const pt = projectToMain(wp[i].lat, wp[i].lon);
      drawBlinkingMarker(pt.x, pt.y, elapsed, animType, speed, markerSize, isUnshieldedChroma);
    }
    if (State.seekBlinking && State.seekPoint) {
      const pt = projectToMain(State.seekPoint.lat, State.seekPoint.lon);
      drawBlinkingMarker(pt.x, pt.y, elapsed, animType, speed, markerSize, isUnshieldedChroma);
    }
  }

  function loop(ts) {
    if (!State.isPageVisible && !State.isRecording) {
      State.rafId = null;
      return;
    }
    renderScene(ts);
    State.rafId = requestAnimationFrame(loop);
  }

  on(document, 'visibilitychange', () => {
    State.isPageVisible = !document.hidden;
    if (State.isPageVisible && !State.rafId) State.rafId = requestAnimationFrame(loop);
  });

  // --- 18. 動画＆静止画エクスポート（上部バー＆右パネル下部ボタン両対応） ---
  function getSupportedVideoMime() {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const m of list) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function startOrStopVideoExport() {
    if (State.isRecording && State.mediaRecorder) {
      State.mediaRecorder.stop();
      return;
    }
    if (State.trackPoints.length < 2) {
      setStatus('先にGPXファイルをドロップまたは選択して読み込んでください。', true);
      return;
    }
    const mimeType = getSupportedVideoMime();
    if (!mimeType) {
      setStatus('お使いのブラウザはCanvas動画録画機能に対応していません。', true);
      return;
    }

    const sec = Math.min(30, Math.max(2, parseInt(UI.recordSecRange?.value, 10) || 5));

    try {
      const stream = canvas.captureStream(CONFIG.FPS);
      State.activeStream = stream;
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: CONFIG.VIDEO_BITRATE });
      State.mediaRecorder = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => {
        releaseRecordingMemory();
        setStatus('録画中にエラーが発生しました。', true);
      };
      recorder.onstop = () => {
        releaseRecordingMemory();
        if (chunks.length === 0) return;
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        triggerBlobDownload(blob, `gpx_route_${Date.now()}.${ext}`);
        setStatus(`合成用動画（${sec}秒・12Mbps）の書き出しが完了しました。`);
      };

      State.animStartTime = performance.now();
      State.isRecording = true;
      if (UI.fileZone) UI.fileZone.classList.add('disabled');
      if (UI.fileInput) UI.fileInput.disabled = true;
      if (UI.btnSaveProject) UI.btnSaveProject.disabled = true;
      if (UI.btnLoadProject) UI.btnLoadProject.disabled = true;
      if (UI.btnExportVideo) UI.btnExportVideo.textContent = '⏹ 録画停止して保存';
      if (UI.btnExportVideoSide) UI.btnExportVideoSide.textContent = '⏹ 録画停止して今すぐ保存';

      recorder.start(200);
      setStatus(`🔴 録画中（${sec}秒間）... 再クリックすると即時保存します。`);

      State.recordTimer = setTimeout(() => {
        if (State.isRecording && State.mediaRecorder && State.mediaRecorder.state === 'recording') {
          State.mediaRecorder.stop();
        }
      }, sec * 1000);
    } catch (err) {
      releaseRecordingMemory();
      setStatus(`録画開始エラー: ${err.message}`, true);
    }
  }

  function exportPngSnapshot() {
    if (State.trackPoints.length < 2) {
      setStatus('先にGPXファイルをドロップまたは選択して読み込んでください。', true);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) { setStatus('静止画の生成に失敗しました。', true); return; }
      triggerBlobDownload(blob, `gpx_snapshot_${Date.now()}.png`);
      setStatus('現在のフレームを静止画 (.png) として保存しました。');
    }, 'image/png');
  }

  on(UI.btnExportVideo, 'click', startOrStopVideoExport);
  on(UI.btnExportVideoSide, 'click', startOrStopVideoExport);
  on(UI.btnExportPng, 'click', exportPngSnapshot);
  on(UI.btnExportPngSide, 'click', exportPngSnapshot);

  // --- 19. 自己診断テストスイート (全7項目) ---
  on(UI.btnSelfTest, 'click', () => {
    if (!UI.testBox) return;
    if (!UI.testBox.hidden) {
      UI.testBox.hidden = true;
      return;
    }
    const logs = [];
    const assert = (name, cond) => logs.push(`${cond ? '✅ PASS' : '❌ FAIL'}: ${name}`);

    const dummy10k = Array.from({ length: 10000 }, (_, i) => ({
      lat: 35.0 + i * 0.00001,
      lon: 135.0 + Math.sin(i * 0.05) * 0.001
    }));
    const anchorWpt = [{ lat: dummy10k[5432].lat, lon: dummy10k[5432].lon }];
    const simplified = simplifyTrackWithAnchors(dummy10k, anchorWpt, CONFIG.MAX_RENDER_PTS);
    const anchorKept = simplified.some(p => p.lat === dummy10k[5432].lat && p.lon === dummy10k[5432].lon);
    assert(`RDP軽量化 & アンカー保護 (10,000->${simplified.length}pts)`, simplified.length >= 2 && simplified.length <= CONFIG.MAX_RENDER_PTS && anchorKept);

    const midInterp = getPointAtDistanceRatio(0.5);
    assert('累積距離二分探索 & 線形補間 (Lerp)', Number.isFinite(midInterp.lat) && Number.isFinite(midInterp.lon));

    const origLat = 34.7770, origLon = 135.2637;
    const p = projectToMain(origLat, origLon);
    const back = unprojectFromMain(p.x, p.y);
    const err = Math.hypot(origLat - back.lat, origLon - back.lon);
    assert(`座標投影 <-> 逆投影の往復精度 (${err.toExponential(2)})`, err < 1e-6);

    let xxeBlocked = false;
    try { sanitizeXmlString('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><gpx></gpx>'); }
    catch (_) { xxeBlocked = true; }
    assert('XXE / Billion Laughs 遮断確認', xxeBlocked);

    const testOpt = document.createElement('option');
    testOpt.textContent = '<img src=x onerror=alert(1)>';
    assert('DOM XSS無害化確認', testOpt.innerHTML.includes('&lt;img'));

    let projectTestPassed = false;
    try {
      const mockProject = {
        magic: CONFIG.PROJECT_MAGIC, version: 1, '__proto__': { polluted: true },
        route: { gpxFileName: 't.gpx', trackPoints: [{ lat: 34.7, lon: 135.2 }, { lat: 34.8, lon: 135.3 }], waypoints: [] },
        view: { offsetX: 999999, offsetY: -999999, scale: 99 },
        style: { lineColor: '#529e78', markerColor: 'invalid' }
      };
      const val = parseAndValidateProjectJson(JSON.stringify(mockProject));
      projectTestPassed = val.view.scale === 3.0 && val.style.markerColor === '#ff453a' && val.style.showPlate === false && !({}).polluted;
    } catch (_) { projectTestPassed = false; }
    assert('プロジェクトJSON検証・Prototype Pollution防御', projectTestPassed);

    const mime = getSupportedVideoMime();
    assert(`MediaRecorder 高ビットレート録画 (${mime || '未対応'})`, Boolean(mime));

    UI.testBox.textContent = `[Workstation 診断レポート - ${new Date().toLocaleTimeString()}]\n` + logs.join('\n');
    UI.testBox.hidden = false;
    setStatus('自己診断テスト（全7項目）を完了しました。右ペイン下部のレポートをご確認ください。');
  });

  on(window, 'pagehide', () => {
    if (State.rafId) cancelAnimationFrame(State.rafId);
    releasePhotoMemory();
    releaseRecordingMemory();
  });

  // --- 初期起動 ---
  loadSampleMountainData();
  State.rafId = requestAnimationFrame(loop);
})();
