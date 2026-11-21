import * as THREE from 'three';
import { AudioEngine } from './audio/audio';
import { ChessClock, TIME_CONTROLS, formatClock } from './core/clock';
import type { GameConfig } from './core/config';
import { ChessGame } from './core/game';
import { type Quality, effectiveQuality, settings } from './core/settings';
import type { Color, GameResult } from './core/types';
import { DesktopControls } from './desktop/desktopControls';
import { StockfishEngine } from './engine/stockfish';
import { account as lichessAccount } from './lichess/api';
import { LichessBoard } from './lichess/boardSource';
import { downloadPgn, importPgnToLichess } from './lichess/export';
import { getToken } from './lichess/auth';
import { BoardScene } from './render/boardScene';
import { InteractionController } from './render/interaction';
import { PLAYER_GLOW, setPieceContrast } from './render/pieces';
import { SceneContext } from './render/scene';
import { createWorld, squareRegion } from './render/world';
import { squarePolygon } from './render/world/basin';
import type { V2 } from './xr/math/vec2';
import { V } from './xr/strings';
import { VRMode } from './xr/vrMode';

function disposeObject(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}
import { createInsects } from './render/world/insects';
import { colorName, t } from './ui/i18n';
import { Overlay, resultText } from './ui/overlay';

/**
 * Die 3D-Spielszene. Wird von main.ts erst nach dem Start dynamisch importiert,
 * damit die Landingpage ohne Three.js schnell lädt.
 */

/** Desktop: Riesenschach-Maßstab mit 0,5 m Feldern (König ≈ 1,1 m). */
const DESKTOP_SQUARE = 0.5;
export const RESUME_KEY = 'myzel-schach.resume';

export interface Resume {
  cfg: GameConfig;
  pgn: string;
  human: Color;
}

