import './style.css';
import type { GameConfig } from './core/config';
import { handleCallback } from './lichess/auth';
import { showLanding } from './ui/landing/landing';
import { parseRoute } from './ui/landing/route';
import { L } from './ui/landing/strings';
import { isVRSupported } from './xr/support';

/**
 * Einstiegspunkt: Landingpage (leichtgewichtig, ohne Three.js).
 * Die 3D-Spielszene (game.ts) wird erst nach dem Start dynamisch nachgeladen.
 */

const RESUME_KEY = 'myzel-schach.resume';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const route = parseRoute(location.search);
  const params = new URLSearchParams(location.search);
  // Debug: Objekte rot markieren, deren Basis > 3 cm neben dem Gelände liegt
  if (params.get('debug') === 'ground') (globalThis as unknown as { __myzelDebugGround: boolean }).__myzelDebugGround = true;
  if (params.get('xremu') === '1') {
    const { installEmulator } = await import('./xr/emulator');
    await installEmulator(params);
  }
  const vrSupported = await isVRSupported();

  // Fortsetzen nach Qualitätswechsel (Neuladen)
  let resume: { cfg: GameConfig; pgn: string; human: 'w' | 'b' } | null = null;
  try {
    resume = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    resume = null;
  }

  let cfg: GameConfig;
  if (resume) cfg = resume.cfg;
  else if (route.view === 'autostart') cfg = { mode: route.mode, name: '', color: 'w', tc: '10+5', engineLevel: 3, vr: false };
  else if (route.view === 'autostart-net')
    cfg = {
      mode: route.kind === 'online' ? 'online-link' : route.role === 'host' ? 'coloc-host' : 'coloc-join',
      role: route.role,
      room: route.room,
      name: route.name,
      color: route.color,
      tc: route.tc,
      engineLevel: 3,
      vr: route.vr,
    };
  else {
    let notice: string | undefined;
    let openLichess = false;
    if (route.view === 'oauth-callback') {
      try {
        await handleCallback(route.code, route.state);
        openLichess = true;
      } catch (e) {
        notice = L('loginError', { err: (e as Error).message });
      }
      history.replaceState(null, '', location.pathname); // Code nicht in der Adresszeile lassen
    } else if (route.view === 'oauth-error') {
      notice = L('loginError', { err: route.error });
      history.replaceState(null, '', location.pathname);
    }
    cfg = await showLanding(ui, { vrSupported, joinRoom: route.view === 'join' ? route.room : undefined, notice, openLichess });
    ui.innerHTML = '';
  }

  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = L('loading');
  ui.appendChild(loading);
  const { startGame } = await import('./game'); // Lazy Loading der 3D-Szene
  loading.remove();
  await startGame(app, ui, cfg, resume);
}

void boot();
