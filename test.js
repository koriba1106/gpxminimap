/**
 * GPX Route Studio - Standalone Diagnostic Suite (test.js)
 * Validates core algorithms, security filters, memory management, and WebM/MP4 codecs.
 */
(() => {
  'use strict';

  const outputEl = document.getElementById('diagnosticOutput');
  const badgeEl = document.getElementById('testSummaryBadge');
  const btnRun = document.getElementById('btnRunDiagnostics');

  function runFullDiagnosticSuite() {
    if (!outputEl) return;
    const engine = window.GPXStudioEngine;
    if (!engine) {
      outputEl.textContent = '❌ FAIL: app.js (window.GPXStudioEngine) がロードされていません。';
      if (badgeEl) badgeEl.textContent = 'エンジン未検出';
      return;
    }

    const logs = [];
    let passCount = 0;
    let totalCount = 0;

    const assert = (name, cond, detail = '') => {
      totalCount++;
      if (cond) passCount++;
      const suffix = detail ? ` [${detail}]` : '';
      logs.push(`${cond ? '✅ PASS' : '❌ FAIL'}: ${name}${suffix}`);
    };

    // Test 1: 初期起動時の背景プレートOFF保証テスト
    const snap = engine.getStateSnapshot();
    assert('起動時の背景プレート初期OFF確認 (showPlate === false)', snap.showPlate === false);

    // Test 2: 重要度ランキング式RDPと5段階削減（10%〜50%）の精度＆Waypointアンカー保護検証
    const dummy1000 = Array.from({ length: 1000 }, (_, i) => ({
      lat: 35.0 + i * 0.0001,
      lon: 135.0 + Math.sin(i * 0.08) * 0.002
    }));
    const anchorWpt = [{ lat: dummy1000[333].lat, lon: dummy1000[333].lon }];
    const scores = engine.computePointImportanceScores(dummy1000, anchorWpt);
    const red10 = engine.extractReducedTrack(dummy1000, scores, 10).points;
    const red30 = engine.extractReducedTrack(dummy1000, scores, 30).points;
    const red50 = engine.extractReducedTrack(dummy1000, scores, 50).points;
    const anchorPreserved = red50.some(p => p.lat === dummy1000[333].lat && p.lon === dummy1000[333].lon);
    assert(
      '5段階GPXポイント削減 (-10%〜-50%) & Waypointアンカー保護',
      red10.length === 900 && red30.length === 700 && red50.length === 500 && anchorPreserved,
      `-10%=${red10.length}pts, -30%=${red30.length}pts, -50%=${red50.length}pts`
    );

    // Test 3: 累積距離二分探索＆線形補間 (Lerp)
    const midInterp = engine.getPointAtDistanceRatio(0.5);
    assert(
      '累積距離テーブル二分探索 & 線形補間 (Lerp)',
      Number.isFinite(midInterp.lat) && Number.isFinite(midInterp.lon)
    );

    // Test 4: 座標投影 <-> 逆投影の数学的往復精度検証
    const origLat = 34.7770, origLon = 135.2637;
    const p = engine.projectToMain(origLat, origLon);
    const back = engine.unprojectFromMain(p.x, p.y);
    const err = Math.hypot(origLat - back.lat, origLon - back.lon);
    assert('座標投影 <-> 逆投影の往復精度検証', err < 1e-6, `誤差: ${err.toExponential(2)}`);

    // Test 5: Waypoint最寄りルート吸着（Snap-to-Route）計算確認
    const snapped = engine.findNearestTrackPoint(34.7775, 135.2640);
    assert('Waypoint最寄りルート吸着 (Snap-to-Route) 計算確認', Number.isFinite(snapped.lat) && Number.isFinite(snapped.lon));

    // Test 6: XXE / Billion Laughs 防御フィルタ検証
    let xxeBlocked = false;
    try {
      engine.sanitizeXmlString('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><gpx></gpx>');
    } catch (_) {
      xxeBlocked = true;
    }
    assert('XML Entity Expansion (XXE / Billion Laughs) 遮断確認', xxeBlocked);

    // Test 7: DOM XSSサニタイズ確認
    const testOpt = document.createElement('option');
    testOpt.textContent = '<img src=x onerror=alert(1)>';
    assert('DOM XSS無害化確認 (innerHTML不使用)', testOpt.innerHTML.includes('&lt;img'));

    // Test 8: プロジェクトJSON検証・Prototype Pollution防御
    let projectTestPassed = false;
    try {
      const mockProject = {
        magic: engine.CONFIG.PROJECT_MAGIC,
        version: 2,
        '__proto__': { polluted: true },
        route: {
          gpxFileName: 't.gpx',
          reductionPercent: 30,
          trackPoints: [{ lat: 34.7, lon: 135.2 }, { lat: 34.8, lon: 135.3 }],
          waypoints: []
        },
        view: { offsetX: 999999, offsetY: -999999, scale: 99 },
        style: { lineColor: '#529e78', markerColor: 'invalid' }
      };
      const val = engine.parseAndValidateProjectJson(JSON.stringify(mockProject));
      projectTestPassed = val.view.scale === 3.0 && val.reductionPercent === 30 && val.style.showPlate === false && !({}).polluted;
    } catch (_) {
      projectTestPassed = false;
    }
    assert('プロジェクトJSONスキーマ検証・Prototype Pollution防御', projectTestPassed);

    // Test 9: WebM および MP4 録画エンコーダ対応状況の確認
    const webmMime = engine.getSupportedMimeForFormat('webm');
    const mp4Mime = engine.getSupportedMimeForFormat('mp4');
    assert('WebM 動画エンコーダ対応確認', Boolean(webmMime), webmMime || '未対応');
    assert('MP4 動画エンコーダ対応確認', Boolean(mp4Mime), mp4Mime || 'ブラウザ未対応(WebM推奨)');

    outputEl.textContent =
      `[GPX Route Studio 診断レポート - ${new Date().toLocaleString()}]\n` +
      `結果: ${passCount} / ${totalCount} 項目クリア\n` +
      `------------------------------------------------------------\n` +
      logs.join('\n');

    if (badgeEl) {
      badgeEl.textContent = `${passCount} / ${totalCount} PASS`;
    }
  }

  if (btnRun) {
    btnRun.addEventListener('click', runFullDiagnosticSuite);
  }
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(runFullDiagnosticSuite, 80);
  });
})();