export async function startGame(app: HTMLElement, ui: HTMLElement, cfg: GameConfig, resume: Resume | null): Promise<void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = t('loading');
  ui.appendChild(loading);
  await new Promise((r) => requestAnimationFrame(r)); // Ladeanzeige zuerst zeichnen

  const quality: Quality = effectiveQuality();
  const ctx = new SceneContext(app, quality);
  const side = DESKTOP_SQUARE * 8;
  // Desktop: virtuelle Spielfläche = Brett + 2,5 m Rand (Platz für die Kamera).
  // In VR (M2) kommt hier die Boundary des Hosts hinein.
  const flatHalf = side / 2 + 2.5;
  let vr: VRMode | null = null; // früh deklarieren: die Frame-Schleife läuft schon während der Initialisierung
  let world = createWorld(ctx.profile, squareRegion(flatHalf));
  ctx.scene.add(world.root);

  const game = new ChessGame();
  const isEngine = cfg.mode === 'engine';
  const isLichess = cfg.mode === 'lichess' && !!cfg.lichess;
  let human: Color = resume?.human ?? (cfg.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : cfg.color);
  const engineColor: Color = human === 'w' ? 'b' : 'w';
  const playerName = cfg.name || colorName(human);
  let names: Record<Color, string> = isEngine
    ? ({ [human]: playerName, [engineColor]: `Stockfish (${cfg.engineLevel})` } as Record<Color, string>)
    : { w: colorName('w'), b: colorName('b') };
  game.setHeaders({
    White: names.w,
    Black: names.b,
    Event: isEngine ? 'Myzel-Schach vs. Stockfish' : isLichess ? 'Myzel-Schach (Lichess)' : 'Myzel-Schach Hot-Seat',
  });
  if (resume?.pgn && !isLichess) {
    try {
      game.loadPgn(resume.pgn);
    } catch {
      /* ungültig – frische Partie */
    }
  }

  const board = new BoardScene(game, { squareSize: DESKTOP_SQUARE, segments: ctx.profile.latheSegments, high: quality === 'high' });
  ctx.scene.add(board.root);

  const tc = TIME_CONTROLS.find((c) => c.id === cfg.tc)?.tc ?? { initial: 0, increment: 0 };
  // Lichess: die Uhr kommt aus dem Stream – lokal nur Anzeige (Grundzeit egal, nur „aktiv“)
  let clock = new ChessClock(isLichess ? { initial: 1, increment: 0 } : tc);
  const engine = isEngine ? new StockfishEngine() : null;
  const audio = new AudioEngine();
  audio.setVolume(settings.get().volume);
  audio.setCreatures(settings.get().creaturesVolume, settings.get().insects);

  const controls = new DesktopControls(ctx.camera, ctx.renderer.domElement, side, flatHalf);
  let viewSide: Color = isEngine ? human : 'w';
  controls.resetView(viewSide);

  let insects = createInsects(ctx.profile, world, audio, {
    boardHalf: side / 2 + DESKTOP_SQUARE * 0.8,
    pieceTop: board.kingHeight * 1.15,
  });
  ctx.scene.add(insects.root);

  /**
   * Welt (Senke, Vegetation) und Insekten für eine neue Spielfläche neu bauen und das Brett
   * dort platzieren (VR: Boundary des Spielers; zurück am Desktop: virtuelle Fläche).
   */
  function rebuildWorld(region: V2[], pose: { x: number; z: number; yaw: number; height: number; squareSize: number }): void {
    const k = pose.squareSize / DESKTOP_SQUARE;
    board.root.position.set(pose.x, pose.height, pose.z);
    board.root.rotation.set(0, pose.yaw, 0);
    board.root.scale.setScalar(k);
    interaction.distanceScale = THREE.MathUtils.clamp(k * 1.3, 0.2, 1);
    const tint = world.tintState();
    disposeObject(world.root);
    insects.dispose();
    world = createWorld(ctx.profile, { pts: region });
    world.restoreTint(tint);
    ctx.scene.add(world.root);
    insects = createInsects(ctx.profile, world, audio, {
      boardHalf: (side / 2 + DESKTOP_SQUARE * 0.8) * k,
      pieceTop: board.kingHeight * 1.15 * k,
      pose: { x: pose.x, z: pose.z, yaw: pose.yaw, baseY: pose.height },
    });
    ctx.scene.add(insects.root);
    applySettings();
  }

  // ---------- Lichess ----------
  let lichess: LichessBoard | null = null;
  const canControl = (c: Color) => (isEngine ? c === human : isLichess ? lichess?.myColor === c : true);

  const interaction = new InteractionController(board, game, {
    canControl,
    viewerYaw: () => (vr?.active ? vr.viewerYawOnBoard() : controls.viewYaw()),
    submitMove: (from, to, promo) => {
      const m = game.tryMove(from, to, promo);
      if (m && lichess) void lichess.sendMove(from + to + (m.promotion ?? ''));
      return m !== null;
    },
    onIllegal: () => audio.play('illegal'),
    onPickup: () => audio.play('pickup'),
    onHeldOverSquare: (sq) => board.coords.highlightSquare(sq),
  });

  // ---------- Overlay ----------
  let analysisOn = false;
  const overlay = new Overlay(ui, {
    resign: async () => {
      if (game.result()) return;
      if (!(await overlay.confirm(t('resignConfirm')))) return;
      if (lichess) {
        await lichess.resign().catch((e: Error) => overlay.toast(e.message));
        return;
      }
      game.resign(isEngine ? human : game.turn);
    },
    offerDraw: async () => {
      if (game.result()) return;
      if (lichess) {
        await lichess.offerDraw(true).then(() => overlay.toast(t('drawOffered'))).catch((e: Error) => overlay.toast(e.message));
        return;
      }
      if (isEngine) {
        overlay.toast(t('drawDeclined'));
        return;
      }
      if (await overlay.confirm(`${colorName(game.turn === 'w' ? 'b' : 'w')}: ${t('acceptDraw')}`)) game.agreeDraw();
    },
    undo: () => {
      if (lichess) {
        overlay.toast(t('notInLichess'));
        return;
      }
      if (board.busy) return;
      engine?.stop();
      interaction.cancelAll();
      game.undo();
      if (isEngine && game.turn !== human) game.undo();
    },
    flip: () => {
      viewSide = viewSide === 'w' ? 'b' : 'w';
      controls.setMode(controls.mode, viewSide);
      applySettings();
    },
    camera: (mode) => {
      controls.setMode(mode, viewSide);
      overlay.setHint(mode === 'first' ? t('hintFirst') : t('hintDesktop'));
    },
    newGame: () => {
      try {
        sessionStorage.removeItem(RESUME_KEY);
      } catch {
        /* ignorieren */
      }
      location.href = location.pathname; // zurück zur Landingpage
    },
    rematch: () => (lichess ? (location.href = location.pathname) : newRound()),
    savePgn: () => downloadPgn(game.pgn()),
    copyPgn: async () => {
      try {
        await navigator.clipboard.writeText(game.pgn());
        overlay.toast(t('copied'));
      } catch (e) {
        overlay.toast(String(e));
      }
    },
    exportLichess: async () => {
      try {
        const url = await importPgnToLichess(game.pgn(), getToken() ?? undefined);
        overlay.toast(t('exported', { url }), 10_000);
        window.open(url, '_blank', 'noopener');
      } catch (e) {
        overlay.toast(t('exportFailed', { err: (e as Error).message }), 6000);
      }
    },
    analysis: (on) => {
      // Fair Play: keine Analyse während einer laufenden Lichess-Partie
      if (on && lichess && !game.result()) return overlay.toast(t('notInLichess'));
      analysisOn = on;
      interaction.cancelAll();
      if (on) overlay.showAnalysis(true, game.plyCount);
      else {
        overlay.showAnalysis(false);
        board.showFen(null);
        refreshUi();
      }
    },
    analysisStep: (ply) => {
      board.showFen(game.fenTimeline()[ply]);
      overlay.setMoves(game.history(), ply);
    },
    qualityChanged: (q) => {
      settings.set({ quality: q });
      overlay.toast(t('qualityReload'));
      if (!lichess) {
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ cfg, pgn: game.pgn(), human } satisfies Resume));
        } catch {
          /* ignorieren */
        }
      }
      setTimeout(() => location.reload(), 900);
    },
  });
  overlay.names = names;
  overlay.setHint(t('hintDesktop'));
  overlay.onRerender = () => refreshUi();
  let subtitleSink: ((text: string) => void) | null = null;
  audio.onSubtitle = (k) => {
    if (subtitleSink) {
      if (settings.get().subtitles) subtitleSink(t(k));
    } else overlay.subtitle(k);
  };

  function applySettings(): void {
    const s = settings.get();
    board.colorblind = s.colorblind;
    board.highlights.colorblind = s.colorblind;
    board.highlights.refreshPalette();
    board.markNoLegalMoves = s.markNoLegalMoves;
    board.coords.apply(s, viewSide);
    setPieceContrast(s.pieceContrast, s.whiteOutline);
    audio.setVolume(s.volume);
    audio.setCreatures(s.creaturesVolume, s.insects);
    insects.setEnabled(s.insects, s.insectLanding);
  }
  settings.on('change', applySettings);
  applySettings();

  function refreshUi(): void {
    const r = game.result();
    if (r) overlay.setStatus(resultText(r), true);
    else overlay.setStatus(`${t('toMove', { color: names[game.turn] })}${game.inCheck ? ` – ${t('check')}` : ''}`, game.inCheck);
    overlay.setMoves(game.history());
    overlay.setCaptured(game.capturedBy());
    overlay.setClocks(clock.enabled ? clock.read() : null, game.turn);
  }

  // ---------- Spielablauf ----------
  game.on('move', (m) => {
    if (!lichess) clock.press(m.color);
    audio.play(m.captured ? 'capture' : 'move');
    if (m.check && !game.result()) setTimeout(() => audio.play('check'), 250);
    persist();
    refreshUi();
    void maybeEngineMove();
  });
  game.on('undo', () => {
    persist();
    refreshUi();
  });
  game.on('reset', () => {
    interaction.cancelAll();
    refreshUi();
  });
  game.on('end', (r: GameResult) => {
    clock.stop();
    interaction.cancelAll();
    world.celebrate(r.winner ? PLAYER_GLOW[r.winner] : null);
    setTimeout(() => audio.play('end'), 400);
    refreshUi();
    setTimeout(() => overlay.showEnd(r), 1600);
    if (vr?.active) setTimeout(() => vr?.say(`${resultText(r)}\n${V('gameOverHint')}`, 8), 1200);
  });
  const bindClock = () => clock.on('flag', (c) => !lichess && game.timeout(c));
  bindClock();

  function persist(): void {
    try {
      localStorage.setItem('myzel-schach.lastPgn', game.pgn());
    } catch {
      /* ignorieren */
    }
  }

  let engineBusy = false;
  async function maybeEngineMove(): Promise<void> {
    if (!engine || engineBusy || game.result() || game.turn !== engineColor || analysisOn) return;
    engineBusy = true;
    overlay.setStatus(t('engineThinking'));
    const fen = game.fen;
    const started = performance.now();
    try {
      const uci = await engine.bestMove(fen, cfg.engineLevel);
      const wait = Math.max(0, 600 - (performance.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      while (board.busy) await new Promise((r) => setTimeout(r, 50));
      if (uci && game.fen === fen) game.tryMoveNotation(uci);
    } catch (e) {
      overlay.toast(`Stockfish: ${(e as Error).message ?? e}`);
    } finally {
      engineBusy = false;
      refreshUi();
    }
  }

  function newRound(): void {
    world.resetTint();
    overlay.showEnd(null);
    overlay.showAnalysis(false);
    analysisOn = false;
    interaction.cancelAll();
    clock.stop();
    clock = new ChessClock(tc);
    bindClock();
    engine?.newGame();
    game.reset();
    refreshUi();
    void maybeEngineMove();
  }

  if (isLichess) {
    try {
      const me = await lichessAccount();
      lichess = new LichessBoard(cfg.lichess!.gameId, me.id, game, clock, {
        onInfo: (info) => {
          names = info.names;
          overlay.names = names;
          if (info.myColor) {
            human = info.myColor;
            viewSide = info.myColor;
            controls.resetView(viewSide);
            applySettings();
          }
          refreshUi();
        },
        onDrawOffer: async () => {
          if (await overlay.confirm(t('acceptDraw'))) void lichess?.offerDraw(true);
          else void lichess?.offerDraw(false);
        },
        onMessage: (txt) => overlay.toast(txt, 5000),
        onError: (e) => overlay.toast(`Lichess: ${e.message}`, 6000),
      });
      lichess.start();
    } catch (e) {
      overlay.toast(`Lichess: ${(e as Error).message}`, 8000);
    }
  }

  // Erster Ton nach Nutzergeste (Autoplay-Richtlinien)
  const unlock = () => {
    audio.start();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // ---------- Frame-Schleife ----------
  let uiTimer = 0;
  const boardCenter = new THREE.Vector3();
  const head = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  ctx.onFrame((dt, time) => {
    if (vr?.active) {
      vr.update(dt, time);
    } else {
      controls.update(dt);
      if (!analysisOn) {
        const snaps = controls.drainSnapshots();
        if (snaps.length === 0) interaction.update([]);
        for (const s of snaps) interaction.update([s.pointer], s.screen);
      }
    }
    board.update(dt, time);
    board.root.getWorldPosition(boardCenter);
    board.coords.update(dt, ctx.camera, boardCenter, ctx.renderer.xr.isPresenting);
    world.update(dt);
    ctx.camera.getWorldPosition(head);
    ctx.camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(ctx.camera.getWorldQuaternion(new THREE.Quaternion()));
    audio.setListener(head, fwd, up);
    insects.update(dt, time, head, fwd, vr?.active ? vr.handPoints() : []);
    uiTimer += dt;
    if (uiTimer > 0.1) {
      uiTimer = 0;
      if (clock.enabled) overlay.setClocks(clock.read(), game.turn);
    }
  });

  // ---------- VR (Meilenstein 2) ----------
  if (await VRMode.supported()) {
    vr = new VRMode({
      renderer: ctx.renderer,
      scene: ctx.scene,
      rig: ctx.rig,
      camera: ctx.camera,
      quality,
      interaction,
      boardRoot: board.root,
      boardHalfLocal: side / 2 + DESKTOP_SQUARE * 0.8,
      localSquare: DESKTOP_SQUARE,
      // Hot-Seat: Seite am Zug; gegen Engine/Lichess: eigene Farbe
      playerColor: () => (isEngine || isLichess ? human : game.turn),
      applyPlacement: (p, region) => rebuildWorld(region, { x: p.center.x, z: p.center.z, yaw: p.yaw, height: p.height, squareSize: p.squareSize }),
      onExit: () => {
        rebuildWorld(squarePolygon(flatHalf), { x: 0, z: 0, yaw: 0, height: 0, squareSize: DESKTOP_SQUARE });
        controls.setMode(controls.mode, viewSide);
        vrButton.hidden = false;
      },
      clockText: () => {
        const st = clock.enabled ? clock.read() : null;
        const line = (c: Color) => `${game.turn === c && !game.result() ? '▶ ' : ''}${names[c]}${st ? `   ${formatClock(st[c])}` : ''}`;
        const r = game.result();
        return `${line('b')}\n${line('w')}${r ? `\n${resultText(r)}` : game.inCheck ? `\n${t('check')}` : ''}`;
      },
      isGameOver: () => !!game.result(),
      action: (id) => vrAction(id),
      setSubtitleSink: (fn) => (subtitleSink = fn),
    });
  }

  /** Aktionen aus dem VR-Handgelenk-Menü (Bestätigung passiert dort per Doppeltippen). */
  function vrAction(id: string): void {
    switch (id) {
      case 'resign':
        if (game.result()) return;
        if (lichess) void lichess.resign();
        else game.resign(isEngine ? human : game.turn);
        return;
      case 'draw':
        if (game.result()) return;
        if (lichess) void lichess.offerDraw(true);
        else if (isEngine) vr?.say(t('drawDeclined'), 3);
        else game.agreeDraw(); // Hot-Seat: beide stehen an derselben Brille
        return;
      case 'undo':
        if (lichess) return vr?.say(t('notInLichess'), 3);
        if (board.busy) return;
        engine?.stop();
        interaction.cancelAll();
        game.undo();
        if (isEngine && game.turn !== human) game.undo();
        return;
      case 'rematch':
        if (lichess) return vr?.say(t('notInLichess'), 3);
        newRound();
        return;
      case 'new':
        vr?.exit();
        location.href = location.pathname;
        return;
    }
  }

  // Knopf „VR betreten“ (requestSession braucht eine direkte Nutzergeste)
  const vrButton = document.createElement('button');
  vrButton.className = 'vr-enter';
  vrButton.textContent = `🥽 ${V('enterVR')}`;
  vrButton.hidden = !vr;
  vrButton.addEventListener('click', async () => {
    if (!vr) return;
    vrHint.hidden = true;
    try {
      audio.start();
      await vr.enter();
      vrButton.hidden = true;
      controls.enabled = false;
    } catch (e) {
      overlay.toast(V('vrFailed', { err: (e as Error).message }), 8000);
    }
  });
  ui.appendChild(vrButton);
  const vrHint = document.createElement('div');
  vrHint.className = 'vr-hint';
  vrHint.textContent = V('enterVRHint');
  vrHint.hidden = !(vr && cfg.vr);
  if (vr && cfg.vr) vrButton.classList.add('big');
  ui.appendChild(vrHint);

  refreshUi();
  if (game.plyCount > 0 && !game.result() && !isLichess) clock.start(game.turn);
  void maybeEngineMove();
  requestAnimationFrame(() => loading.remove());

  // Debug-Zugriff in der Konsole
  (window as unknown as Record<string, unknown>).myzel = { game, board, ctx, THREE, interaction, controls, get world() { return world; }, get insects() { return insects; }, audio, vr };
}
