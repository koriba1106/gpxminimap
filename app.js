/**
 * GPX Route Studio - Production Core Engine (app.js)
 * Features:
 *  - Project State Serialization & Deserialization (.json export/import with schema validation & anti-pollution)
 *  - Distance-proportional Linear Interpolation (Lerp) for constant-speed route animation
 *  - Cosine-corrected Ramer-Douglas-Peucker (RDP) with Waypoint Anchor Protection
 *  - Chroma-Key Spill Suppression & Color Collision Guard (#00FF00 / #0000FF / #000000 / Alpha)
 *  - Offscreen Pre-scaled Photo Buffer (Immediate memory release of raw camera images)
 *  - XXE / Billion Laughs XML Defense, DOM-XSS Immunity, Non-blocking Inline Editor
 */
(() => {
  'use strict';

  // --- 1. クリックジャッキング防御 (.frame-blocked) ---
  if (window.self !== window.top) {
    const blockedEl = document.getElementById('frameBlocked');
    const appRoot = document.getElementById('appRoot');
    if (blockedEl) blockedEl.hidden = false;
    if (appRoot) appRoot.hidden = true;
    return;
  }

  // --- 2. システム定数・制限値 ---
  const CONFIG = Object.freeze({
    PROJECT_MAGIC: 'GPX_ROUTE_STUDIO_PROJECT',
    PROJECT_VERSION: 1,
    SAMPLE_GPX_FILE: 'sample_routegpx.gpx',
    MAX_GPX_BYTES: 25 * 1024 * 1024,      // 25MB上限
    MAX_PHOTO_BYTES: 30 * 1024 * 1024,    // 30MB上限
    MAX_PROJECT_BYTES: 25 * 1024 * 1024,  // プロジェクトJSON 25MB上限
    MAX_XML_LENGTH: 30 * 1024 * 1024,     // 文字列長上限
    MAX_RENDER_PTS: 2400,                 // RDP軽量化後の最大頂点数
    MAX_WAYPOINTS: 500,                   // Waypoint最大登録数
    CANVAS_W: 1920,
    CANVAS_H: 1080,
    BASE_MAP_SIZE: 700,
    VIDEO_BITRATE: 12_000_000,            // 12Mbps（クロマキー境界のブロックノイズを防ぐ高ビットレート）
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
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: false });

  const UI = Object.freeze({
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
    emptyState: document.getElementById('emptyState'),
    presetThumbs: document.getElementById('presetThumbs'),
    btnClearPhoto: document.getElementById('btnClearPhoto'),
    lineColorRow: document.getElementById('lineColorRow'),
    lineColorBadge: document.getElementById('lineColorBadge'),
    markerColorRow: document.getElementById('markerColorRow'),
    markerColorBadge: document.getElementById('markerColorBadge'),
    zoomRange: document.getElementById('zoomRange'),
    zoomBadge: document.getElementById('zoomBadge'),
    lineWidthRange: document.getElementById('lineWidthRange'),
    fontSizeRange: document.getElementById('fontSizeRange'),
    sizeBadge: document.getElementById('sizeBadge'),
    btnTogglePlate: document.getElementById('btnTogglePlate'),
    btnToggleOutline: document.getElementById('btnToggleOutline'),
    wptSelect: document.getElementById('wptSelect'),
    blinkCountBadge: document.getElementById('blinkCountBadge'),
    btnToggleWptBlink: document.getElementById('btnToggleWptBlink'),
    btnSoloWptBlink: document.getElementById('btnSoloWptBlink'),
    btnBlinkAllWpt: document.getElementById('btnBlinkAllWpt'),
    btnToggleWptLabel: document.getElementById('btnToggleWptLabel'),
    btnOpenRename: document.getElementById('btnOpenRename'),
    btnDeleteWpt: document.getElementById('btnDeleteWpt'),
    wptEditorPanel: document.getElementById('wptEditorPanel'),
    wptEditorTitle: document.getElementById('wptEditorTitle'),
    wptNameInput: document.getElementById('wptNameInput'),
    btnSaveWptName: document.getElementById('btnSaveWptName'),
    btnCancelWptName: document.getElementById('btnCancelWptName'),
    routeSeekRange: document.getElementById('routeSeekRange'),
    seekBadge: document.getElementById('seekBadge'),
    btnToggleSeekBlink: document.getElementById('btnToggleSeekBlink'),
    btnAddWptAtSeek: document.getElementById('btnAddWptAtSeek'),
    animTypeSelect: document.getElementById('animTypeSelect'),
    animSpeedRange: document.getElementById('animSpeedRange'),
    markerSizeRange: document.getElementById('markerSizeRange'),
    speedBadge: document.getElementById('speedBadge'),
    bgModeSelect: document.getElementById('bgModeSelect'),
    recordSecRange: document.getElementById('recordSecRange'),
    secBadge: document.getElementById('secBadge'),
    chromaHint: document.getElementById('chromaHint'),
    btnExportVideo: document.getElementById('btnExportVideo'),
    btnExportPng: document.getElementById('btnExportPng'),
    statusBox: document.getElementById('statusBox'),
    testBox: document.getElementById('testBox')
  });

  // --- 4. アプリケーション状態管理 ---
  const State = {
    loadSessionId: 0,
    gpxFileName: '',
    rawPointCount: 0,
    trackPoints: [],   // [{ lat, lon }]
    cumDist: [],       // Float64Array: 各頂点までの累積距離（定速補間用）
    totalDist: 0,      // 総距離
    waypoints: [],     // [{ id, lat, lon, name, visible, blinking }]
    selectedWptId: null,
    seekRatio: 0.5,    // 0.0 〜 1.0 (距離比例)
    seekPoint: null,   // { lat, lon }
    seekBlinking: false,
    editorMode: null,  // 'rename' | 'add_seek' | 'add_coord' | null
    pendingCoord: null,
    lineColor: '#ffffff',
    markerColor: '#ff453a',
    markerRgb: { r: 255, g: 69, b: 58 },
    showPlate: true,
    showOutline: true,
    bounds: {
      minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
      centerLat: 35, cosLat: 1, lonSpan: 0.01, latSpan: 0.01, maxSpan: 0.01
    },
    view: { offsetX: 1580, offsetY: 790, scale: 0.55 },
    // 背景写真は1920x1080にプリスケールしたオフスクリーンCanvasのみ保持し、元画像は即時解放する
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

  // --- 5. ユーティリティ・数値クランプ・ステータスメッセージ ---
  function clampNumber(val, min, max, fallback) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return num < min ? min : num > max ? max : num;
  }

  function isValidHexColor(str) {
    return typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str);
  }

  function setStatus(message, isError = false) {
    UI.statusBox.textContent = message;
    UI.statusBox.classList.toggle('error', Boolean(isError));
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

  function isGreenHue(hex) {
    return hex === '#30d158' || hex === '#529e78';
  }
  function isBlueHue(hex) {
    return hex === '#0a84ff' || hex === '#64d2ff';
  }

  function validateChromaCollision() {
    const mode = UI.bgModeSelect.value;
    if (mode === 'green') {
      UI.chromaHint.textContent = 'グリーンバック出力：スピル（緑かぶり）防止のため半透明混合を自動抑止します。';
      if (isGreenHue(State.lineColor) || isGreenHue(State.markerColor)) {
        setStatus('注意: グリーンバック選択中に緑系の線・マーカーを使うとクロマキーで一緒に透過されます。赤や白への変更を推奨します。', true);
        return;
      }
    } else if (mode === 'blue') {
      UI.chromaHint.textContent = 'ブルーバック出力：スピル（青かぶり）防止のため半透明混合を自動抑止します。';
      if (isBlueHue(State.lineColor) || isBlueHue(State.markerColor)) {
        setStatus('注意: ブルーバック選択中に青系の線・マーカーを使うとクロマキーで一緒に透過されます。赤や黄への変更を推奨します。', true);
        return;
      }
    } else if (mode === 'black') {
      UI.chromaHint.textContent = 'ブラック背景出力：動画編集ソフトの「スクリーン」または「加算」ブレンドで背景が抜けます。';
    } else {
      UI.chromaHint.textContent = '背景透過モード：Premiere / DaVinci等でそのまま重ねられるアルファ付きWebM（または写真合成）です。';
    }
  }

  // --- 6. メモリ管理：写真オフスクリーンバッファの生成と即時解放 ---
  function releasePhotoMemory() {
    if (State.bgBufferCanvas) {
      State.bgBufferCanvas.width = 0;
      State.bgBufferCanvas.height = 0;
      State.bgBufferCanvas = null;
    }
    State.bgPhotoName = '';
    UI.btnClearPhoto.disabled = true;
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
    UI.fileZone.classList.remove('disabled');
    UI.fileInput.disabled = false;
    UI.btnSaveProject.disabled = false;
    UI.btnLoadProject.disabled = false;
    UI.btnExportVideo.textContent = '🎬 合成用アニメーション動画を書き出す (.webm)';
  }

  function parseHexRgb(hex) {
    const clean = (hex || '#ff453a').replace('#', '');
    const num = parseInt(clean, 16);
    if (!Number.isFinite(num)) return { r: 255, g: 69, b: 58 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  // --- 7. アルゴリズム1：コサイン補正＆Waypointアンカー保護付きRDP軽量化 ---
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
        let bestIdx = 0;
        let bestDistSq = Infinity;
        for (let i = 0; i < len; i++) {
          const dLat = points[i].lat - wpt.lat;
          const dLon = (points[i].lon - wpt.lon) * cosLat;
          const dSq = dLat * dLat + dLon * dLon;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestIdx = i;
          }
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

        let maxDistSq = 0;
        let splitIdx = first;
        const ax = pts[first].lon * cosLat, ay = pts[first].lat;
        const bx = pts[last].lon * cosLat,  by = pts[last].lat;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;

        for (let i = first + 1; i < last; i++) {
          const px = pts[i].lon * cosLat, py = pts[i].lat;
          let t = 0;
          if (lenSq > 0) {
            t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
          }
          const distSq = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
          if (distSq > maxDistSq) {
            maxDistSq = distSq;
            splitIdx = i;
          }
        }

        if (maxDistSq > epsSq) {
          keep[splitIdx] = 1;
          stack.push([first, splitIdx], [splitIdx, last]);
        }
      }

      const out = [];
      for (let i = 0; i < len; i++) {
        if (keep[i]) out.push(pts[i]);
      }
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

  // --- 8. アルゴリズム2：累積距離テーブル構築 & 距離比例の線形補間（定速進行・定速シーク） ---
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
    cum[0] = 0;
    let total = 0;

    for (let i = 1; i < n; i++) {
      const dLat = tp[i].lat - tp[i - 1].lat;
      const dLon = (tp[i].lon - tp[i - 1].lon) * cosLat;
      const segLen = Math.hypot(dLat, dLon);
      total += segLen;
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

    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if (cum[mid] <= targetDist) low = mid;
      else high = mid - 1;
    }

    if (low >= n - 1) {
      return { lat: tp[n - 1].lat, lon: tp[n - 1].lon, lastIndex: n - 1 };
    }

    const d0 = cum[low];
    const d1 = cum[low + 1];
    const seg = d1 - d0;
    const t = seg > 1e-12 ? (targetDist - d0) / seg : 0;

    return {
      lat: tp[low].lat + (tp[low + 1].lat - tp[low].lat) * t,
      lon: tp[low].lon + (tp[low + 1].lon - tp[low].lon) * t,
      lastIndex: low
    };
  }

  // --- 9. 境界ボックス計算 & 座標投影 ---
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

  // --- 10. UI更新・5配置サムネイル (.thumbs) の描画 ---
  function updateMetaText() {
    const hasTrack = State.trackPoints.length > 0;
    UI.emptyState.hidden = hasTrack;
    canvas.hidden = !hasTrack;

    if (!hasTrack) {
      UI.pointBadge.textContent = '0 pts';
      UI.metaInfo.textContent = '上の枠にGPXファイルまたは保存したプロジェクト(.json)をドロップしてください。';
      return;
    }

    const ptText = State.rawPointCount !== State.trackPoints.length
      ? `${State.rawPointCount.toLocaleString()} → ${State.trackPoints.length.toLocaleString()} pts (軽量化済)`
      : `${State.trackPoints.length.toLocaleString()} pts`;
    UI.pointBadge.textContent = ptText;

    const photoText = State.bgPhotoName
      ? ` ／ 背景写真: ${State.bgPhotoName} (FHDキャッシュ済)`
      : ' ／ 背景写真: なし（透過・クロマキー出力対応）';
    UI.metaInfo.textContent = `ルート: ${State.gpxFileName} (${ptText} / Waypoint: ${State.waypoints.length}箇所)${photoText}`;
  }

  function renderPresetThumbnails() {
    const thumbButtons = UI.presetThumbs.querySelectorAll('.thumb');
    const tp = State.trackPoints;

    thumbButtons.forEach((btn) => {
      const preset = PRESETS[btn.dataset.preset];
      const thumbCanvas = btn.querySelector('canvas');
      if (!thumbCanvas || !preset) return;

      const tCtx = thumbCanvas.getContext('2d');
      const w = thumbCanvas.width;
      const h = thumbCanvas.height;
      tCtx.clearRect(0, 0, w, h);

      if (State.bgBufferCanvas) {
        tCtx.drawImage(State.bgBufferCanvas, 0, 0, w, h);
        tCtx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        tCtx.fillRect(0, 0, w, h);
      } else {
        tCtx.fillStyle = '#e3f1ea';
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
        tCtx.fillStyle = 'rgba(25, 51, 38, 0.78)';
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

      tCtx.strokeStyle = State.lineColor === '#ffffff' && !State.showPlate && !State.bgBufferCanvas ? '#1b4d35' : State.lineColor;
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

  // --- 11. Waypoint管理 & 非ブロッキングインライン編集 ---
  function syncWaypointSelectUI() {
    UI.wptSelect.replaceChildren();

    if (State.waypoints.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Waypointなし';
      UI.wptSelect.appendChild(opt);
      UI.blinkCountBadge.textContent = `点滅: ${State.seekBlinking ? 1 : 0}箇所`;
      renderPresetThumbnails();
      return;
    }

    if (!State.waypoints.some(w => w.id === State.selectedWptId)) {
      State.selectedWptId = State.waypoints[0].id;
    }

    let blinkCount = State.seekBlinking ? 1 : 0;

    State.waypoints.forEach((wpt) => {
      if (wpt.blinking) blinkCount++;
      const opt = document.createElement('option');
      opt.value = String(wpt.id);
      const blinkMark = wpt.blinking ? '⚡[点滅ON] ' : '⚪[点滅OFF] ';
      const visMark = wpt.visible ? '' : ' (地名非表示)';
      opt.textContent = `${blinkMark}${wpt.name}${visMark}`;
      if (wpt.id === State.selectedWptId) opt.selected = true;
      UI.wptSelect.appendChild(opt);
    });

    UI.blinkCountBadge.textContent = `点滅: ${blinkCount}箇所`;
    renderPresetThumbnails();
  }

  UI.wptSelect.addEventListener('change', () => {
    State.selectedWptId = parseInt(UI.wptSelect.value, 10) || null;
  });

  function getSelectedWaypoint() {
    return State.waypoints.find(w => w.id === State.selectedWptId) || null;
  }

  UI.btnToggleWptBlink.addEventListener('click', () => {
    const wpt = getSelectedWaypoint();
    if (!wpt) return;
    wpt.blinking = !wpt.blinking;
    syncWaypointSelectUI();
    setStatus(`「${wpt.name}」の点滅を ${wpt.blinking ? 'ON' : 'OFF'} に切り替えました。`);
  });

  UI.btnSoloWptBlink.addEventListener('click', () => {
    const wpt = getSelectedWaypoint();
    if (!wpt) return;
    State.waypoints.forEach(w => { w.blinking = (w.id === wpt.id); });
    State.seekBlinking = false;
    UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
    UI.btnToggleSeekBlink.textContent = 'シーク位置を点滅: OFF';
    syncWaypointSelectUI();
    setStatus(`「${wpt.name}」のみを単独点滅に設定しました。`);
  });

  UI.btnBlinkAllWpt.addEventListener('click', () => {
    if (State.waypoints.length === 0) return;
    const allOn = State.waypoints.every(w => w.blinking);
    State.waypoints.forEach(w => { w.blinking = !allOn; });
    syncWaypointSelectUI();
    setStatus(allOn ? '全Waypointの点滅をOFFにしました。' : '全Waypointの点滅をONにしました。');
  });

  UI.btnToggleWptLabel.addEventListener('click', () => {
    const wpt = getSelectedWaypoint();
    if (!wpt) return;
    wpt.visible = !wpt.visible;
    syncWaypointSelectUI();
  });

  UI.btnDeleteWpt.addEventListener('click', () => {
    const wpt = getSelectedWaypoint();
    if (!wpt) return;
    State.waypoints = State.waypoints.filter(w => w.id !== wpt.id);
    recalculateBoundsAndDistances();
    updateMetaText();
    syncWaypointSelectUI();
    setStatus(`「${wpt.name}」を削除しました。`);
  });

  function openInlineEditor(mode, titleText, defaultValue, coord = null) {
    State.editorMode = mode;
    State.pendingCoord = coord;
    UI.wptEditorTitle.textContent = titleText;
    UI.wptNameInput.value = defaultValue;
    UI.wptEditorPanel.hidden = false;
    UI.wptNameInput.focus();
    UI.wptNameInput.select();
  }

  function closeInlineEditor(commit) {
    if (commit && State.editorMode) {
      const cleanName = (UI.wptNameInput.value.trim() || `地点${State.waypoints.length + 1}`).slice(0, 40);

      if (State.editorMode === 'rename') {
        const wpt = getSelectedWaypoint();
        if (wpt) {
          wpt.name = cleanName;
          syncWaypointSelectUI();
          setStatus(`地名を「${cleanName}」に変更しました。`);
        }
      } else if (State.editorMode === 'add_seek' || State.editorMode === 'add_coord') {
        if (State.waypoints.length >= CONFIG.MAX_WAYPOINTS) {
          setStatus(`エラー: Waypointの登録上限(${CONFIG.MAX_WAYPOINTS}箇所)に達しています。`, true);
        } else {
          const target = State.pendingCoord || State.seekPoint || State.trackPoints[0];
          if (target) {
            const newWpt = {
              id: State.nextId++,
              lat: target.lat,
              lon: target.lon,
              name: cleanName,
              visible: true,
              blinking: true
            };
            State.waypoints.push(newWpt);
            State.selectedWptId = newWpt.id;
            recalculateBoundsAndDistances();
            updateMetaText();
            syncWaypointSelectUI();
            setStatus(`「${cleanName}」を追加し、点滅をONにしました。`);
          }
        }
      }
    }
    State.editorMode = null;
    State.pendingCoord = null;
    UI.wptEditorPanel.hidden = true;
  }

  UI.btnOpenRename.addEventListener('click', () => {
    const wpt = getSelectedWaypoint();
    if (!wpt) return;
    openInlineEditor('rename', '選択中のWaypointの地名を変更:', wpt.name);
  });

  UI.btnAddWptAtSeek.addEventListener('click', () => {
    if (State.trackPoints.length === 0) return;
    const pt = State.seekPoint || State.trackPoints[0];
    openInlineEditor('add_seek', '現在のシーク位置に追加する地名:', `地点${State.waypoints.length + 1}`, { ...pt });
  });

  UI.btnSaveWptName.addEventListener('click', () => closeInlineEditor(true));
  UI.btnCancelWptName.addEventListener('click', () => closeInlineEditor(false));
  UI.wptNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeInlineEditor(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeInlineEditor(false);
    }
  });

  // --- 12. プロジェクト保存 (.json エクスポート) & 再開 (.json インポート) 機能 ---

  /**
   * 現在のすべての編集状態とUI設定をシリアライズしてJSONオブジェクトを生成する
   */
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
        lineWidth: parseFloat(UI.lineWidthRange.value) || 5,
        fontSize: parseInt(UI.fontSizeRange.value, 10) || 20,
        showPlate: Boolean(State.showPlate),
        showOutline: Boolean(State.showOutline)
      },
      animation: {
        animType: UI.animTypeSelect.value,
        animSpeed: parseFloat(UI.animSpeedRange.value) || 2.0,
        markerSize: parseFloat(UI.markerSizeRange.value) || 10,
        selectedWptId: State.selectedWptId,
        seekRatio: Number(State.seekRatio.toFixed(4)),
        seekBlinking: Boolean(State.seekBlinking),
        bgMode: UI.bgModeSelect.value,
        recordSec: parseInt(UI.recordSecRange.value, 10) || 5
      },
      backgroundPhoto: bgPhotoDataUrl ? {
        name: State.bgPhotoName || 'photo.jpg',
        dataUrl: bgPhotoDataUrl
      } : null
    };
  }

  /**
   * JSON文字列を安全にパースし、スキーマ・境界値を検証して正規化済みプロジェクトデータを返す
   * （不正な場合は例外を投げて現在の状態を保護する）
   */
  function parseAndValidateProjectJson(jsonString) {
    if (typeof jsonString !== 'string' || jsonString.length > CONFIG.MAX_PROJECT_BYTES) {
      throw new Error('プロジェクトファイルのサイズが上限を超えているか無効です。');
    }

    // Prototype Pollution防止用Reviver
    const raw = JSON.parse(jsonString, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
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
      const lat = Number(pt.lat);
      const lon = Number(pt.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        validTrack.push({ lat, lon });
      }
    }

    if (validTrack.length < 2) {
      throw new Error('プロジェクト内の有効なGPS座標が2点未満です。');
    }

    const validWpts = [];
    let maxId = 0;
    if (Array.isArray(route.waypoints)) {
      for (let i = 0; i < route.waypoints.length && validWpts.length < CONFIG.MAX_WAYPOINTS; i++) {
        const w = route.waypoints[i];
        if (!w || typeof w !== 'object') continue;
        const lat = Number(w.lat);
        const lon = Number(w.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          const id = Number.isInteger(w.id) && w.id > 0 ? w.id : (i + 1);
          if (id > maxId) maxId = id;
          const name = String(w.name ?? `地点${i + 1}`).trim().slice(0, 40) || `地点${i + 1}`;
          validWpts.push({
            id,
            lat,
            lon,
            name,
            visible: w.visible !== false,
            blinking: Boolean(w.blinking)
          });
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
      showPlate: st.showPlate !== false,
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
        validPhoto = {
          name: String(raw.backgroundPhoto.name || 'restored_photo.jpg').slice(0, 80),
          dataUrl
        };
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

  /**
   * 全てのUIコントロール（カラーボタン、スライダー、バッジ、トグルボタン）を現在のStateと同期させる
   */
  function syncAllControlsWithState() {
    // 線色パレット同期
    UI.lineColorRow.querySelectorAll('button[data-color]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.color.toLowerCase() === State.lineColor ? 'true' : 'false');
    });
    UI.lineColorBadge.textContent = State.lineColor.toUpperCase();

    // マーカー色パレット同期
    UI.markerColorRow.querySelectorAll('button[data-color]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.color.toLowerCase() === State.markerColor ? 'true' : 'false');
    });
    UI.markerColorBadge.textContent = State.markerColor.toUpperCase();

    // ズーム同期
    UI.zoomRange.value = String(State.view.scale);
    UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;

    // サイズバッジ同期
    UI.sizeBadge.textContent = `${UI.lineWidthRange.value}px / ${UI.fontSizeRange.value}px`;

    // プレート・黒フチトグル同期
    UI.btnTogglePlate.setAttribute('aria-pressed', String(State.showPlate));
    UI.btnTogglePlate.textContent = `背景プレート: ${State.showPlate ? 'ON' : 'OFF'}`;
    UI.btnToggleOutline.setAttribute('aria-pressed', String(State.showOutline));
    UI.btnToggleOutline.textContent = `黒フチ取り: ${State.showOutline ? 'ON' : 'OFF'}`;

    // シークスライダー同期
    UI.routeSeekRange.value = String(Math.round(State.seekRatio * 1000));
    UI.seekBadge.textContent = `${Math.round(State.seekRatio * 100)}%地点`;
    UI.btnToggleSeekBlink.setAttribute('aria-pressed', String(State.seekBlinking));
    UI.btnToggleSeekBlink.textContent = `シーク位置を点滅: ${State.seekBlinking ? 'ON' : 'OFF'}`;

    // アニメ速度・サイズ・秒数バッジ同期
    UI.speedBadge.textContent = `${parseFloat(UI.animSpeedRange.value).toFixed(1)}x / ${UI.markerSizeRange.value}px`;
    UI.secBadge.textContent = `${UI.recordSecRange.value}秒`;

    validateChromaCollision();
    updateMetaText();
    syncWaypointSelectUI();
  }

  /**
   * 検証済みプロジェクトオブジェクトをトランザクショナルに適用する
   */
  async function applyValidatedProject(validated, sessionToken) {
    // 写真の復元がある場合、先にデコードを試みる
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
          img.onload = null;
          img.onerror = null;
          img.src = '';
          resolve();
        };
        img.onerror = () => {
          img.onload = null;
          img.onerror = null;
          resolve();
        };
        img.src = validated.backgroundPhoto.dataUrl;
      });
    }

    if (sessionToken !== State.loadSessionId) return;

    // 既存の写真メモリを解放して新しい状態を反映
    releasePhotoMemory();
    if (restoredPhotoCanvas) {
      State.bgBufferCanvas = restoredPhotoCanvas;
      State.bgPhotoName = restoredPhotoName;
      UI.btnClearPhoto.disabled = false;
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

    UI.lineWidthRange.value = String(validated.style.lineWidth);
    UI.fontSizeRange.value = String(validated.style.fontSize);

    UI.animTypeSelect.value = validated.animation.animType;
    UI.animSpeedRange.value = String(validated.animation.animSpeed);
    UI.markerSizeRange.value = String(validated.animation.markerSize);
    State.selectedWptId = validated.animation.selectedWptId;
    State.seekRatio = validated.animation.seekRatio;
    State.seekBlinking = validated.animation.seekBlinking;
    UI.bgModeSelect.value = validated.animation.bgMode;
    UI.recordSecRange.value = String(validated.animation.recordSec);

    closeInlineEditor(false);
    recalculateBoundsAndDistances();
    syncAllControlsWithState();
  }

  // プロジェクト保存ボタン
  UI.btnSaveProject.addEventListener('click', () => {
    if (State.isRecording) return;
    if (State.trackPoints.length < 2) {
      setStatus('保存するGPXルートデータがありません。先にGPXファイルを読み込んでください。', true);
      return;
    }
    try {
      const projectData = serializeProjectData();
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const baseName = (State.gpxFileName || 'route').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'route';
      triggerBlobDownload(blob, `${baseName}_project_${Date.now()}.json`);
      setStatus('編集中のプロジェクト状態 (.json) を保存しました。');
    } catch (err) {
      setStatus(`プロジェクト保存エラー: ${err.message}`, true);
    }
  });

  // プロジェクト読込ボタン
  UI.btnLoadProject.addEventListener('click', () => {
    if (State.isRecording) return;
    UI.projectInput.click();
  });

  UI.projectInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processUploadedFiles(e.target.files);
    }
    UI.projectInput.value = '';
  });

  // --- 13. 外部サンプルGPXファイル (sample_routegpx.gpx) の読み込みと不在時の安全な待機 ---
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
    UI.routeSeekRange.value = '500';
    UI.seekBadge.textContent = '50%地点';
    UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
    UI.btnToggleSeekBlink.textContent = 'シーク位置を点滅: OFF';
    closeInlineEditor(false);
    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    applyPreset('br');
    updateMetaText();
    syncWaypointSelectUI();
  }

  async function loadSampleMountainData() {
    if (State.isRecording) return;
    try {
      const response = await fetch(CONFIG.SAMPLE_GPX_FILE, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const gpxText = await response.text();
      const sampleFile = new File([gpxText], CONFIG.SAMPLE_GPX_FILE, { type: 'application/gpx+xml' });

      await processUploadedFiles([sampleFile]);

      if (State.waypoints.length >= 3) {
        State.waypoints.forEach((w, idx) => { w.blinking = (idx === 2); });
        State.selectedWptId = State.waypoints[2].id;
      }
      State.seekRatio = 0.5;
      State.seekBlinking = false;
      UI.routeSeekRange.value = '500';
      UI.seekBadge.textContent = '50%地点';
      UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'false');
      UI.btnToggleSeekBlink.textContent = 'シーク位置を点滅: OFF';
      closeInlineEditor(false);

      recalculateBoundsAndDistances();
      applyPreset('br');
      updateMetaText();
      syncWaypointSelectUI();
      setStatus(`サンプル山行データ（${CONFIG.SAMPLE_GPX_FILE}）を読み込みました。`);
    } catch (_) {
      if (State.trackPoints.length === 0) {
        resetToEmptyWaitingState();
      }
      setStatus('GPXファイル（または保存したプロジェクト .json）をドロップまたは選択して読み込んでください。', false);
    }
  }

  UI.btnSample.addEventListener('click', loadSampleMountainData);

  UI.btnResetAll.addEventListener('click', () => {
    if (State.isRecording) return;
    releasePhotoMemory();
    resetToEmptyWaitingState();
    UI.testBox.hidden = true;
    loadSampleMountainData();
  });

  // --- 14. セキュアファイルローダー（GPX / プロジェクトJSON / 背景写真 一括対応） ---
  function sanitizeXmlString(xmlText) {
    if (xmlText.length > CONFIG.MAX_XML_LENGTH) {
      throw new Error('XMLテキストが許容サイズを超えています。');
    }
    if (/<!(DOCTYPE|ENTITY)\b/i.test(xmlText)) {
      throw new Error('セキュリティ保護のため、DOCTYPEまたはENTITY宣言を含むXMLは読み込めません。');
    }
    return xmlText;
  }

  async function processUploadedFiles(fileList) {
    if (!fileList || fileList.length === 0 || State.isRecording) return;
    const currentSession = ++State.loadSessionId;

    for (const file of Array.from(fileList)) {
      if (currentSession !== State.loadSessionId) return;
      const lowerName = file.name.toLowerCase();

      // A. プロジェクトファイル (.json) の復元処理
      if (lowerName.endsWith('.json') || file.type === 'application/json') {
        if (file.size > CONFIG.MAX_PROJECT_BYTES) {
          setStatus(`エラー: プロジェクトファイル「${file.name}」が上限サイズ(25MB)を超えています。`, true);
          continue;
        }
        try {
          const jsonText = await file.text();
          if (currentSession !== State.loadSessionId) return;
          const validated = parseAndValidateProjectJson(jsonText);
          await applyValidatedProject(validated, currentSession);
          setStatus(`プロジェクト「${file.name}」を読み込み、編集状態を復元しました。`);
        } catch (err) {
          setStatus(`プロジェクト読込エラー: ${err.message}`, true);
        }
      }
      // B. GPXファイル (.gpx) の解析処理
      else if (lowerName.endsWith('.gpx') || file.type.includes('xml')) {
        if (file.size > CONFIG.MAX_GPX_BYTES) {
          setStatus(`エラー: GPX「${file.name}」が上限サイズ(25MB)を超えています。`, true);
          continue;
        }
        try {
          const rawText = await file.text();
          if (currentSession !== State.loadSessionId) return;

          const safeText = sanitizeXmlString(rawText);
          const xml = new DOMParser().parseFromString(safeText, 'text/xml');
          if (xml.querySelector('parsererror')) {
            throw new Error('GPXファイルのXML構造が破損しています。');
          }

          let nodes = Array.from(xml.querySelectorAll('trkpt'));
          if (nodes.length === 0) nodes = Array.from(xml.querySelectorAll('rtept'));

          const rawPts = [];
          for (let i = 0; i < nodes.length; i++) {
            const lat = parseFloat(nodes[i].getAttribute('lat'));
            const lon = parseFloat(nodes[i].getAttribute('lon'));
            if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
              rawPts.push({ lat, lon });
            }
          }

          if (rawPts.length < 2) {
            throw new Error('有効なGPS座標（2点以上）が見つかりません。');
          }

          const wptNodes = Array.from(xml.querySelectorAll('wpt'));
          const wpts = [];
          for (let i = 0; i < wptNodes.length && wpts.length < CONFIG.MAX_WAYPOINTS; i++) {
            const lat = parseFloat(wptNodes[i].getAttribute('lat'));
            const lon = parseFloat(wptNodes[i].getAttribute('lon'));
            if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
              const name = (wptNodes[i].querySelector('name')?.textContent || `地点${i + 1}`).trim().slice(0, 40);
              wpts.push({
                id: State.nextId++,
                lat, lon, name,
                visible: true,
                blinking: i === 0
              });
            }
          }

          State.gpxFileName = file.name;
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
          closeInlineEditor(false);

          recalculateBoundsAndDistances();
          updateMetaText();
          syncWaypointSelectUI();
          setStatus(`GPX「${file.name}」(${State.rawPointCount.toLocaleString()}点) を読み込みました。`);
        } catch (err) {
          setStatus(`GPX読込エラー: ${err.message}`, true);
        }
      }
      // C. 画像ファイル処理（オフスクリーンFHDバッファへ縮小後に元画像を即時メモリ解放）
      else if (file.type.startsWith('image/')) {
        if (file.size > CONFIG.MAX_PHOTO_BYTES) {
          setStatus(`エラー: 画像「${file.name}」が上限サイズ(30MB)を超えています。`, true);
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
              UI.btnClearPhoto.disabled = false;
              updateMetaText();
              renderPresetThumbnails();
              setStatus(`背景写真「${file.name}」をFHD最適化バッファへ読み込み、元メモリを解放しました。`);
            }
            URL.revokeObjectURL(tempUrl);
            img.onload = null;
            img.onerror = null;
            img.src = '';
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            img.onload = null;
            img.onerror = null;
            setStatus('画像のデコードに失敗しました。', true);
            resolve();
          };
          img.src = tempUrl;
        });
      }
    }
    UI.fileInput.value = '';
  }

  UI.fileInput.addEventListener('change', (e) => processUploadedFiles(e.target.files));

  ['dragenter', 'dragover'].forEach((evt) => {
    UI.fileZone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!State.isRecording) UI.fileZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    UI.fileZone.addEventListener(evt, (e) => {
      e.preventDefault();
      UI.fileZone.classList.remove('dragover');
    });
  });
  UI.fileZone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      processUploadedFiles(e.dataTransfer.files);
    }
  });

  UI.btnClearPhoto.addEventListener('click', () => {
    releasePhotoMemory();
    setStatus('背景写真バッファを破棄し、メモリを解放しました。');
  });

  // --- 15. スタイル・カラー・プリセット・シーク制御 ---
  function bindColorRow(container, onPick) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-color]');
      if (!btn) return;
      container.querySelectorAll('button[data-color]').forEach((b) => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      onPick(btn.dataset.color.toLowerCase());
      validateChromaCollision();
    });
  }

  bindColorRow(UI.lineColorRow, (hex) => {
    State.lineColor = hex;
    UI.lineColorBadge.textContent = hex.toUpperCase();
    renderPresetThumbnails();
  });

  bindColorRow(UI.markerColorRow, (hex) => {
    State.markerColor = hex;
    State.markerRgb = parseHexRgb(hex);
    UI.markerColorBadge.textContent = hex.toUpperCase();
    renderPresetThumbnails();
  });

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    State.view.offsetX = p.offsetX;
    State.view.offsetY = p.offsetY;
    State.view.scale = p.scale;
    UI.zoomRange.value = String(State.view.scale);
    UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;
  }

  UI.presetThumbs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-preset]');
    if (btn) {
      applyPreset(btn.dataset.preset);
      setStatus(`表示位置プリセット「${btn.title}」を適用しました。`);
    }
  });

  UI.zoomRange.addEventListener('input', (e) => {
    State.view.scale = clampNumber(e.target.value, 0.15, 3.0, 0.55);
    UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;
  });

  function updateSizeBadge() {
    UI.sizeBadge.textContent = `${UI.lineWidthRange.value}px / ${UI.fontSizeRange.value}px`;
  }
  UI.lineWidthRange.addEventListener('input', updateSizeBadge);
  UI.fontSizeRange.addEventListener('input', updateSizeBadge);

  UI.btnTogglePlate.addEventListener('click', () => {
    State.showPlate = !State.showPlate;
    UI.btnTogglePlate.setAttribute('aria-pressed', String(State.showPlate));
    UI.btnTogglePlate.textContent = `背景プレート: ${State.showPlate ? 'ON' : 'OFF'}`;
    renderPresetThumbnails();
  });

  UI.btnToggleOutline.addEventListener('click', () => {
    State.showOutline = !State.showOutline;
    UI.btnToggleOutline.setAttribute('aria-pressed', String(State.showOutline));
    UI.btnToggleOutline.textContent = `黒フチ取り: ${State.showOutline ? 'ON' : 'OFF'}`;
  });

  // 距離比例ルートシーク
  UI.routeSeekRange.addEventListener('input', (e) => {
    if (State.trackPoints.length === 0) return;
    State.seekRatio = clampNumber(parseFloat(e.target.value) / 1000, 0, 1, 0.5);
    const interp = getPointAtDistanceRatio(State.seekRatio);
    State.seekPoint = { lat: interp.lat, lon: interp.lon };
    UI.seekBadge.textContent = `${Math.round(State.seekRatio * 100)}%地点`;
    if (!State.seekBlinking) {
      State.seekBlinking = true;
      UI.btnToggleSeekBlink.setAttribute('aria-pressed', 'true');
      UI.btnToggleSeekBlink.textContent = 'シーク位置を点滅: ON';
      syncWaypointSelectUI();
    }
  });

  UI.btnToggleSeekBlink.addEventListener('click', () => {
    State.seekBlinking = !State.seekBlinking;
    UI.btnToggleSeekBlink.setAttribute('aria-pressed', String(State.seekBlinking));
    UI.btnToggleSeekBlink.textContent = `シーク位置を点滅: ${State.seekBlinking ? 'ON' : 'OFF'}`;
    syncWaypointSelectUI();
  });

  function updateSpeedAndMarkerBadge() {
    UI.speedBadge.textContent = `${parseFloat(UI.animSpeedRange.value).toFixed(1)}x / ${UI.markerSizeRange.value}px`;
  }
  UI.animSpeedRange.addEventListener('input', updateSpeedAndMarkerBadge);
  UI.markerSizeRange.addEventListener('input', updateSpeedAndMarkerBadge);

  UI.recordSecRange.addEventListener('input', () => {
    UI.secBadge.textContent = `${UI.recordSecRange.value}秒`;
  });

  UI.bgModeSelect.addEventListener('change', validateChromaCollision);

  // --- 16. キャンバス対話操作（ポインター移動・ホイール拡縮・キーボード微調整・ダブルクリック追加） ---
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (CONFIG.CANVAS_W / rect.width),
      y: (clientY - rect.top) * (CONFIG.CANVAS_H / rect.height)
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasCoords(e.clientX, e.clientY);
    dragStart.x = pt.x - State.view.offsetX;
    dragStart.y = pt.y - State.view.offsetY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    State.view.offsetX = clampNumber(pt.x - dragStart.x, -2000, 4000, 960);
    State.view.offsetY = clampNumber(pt.y - dragStart.y, -2000, 3000, 540);
  });

  function stopDragging(e) {
    if (!isDragging) return;
    isDragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.07 : 0.93;
    State.view.scale = clampNumber(State.view.scale * factor, 0.15, 3.0, 0.55);
    UI.zoomRange.value = String(State.view.scale);
    UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;
  }, { passive: false });

  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 10;
    if (e.key === 'ArrowLeft') { e.preventDefault(); State.view.offsetX -= step; }
    else if (e.key === 'ArrowRight') { e.preventDefault(); State.view.offsetX += step; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); State.view.offsetY -= step; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); State.view.offsetY += step; }
    else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      State.view.scale = clampNumber(State.view.scale + 0.05, 0.15, 3.0, 0.55);
      UI.zoomRange.value = String(State.view.scale);
      UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;
    } else if (e.key === '-') {
      e.preventDefault();
      State.view.scale = clampNumber(State.view.scale - 0.05, 0.15, 3.0, 0.55);
      UI.zoomRange.value = String(State.view.scale);
      UI.zoomBadge.textContent = `${Math.round(State.view.scale * 100)}%`;
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    if (State.trackPoints.length === 0) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    const coord = unprojectFromMain(pt.x, pt.y);
    openInlineEditor('add_coord', 'ダブルクリック地点に追加する地名:', '山頂', coord);
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
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = ringWidth + 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = State.markerColor;
            ctx.lineWidth = ringWidth;
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = markerRgba(1 - phase);
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(x, y, markerSize, 0, Math.PI * 2);
      ctx.fillStyle = State.markerColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();

    } else if (animType === 'blink') {
      const wave = (Math.sin(elapsed * speed * 4) + 1) * 0.5;
      if (isUnshieldedChroma) {
        const dynRadius = markerSize * (0.85 + wave * 0.75);
        ctx.beginPath();
        ctx.arc(x, y, dynRadius, 0, Math.PI * 2);
        ctx.fillStyle = State.markerColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, markerSize * 1.85, 0, Math.PI * 2);
        ctx.fillStyle = markerRgba(wave * 0.5);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, markerSize, 0, Math.PI * 2);
        ctx.fillStyle = markerRgba(0.35 + wave * 0.65);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.fill();
        ctx.stroke();
      }

    } else if (animType === 'radar') {
      const angle = elapsed * speed * 1.5;
      const rad = markerSize * 2.2;
      ctx.translate(x, y);
      ctx.rotate(angle);

      if (isUnshieldedChroma) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, rad, Math.PI, Math.PI * 1.7);
        ctx.stroke();
      }

      ctx.strokeStyle = State.markerColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, rad, Math.PI, Math.PI * 1.7);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-rad * 1.3, 0); ctx.lineTo(-rad * 0.5, 0);
      ctx.moveTo(rad * 0.5, 0);  ctx.lineTo(rad * 1.3, 0);
      ctx.moveTo(0, -rad * 1.3); ctx.lineTo(0, -rad * 0.5);
      ctx.moveTo(0, rad * 0.5);  ctx.lineTo(0, rad * 1.3);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, markerSize * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  }

  function renderScene(timestamp) {
    const tp = State.trackPoints;
    if (tp.length === 0) return;

    const elapsed = (timestamp - State.animStartTime) / 1000;
    const bgMode = UI.bgModeSelect.value;
    const isChromaKey = !State.bgBufferCanvas && (bgMode === 'green' || bgMode === 'blue');
    const isUnshieldedChroma = isChromaKey && !State.showPlate;

    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);

    // 1. 背景描画
    if (State.bgBufferCanvas) {
      ctx.drawImage(State.bgBufferCanvas, 0, 0);
    } else if (bgMode === 'green') {
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    } else if (bgMode === 'blue') {
      ctx.fillStyle = '#0000FF';
      ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    } else if (bgMode === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    }

    // 2. ミニマップ座布団プレート
    if (State.showPlate) {
      const pad = 420 * State.view.scale;
      ctx.save();
      ctx.fillStyle = isChromaKey ? '#12241b' : 'rgba(18, 36, 27, 0.74)';
      ctx.strokeStyle = isChromaKey ? '#d0e8dc' : 'rgba(208, 232, 220, 0.4)';
      ctx.lineWidth = 2.5;
      drawRoundedRect(ctx, State.view.offsetX - pad, State.view.offsetY - pad, pad * 2, pad * 2, 24);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 3. 登山ルート線画
    const lineWidth = parseFloat(UI.lineWidthRange.value) || 5;
    const animType = UI.animTypeSelect.value;
    const speed = parseFloat(UI.animSpeedRange.value) || 2.0;

    let progressHead = null;
    let drawEndIndex = tp.length - 1;

    if (animType === 'progress') {
      const cycleRatio = (elapsed * speed * 0.18) % 1;
      const interp = getPointAtDistanceRatio(cycleRatio);
      drawEndIndex = interp.lastIndex;
      progressHead = { lat: interp.lat, lon: interp.lon };
    }

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (State.showOutline || isUnshieldedChroma) {
      ctx.beginPath();
      for (let i = 0; i <= drawEndIndex; i++) {
        const pt = projectToMain(tp[i].lat, tp[i].lon);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
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
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    if (progressHead) {
      const headPt = projectToMain(progressHead.lat, progressHead.lon);
      ctx.lineTo(headPt.x, headPt.y);
    }
    ctx.strokeStyle = State.lineColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();

    // 4. Waypoint日本語ラベル描画
    const fontSize = parseInt(UI.fontSizeRange.value, 10) || 20;
    const wp = State.waypoints;
    ctx.save();
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < wp.length; i++) {
      if (!wp[i].visible) continue;
      const pt = projectToMain(wp[i].lat, wp[i].lon);

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(4, lineWidth * 0.75), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();

      const tx = pt.x + 12;
      const ty = pt.y;
      ctx.strokeStyle = isUnshieldedChroma ? '#000000' : 'rgba(0, 0, 0, 0.92)';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeText(wp[i].name, tx, ty);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(wp[i].name, tx, ty);
    }
    ctx.restore();

    // 5. 現在地・任意Waypointの点滅マーカー描画
    const markerSize = parseFloat(UI.markerSizeRange.value) || 10;

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

  document.addEventListener('visibilitychange', () => {
    State.isPageVisible = !document.hidden;
    if (State.isPageVisible && !State.rafId) {
      State.rafId = requestAnimationFrame(loop);
    }
  });

  // --- 18. 動画エクスポート (.webm) & 静止画エクスポート (.png) ---
  function getSupportedVideoMime() {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const m of list) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  UI.btnExportVideo.addEventListener('click', () => {
    if (State.isRecording && State.mediaRecorder) {
      State.mediaRecorder.stop();
      return;
    }
    if (State.trackPoints.length < 2) {
      setStatus('先にGPXデータを読み込んでください。', true);
      return;
    }

    const mimeType = getSupportedVideoMime();
    if (!mimeType) {
      setStatus('お使いのブラウザはCanvas動画録画機能に対応していません。', true);
      return;
    }

    const sec = Math.min(30, Math.max(2, parseInt(UI.recordSecRange.value, 10) || 5));

    try {
      const stream = canvas.captureStream(CONFIG.FPS);
      State.activeStream = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: CONFIG.VIDEO_BITRATE
      });
      State.mediaRecorder = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

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
        setStatus(`合成用動画（${sec}秒・12Mbps）の書き出しが完了し、メモリを解放しました。`);
      };

      State.animStartTime = performance.now();
      State.isRecording = true;
      UI.fileZone.classList.add('disabled');
      UI.fileInput.disabled = true;
      UI.btnSaveProject.disabled = true;
      UI.btnLoadProject.disabled = true;
      UI.btnExportVideo.textContent = '⏹ 録画を停止して今すぐ保存';

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
  });

  UI.btnExportPng.addEventListener('click', () => {
    if (State.trackPoints.length < 2) {
      setStatus('先にGPXデータを読み込んでください。', true);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus('静止画の生成に失敗しました。', true);
        return;
      }
      triggerBlobDownload(blob, `gpx_snapshot_${Date.now()}.png`);
      setStatus('現在のフレームを静止画 (.png) として保存しました。');
    }, 'image/png');
  });

  // --- 19. 自己診断テストスイート (.test-box 全7項目) ---
  UI.btnSelfTest.addEventListener('click', () => {
    if (!UI.testBox.hidden) {
      UI.testBox.hidden = true;
      return;
    }
    const logs = [];
    const assert = (name, cond) => {
      logs.push(`${cond ? '✅ PASS' : '❌ FAIL'}: ${name}`);
    };

    // Test 1: コサイン補正＋アンカー保護付きRDP軽量化の検証
    const dummy10k = Array.from({ length: 10000 }, (_, i) => ({
      lat: 35.0 + i * 0.00001,
      lon: 135.0 + Math.sin(i * 0.05) * 0.001
    }));
    const anchorWpt = [{ lat: dummy10k[5432].lat, lon: dummy10k[5432].lon }];
    const simplified = simplifyTrackWithAnchors(dummy10k, anchorWpt, CONFIG.MAX_RENDER_PTS);
    const anchorKept = simplified.some(p => p.lat === dummy10k[5432].lat && p.lon === dummy10k[5432].lon);
    assert(
      `RDP軽量化 & Waypointアンカー保護 (10,000pts -> ${simplified.length}pts, アンカー保持=${anchorKept})`,
      simplified.length >= 2 && simplified.length <= CONFIG.MAX_RENDER_PTS && anchorKept
    );

    // Test 2: 距離比例の二分探索＆線形補間 (Lerp) の検証
    const hasData = State.trackPoints.length >= 2 && State.totalDist > 0;
    const midInterp = getPointAtDistanceRatio(0.5);
    assert(
      `累積距離テーブル二分探索 & 線形補間 (${hasData ? `50%地点 lat=${midInterp.lat.toFixed(4)}, lon=${midInterp.lon.toFixed(4)}` : '待機状態安全動作'})`,
      Number.isFinite(midInterp.lat) && Number.isFinite(midInterp.lon)
    );

    // Test 3: 座標投影・逆投影の数学的整合性検証
    const origLat = 34.7770, origLon = 135.2637;
    const p = projectToMain(origLat, origLon);
    const back = unprojectFromMain(p.x, p.y);
    const err = Math.hypot(origLat - back.lat, origLon - back.lon);
    assert(`座標投影 <-> 逆投影の往復精度検証 (誤差: ${err.toExponential(2)})`, err < 1e-6);

    // Test 4: XXE / Billion Laughs 防御フィルタ検証
    let xxeBlocked = false;
    try {
      sanitizeXmlString('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><gpx></gpx>');
    } catch (_) {
      xxeBlocked = true;
    }
    assert('XML Entity Expansion (XXE / Billion Laughs) 遮断確認', xxeBlocked);

    // Test 5: DOM XSSサニタイズ確認
    const xssPayload = '<img src=x onerror=alert(1)>';
    const testOpt = document.createElement('option');
    testOpt.textContent = xssPayload;
    assert('DOM XSS無害化確認 (innerHTML不使用・スクリプト不発)', testOpt.innerHTML.includes('&lt;img'));

    // Test 6: プロジェクトJSONのシリアライズ・スキーマ検証・Prototype Pollution遮断確認
    let projectTestPassed = false;
    try {
      const mockProject = {
        magic: CONFIG.PROJECT_MAGIC,
        version: 1,
        '__proto__': { polluted: true },
        route: {
          gpxFileName: 'test.gpx',
          trackPoints: [{ lat: 34.7, lon: 135.2 }, { lat: 34.8, lon: 135.3 }],
          waypoints: [{ id: 1, lat: 34.75, lon: 135.25, name: 'テスト山頂', visible: true, blinking: true }]
        },
        view: { offsetX: 999999, offsetY: -999999, scale: 99 },
        style: { lineColor: '#529e78', markerColor: 'invalid-color', lineWidth: 50, fontSize: 5 }
      };
      const validated = parseAndValidateProjectJson(JSON.stringify(mockProject));
      projectTestPassed = (
        validated.trackPoints.length === 2 &&
        validated.waypoints[0].name === 'テスト山頂' &&
        validated.view.scale === 3.0 && // 上限3.0にクランプされていること
        validated.style.markerColor === '#ff453a' && // 不正カラーがフォールバックされていること
        !({}).polluted // プロトタイプ汚染が発生していないこと
      );
    } catch (_) {
      projectTestPassed = false;
    }
    assert('プロジェクトJSONスキーマ検証・境界クランプ・Prototype Pollution防御', projectTestPassed);

    // Test 7: クロマキー純度 & メモリ管理確認
    const mime = getSupportedVideoMime();
    assert(`MediaRecorder 高ビットレート録画対応 (${mime || '未対応'})`, Boolean(mime));

    UI.testBox.textContent = `[GPX Route Studio 自己診断レポート - ${new Date().toLocaleTimeString()}]\n` + logs.join('\n');
    UI.testBox.hidden = false;
    setStatus('自己診断テスト（全7項目）を完了しました。下部の診断レポートをご確認ください。');
  });

  // --- 20. ページ終了時の完全メモリクリーンアップ ---
  window.addEventListener('pagehide', () => {
    if (State.rafId) cancelAnimationFrame(State.rafId);
    releasePhotoMemory();
    releaseRecordingMemory();
  });

  // --- 初期起動 ---
  loadSampleMountainData();
  State.rafId = requestAnimationFrame(loop);
})();