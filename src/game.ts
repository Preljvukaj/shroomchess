import * as THREE from 'three';
import { AudioEngine } from './audio/audio';
import { ChessClock, TIME_CONTROLS } from './core/clock';
import { type GameConfig, isNetMode } from './core/config';
import { NetPlay } from './net/netPlay';
import type { EmoteId } from './net/protocol';
import { roomLink } from './ui/landing/route';
import qrcode from 'qrcode-generator';
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
import { InfoTablet } from './render/infoTablet';
import { FRAME_WIDTH_FACTOR } from './render/coordLayout';
import { placeTablet } from './xr/math/tablet';
import { PLAYER_GLOW } from './render/pieces';
import { SceneContext } from './render/scene';
import { worldUniforms } from './render/shared';
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
  const isNet = isNetMode(cfg.mode) && !!cfg.room;
  const netRole: 'host' | 'guest' = cfg.role ?? (cfg.mode === 'coloc-join' ? 'guest' : 'host');
  // Gast: Farbe bestimmt der Host (vorläufig Schwarz bis zur Einrichtung)
  let human: Color = isNet && netRole === 'guest' ? 'b' : resume?.human ?? (cfg.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : cfg.color);
  const engineColor: Color = human === 'w' ? 'b' : 'w';
  const playerName = cfg.name || colorName(human);
  let names: Record<Color, string> = isEngine
    ? ({ [human]: playerName, [engineColor]: `Stockfish (${cfg.engineLevel})` } as Record<Color, string>)
    : isNet
      ? ({ [human]: playerName, [human === 'w' ? 'b' : 'w']: t('opponent') } as Record<Color, string>)
      : { w: colorName('w'), b: colorName('b') };
  game.setHeaders({
    White: names.w,
    Black: names.b,
    Event: isEngine ? 'Myzel-Schach vs. Stockfish' : isLichess ? 'Myzel-Schach (Lichess)' : 'Myzel-Schach Hot-Seat',
  });
  if (resume?.pgn && !isLichess && !isNet) {
    try {
      game.loadPgn(resume.pgn);
    } catch {
      /* ungültig – frische Partie */
    }
  }

  const board = new BoardScene(game, { squareSize: DESKTOP_SQUARE, segments: ctx.profile.latheSegments, high: quality === 'high' });
  ctx.scene.add(board.root);

  // Info-Steintafel neben dem Brett (ersetzt die schwebende Uhr/Statusanzeige)
  const tablet = new InfoTablet();
  ctx.scene.add(tablet.root);
  /** Zusatzzeile für den Tafel-Status (Remis-Angebot, Verbindung …) */
  let statusNote: string | null = null;
  let connLine: string | null = null;
  function placeTabletFor(region: { x: number; z: number }[] | undefined, pose: { x: number; z: number; yaw: number; squareSize: number; table?: boolean }): void {
    const totalSide = pose.squareSize * (8 + 2 * FRAME_WIDTH_FACTOR);
    const tp = placeTablet({ center: { x: pose.x, z: pose.z }, yaw: pose.yaw, totalSide, region, scale: pose.table ? 0.3 : 1 });
    tablet.place(tp, pose.table ? (pose as { height?: number }).height ?? 0 : world.basin.heightAt(tp.x, tp.z));
  }
  placeTabletFor(undefined, { x: 0, z: 0, yaw: 0, squareSize: DESKTOP_SQUARE });

  const tc = TIME_CONTROLS.find((c) => c.id === cfg.tc)?.tc ?? { initial: 0, increment: 0 };
  // Lichess: die Uhr kommt aus dem Stream – lokal nur Anzeige (Grundzeit egal, nur „aktiv“)
  let clock = new ChessClock(isLichess ? { initial: 1, increment: 0 } : tc);
  const engine = isEngine ? new StockfishEngine() : null;
  const audio = new AudioEngine();
  audio.setSoundSpots(world.soundSpots);

  const controls = new DesktopControls(ctx.camera, ctx.renderer.domElement, side, flatHalf);
  let viewSide: Color = isEngine ? human : 'w';
  controls.resetView(viewSide);

  let insects = createInsects(ctx.profile, world, audio, {
    boardHalf: side / 2 + DESKTOP_SQUARE * 0.8,
    pieceTop: board.kingHeight * 1.15,
  });
  ctx.scene.add(insects.root);
  // (Greif-Säulen-Fäden werden nach dem Interaction-Controller hinzugefügt)

  /** Gluckern der Lavalampen-Blasen: an ihrer Quelle, pro Quelle mindestens 2–4 s Abstand. */
  const lastGlug = new Map<number, number>();
  function hookLava(): void {
    world.lava.onEvent = (e) => {
      const now = performance.now() / 1000;
      const gap = 2 + ((e.source * 0.37) % 1) * 2;
      if (now - (lastGlug.get(e.source) ?? -99) < gap) return;
      if (e.type !== 'detach' && Math.random() < 0.5) return; // Teilen/Verschmelzen nur gelegentlich
      if (audio.playGlug({ x: e.x, y: e.y, z: e.z }, e.type !== 'detach')) lastGlug.set(e.source, now);
    };
  }
  hookLava();

  /**
   * Welt (Senke, Vegetation) und Insekten für eine neue Spielfläche neu bauen und das Brett
   * dort platzieren (VR: Boundary des Spielers; zurück am Desktop: virtuelle Fläche).
   */
  function rebuildWorld(region: V2[], pose: { x: number; z: number; yaw: number; height: number; squareSize: number; table?: boolean; desktop?: boolean }): void {
    const k = pose.squareSize / DESKTOP_SQUARE;
    board.root.position.set(pose.x, pose.height, pose.z);
    board.root.rotation.set(0, pose.yaw, 0);
    board.root.scale.setScalar(k);
    ctx.placeLights(new THREE.Vector3(pose.x, pose.height, pose.z), pose.yaw, Math.max(0.3, k));
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
    audio.setSoundSpots(world.soundSpots);
    hookLava();
    placeTabletFor(pose.desktop ? undefined : region, pose);
    applySettings();
  }

  // ---------- Lichess ----------
  let lichess: LichessBoard | null = null;
  let net: NetPlay | null = null;
  const canControl = (c: Color) => (isEngine ? c === human : isLichess ? lichess?.myColor === c : isNet ? c === human && !!net && !net.isPaused && game.turn === human : true);

  const interaction = new InteractionController(board, game, {
    canControl,
    viewerYaw: () => (vr?.active ? vr.viewerYawOnBoard() : controls.viewYaw()),
    submitMove: (from, to, promo) => {
      if (net?.isGuest) return net.requestMove(from, to, promo);
      if (isNet && game.turn !== human) return false;
      const m = game.tryMove(from, to, promo);
      if (m && lichess) void lichess.sendMove(from + to + (m.promotion ?? ''));
      return m !== null;
    },
    onIllegal: () => audio.play('illegal'),
    onPickup: () => audio.play('pickup'),
    onHeldOverSquare: (sq) => board.coords.highlightSquare(sq),
  });
  ctx.scene.add(interaction.beams);

  // ---------- Overlay ----------
  let analysisOn = false;
  const overlay = new Overlay(ui, {
    resign: async () => {
      if (game.result()) return;
      if (!(await overlay.confirm(t('resignConfirm')))) return;
      if (net) return net.resign();
      if (lichess) {
        await lichess.resign().catch((e: Error) => overlay.toast(e.message));
        return;
      }
      game.resign(isEngine ? human : game.turn);
    },
    offerDraw: async () => {
      if (game.result()) return;
      if (net) return net.offer('draw');
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
      if (net) return net.offer('undo');
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
    rematch: () => (net ? net.offer('rematch') : lichess ? (location.href = location.pathname) : newRound()),
    emote: (id) => net?.emote(id as EmoteId),
    voice: async (on) => (net ? net.setMic(on) : false),
    invite: () => showInvite(),
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
    board.opponentSpeed = s.opponentAnim;
    // Beschriftung: Hot-Seat → jede Seite für ihren Spieler; Einzelspieler/Lichess → für die eigene Farbe
    board.coords.apply(s, viewSide, isEngine || isLichess || isNet ? human : 'both');
    audio.setMix({ master: s.volume, sfx: s.sfxVolume, ambience: s.ambienceVolume, creatures: s.creaturesVolume, insects: s.insects });
    insects.setEnabled(s.insects, s.insectLanding);
    net?.setAnim(s.opponentAnim);
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
    const st = r ? resultText(r) : statusNote ?? `${t('toMove', { color: names[game.turn] })}${game.inCheck ? ` – ${t('check')}` : ''}`;
    tablet.setInfo({ names, status: st, alert: !!r || game.inCheck || !!statusNote, moves: game.history(), captured: game.capturedBy(), conn: connLine });
    tablet.setClocks(clock.enabled ? clock.read() : null, game.turn, !r, true);
  }

  // ---------- Spielablauf ----------
  // Langsame Animation für Züge, die nicht von der lokalen Hand kommen
  board.isOpponentMove = (m) => (isEngine && m.color === engineColor) || (isLichess && !!lichess?.myColor && lichess.myColor !== m.color);
  game.on('move', (m) => {
    // Uhr: Die Animationszeit des Gegnerzugs wird nicht von der eigenen Bedenkzeit abgezogen (Gutschrift am Zugbeginn)
    if (net) {
      if (!net.isGuest) clock.press(m.color, net.graceFor(m)); // Host führt die Uhr, Gast zeigt nur den Host-Stand
    } else if (!lichess) clock.press(m.color, board.isOpponentMove(m) ? board.opponentAnimDuration(m) * 1000 : 0);
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
  const bindClock = () => clock.on('flag', (c) => !lichess && !net?.isGuest && game.timeout(c));
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
  let infoTimer = 0;
  const frustum = new THREE.Frustum();
  const tabletBox = new THREE.Box3();
  function tabletInView(): boolean {
    ctx.camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse));
    tabletBox.setFromObject(tablet.root);
    // mindestens die Uhr-Zone (oberes Drittel) muss im Bild sein und nicht zu klein
    const c = tabletBox.getCenter(new THREE.Vector3());
    c.y = tabletBox.max.y - (tabletBox.max.y - tabletBox.min.y) * 0.2;
    const d = c.distanceTo(ctx.camera.position);
    return frustum.containsPoint(c) && d < 9;
  }
  tablet.onTooClose = () => (vr?.active ? vr.say(t('tabletTooClose'), 3) : overlay.toast(t('tabletTooClose')));
  const boardCenter = new THREE.Vector3();
  const head = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  // FPS-Wächter: zu wenig Bildrate → in dieser Reihenfolge reduzieren: Dichte im Mittelbereich, Insektenanzahl,
  // Blasen, Pose-Senderate (min. 10 Hz online, 20 Hz co-located). Der Horizontring wird nie entfernt.
  let fpsEma = 60;
  let lowFor = 0;
  let okFor = 0;
  const baseBubbles = ctx.profile.bubbles;
  function reduceStep(): boolean {
    if (world.midDensity > 0.31) return world.setMidDensity(world.midDensity * 0.75), true;
    if (insects.activeFraction > 0.21) return insects.setActiveFraction(insects.activeFraction * 0.75), true;
    if (world.lava.sim.maxBlobs > Math.ceil(baseBubbles * 0.5)) return (world.lava.sim.maxBlobs = Math.max(Math.ceil(baseBubbles * 0.5), world.lava.sim.maxBlobs - 2)), true;
    if (net) {
      const min = net.kind === 'coloc' ? 20 : 10;
      if (net.poseHz > min) return (net.poseHz = Math.max(min, net.poseHz - 4)), true;
    }
    return false;
  }
  function raiseStep(): void {
    // umgekehrte Reihenfolge
    if (net && net.poseHz < (net.kind === 'coloc' ? 30 : 18)) net.poseHz += 2;
    else if (world.lava.sim.maxBlobs < baseBubbles) world.lava.sim.maxBlobs++;
    else if (insects.activeFraction < 1) insects.setActiveFraction(insects.activeFraction * 1.15);
    else if (world.midDensity < 1) world.setMidDensity(world.midDensity * 1.15);
  }
  const autoTune = !new URLSearchParams(location.search).has('noauto'); // ?noauto=1: für Messungen abschalten
  ctx.onFrame((dt, time) => {
    if (dt > 0 && autoTune) fpsEma += (1 / dt - fpsEma) * 0.05;
    const target = vr?.active ? 72 : 55;
    if (fpsEma < target * 0.9) {
      lowFor += dt;
      okFor = 0;
      if (lowFor > 3) {
        reduceStep();
        lowFor = 0;
      }
    } else if (fpsEma > target * 0.98) {
      okFor += dt;
      lowFor = 0;
      if (okFor > 10) {
        raiseStep();
        okFor = 0;
      }
    }
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
    ctx.camera.getWorldPosition(head);
    world.update(dt, head, [head]);
    ctx.camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(ctx.camera.getWorldQuaternion(new THREE.Quaternion()));
    audio.setListener(head, fwd, up);
    worldUniforms.uWind.value = audio.windLevel(); // Böen → Vegetation wiegt synchron stärker
    insects.update(dt, time, head, fwd, vr?.active ? vr.handPoints() : []);
    tablet.update(dt, vr?.active ? [head, ...vr.handPoints()] : [head]);
    net?.update(dt, time);
    uiTimer += dt;
    if (uiTimer > 0.1) {
      uiTimer = 0;
      if (clock.enabled) overlay.setClocks(clock.read(), game.turn);
      tablet.setClocks(clock.enabled ? clock.read() : null, game.turn, !game.result() && clock.isRunning);
    }
    // Desktop: 2D-Infos nur, wenn gewünscht oder die Tafel nicht im Bild ist
    infoTimer += dt;
    if (infoTimer > 0.5) {
      infoTimer = 0;
      overlay.setInfoVisible(!vr?.active && (settings.get().infoOverlay || !tabletInView()));
    }
  });

  const colocHost: import('./xr/colocation').ColocHost = {
    get role() {
      return netRole;
    },
    send: (m) => net?.sendColoc(m),
    offset: () => settings.get().backToBackOffset,
    localColor: () => human,
    roomCode: () => cfg.room ?? '',
    peerConnected: () => !!net?.link.connected,
    remoteHead: () => (net?.avatar.root.visible ? net.avatar.headWorld() : null),
    remoteHands: () => (net ? ([net.avatar.handWorld(0), net.avatar.handWorld(1)].filter(Boolean) as THREE.Vector3[]) : []),
    setRemoteGlow: (k) => {
      if (net) net.avatar.proximity = k;
    },
    warnSound: () => audio.play('check'),
  };

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
      playerColor: () => (isEngine || isLichess || isNet ? human : game.turn),
      applyPlacement: (p, region) => rebuildWorld(region, { x: p.center.x, z: p.center.z, yaw: p.yaw, height: p.height, squareSize: p.squareSize, table: p.mode === 'table' }),
      onExit: () => {
        rebuildWorld(squarePolygon(flatHalf), { x: 0, z: 0, yaw: 0, height: 0, squareSize: DESKTOP_SQUARE, desktop: true });
        controls.setMode(controls.mode, viewSide);
        vrButton.hidden = false;
      },
      isGameOver: () => !!game.result(),
      action: (id) => vrAction(id),
      setSubtitleSink: (fn) => (subtitleSink = fn),
      net: isNet,
      // Gast erfährt die Raumart erst vom Server → beim VR-Eintritt nachsehen
      get coloc() {
        return isNet && net?.kind === 'coloc' ? colocHost : undefined;
      },
    });
  }

  let voiceOn = false;
  /** Aktionen aus dem VR-Handgelenk-Menü (Bestätigung passiert dort per Doppeltippen). */
  function vrAction(id: string): void {
    switch (id) {
      case 'resign':
        if (game.result()) return;
        if (net) net.resign();
        else if (lichess) void lichess.resign();
        else game.resign(isEngine ? human : game.turn);
        return;
      case 'draw':
        if (game.result()) return;
        if (net) net.offer('draw');
        else if (lichess) void lichess.offerDraw(true);
        else if (isEngine) vr?.say(t('drawDeclined'), 3);
        else game.agreeDraw(); // Hot-Seat: beide stehen an derselben Brille
        return;
      case 'undo':
        if (net) return net.offer('undo');
        if (lichess) return vr?.say(t('notInLichess'), 3);
        if (board.busy) return;
        engine?.stop();
        interaction.cancelAll();
        game.undo();
        if (isEngine && game.turn !== human) game.undo();
        return;
      case 'rematch':
        if (net) return net.offer('rematch');
        if (lichess) return vr?.say(t('notInLichess'), 3);
        newRound();
        return;
      case 'emote-nice':
      case 'emote-hmm':
        net?.emote(id.slice(6) as EmoteId);
        return;
      case 'voice':
        if (!net) return;
        voiceOn = !voiceOn;
        void net.setMic(voiceOn).then((ok) => vr?.say(t(!ok ? 'voiceFailed' : voiceOn ? 'voiceOn' : 'voiceOff'), 2));
        return;
      case 'new':
        net?.dispose();
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

  // ---------- Netzwerkspiel (Meilenstein 3/4) ----------
  function showInvite(): void {
    if (!net) return;
    const code = net.link.room;
    const link = roomLink(location.origin, location.pathname, code);
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    overlay.showInvite(code, link, qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
  }
  if (isNet) {
    const guestColor: Color = netRole === 'host' ? (human === 'w' ? 'b' : 'w') : 'b';
    const remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    ui.appendChild(remoteAudio);
    net = new NetPlay(
      {
        game,
        board,
        scene: ctx.scene,
        clock: () => clock,
        setClock: (c) => {
          clock.stop();
          clock = c;
          bindClock();
          refreshUi();
        },
        setLocalColor: (c) => {
          human = c;
          viewSide = c;
          controls.resetView(c);
          applySettings();
        },
        localColor: () => human,
        setNames: (n) => {
          names = { ...n };
          overlay.names = names;
          game.setHeaders({ White: names.w, Black: names.b, Event: 'Myzel-Schach Online' });
          refreshUi();
        },
        localName: () => playerName,
        refreshUi: () => refreshUi(),
        say: (text, sec = 4) => (vr?.active ? vr.say(text, sec) : overlay.toast(text, sec * 1000)),
        confirm: (q) => (vr?.active ? vr.confirm(q) : overlay.confirm(q)),
        setConn: (line) => {
          connLine = line;
          refreshUi();
        },
        setNote: (n) => {
          statusNote = n;
          refreshUi();
        },
        t: (k, v) => t(k as Parameters<typeof t>[0], Object.fromEntries(Object.entries(v ?? {}).map(([a, b]) => [a, String(b)]))),
        localPose: () => {
          if (!vr?.active) return { vr: false };
          const hp = vr.handPoses();
          return { vr: true, head: vr.headMatrix(), left: hp.left, right: hp.right, live: hp.left !== null || hp.right !== null };
        },
        hoverSquare: () => interaction.hoverSquare(),
        heldPiece: () => {
          const p = interaction.heldPiece();
          return p ? { square: p.square, root: p.root } : null;
        },
        animSpeed: () => settings.get().opponentAnim,
        playSound: (id) => audio.play(id === 'emote' ? 'pickup' : id),
        onRemoteAudio: (stream) => {
          remoteAudio.srcObject = stream;
          void remoteAudio.play().catch(() => undefined);
        },
        onColoc: (m) => vr?.onColocMessage(m),
        onPeerReady: () => {
          vr?.colocPeerReady();
          overlay.hideInvite();
        },
        onRoomChanged: () => showInvite(),
      },
      { room: cfg.room!, role: netRole, kind: cfg.mode === 'online-link' ? 'online' : 'coloc', guestColor, tc: cfg.tc, names },
    );
    overlay.net = true;
    overlay.rerender();
    if (netRole === 'host' && !cfg.vr) showInvite();
  }

  refreshUi();
  // Bullet/Blitz: „Schnell“ für die Gegner-Animation vorschlagen (einmalig)
  if ((isEngine || isLichess) && tc.initial > 0 && tc.initial <= 300 && settings.get().opponentAnim !== 'fast' && !settings.get().fastSuggested) {
    settings.set({ fastSuggested: true });
    void overlay.confirm(t('suggestFast')).then((ok) => ok && settings.set({ opponentAnim: 'fast' }));
  }
  if (game.plyCount > 0 && !game.result() && !isLichess && !isNet) clock.start(game.turn);
  void maybeEngineMove();
  requestAnimationFrame(() => loading.remove());

  // Debug-Zugriff in der Konsole
  (window as unknown as Record<string, unknown>).myzel = { game, board, ctx, THREE, interaction, controls, get net() { return net; }, get clock() { return clock; }, tablet, get world() { return world; }, get insects() { return insects; }, audio, vr };
}
