import './landing.css';
import { TIME_CONTROLS } from '../../core/clock';
import { type GameConfig, type GameMode, VR_GAMEPLAY_AVAILABLE } from '../../core/config';
import { type Lang, type Quality, isStandaloneHeadset, settings } from '../../core/settings';
import * as api from '../../lichess/api';
import { getToken, login, logout } from '../../lichess/auth';
import { startBackground } from './background';
import { type LKey, L } from './strings';
import { generateRoomCode, normalizeRoomCode, roomLink } from './route';
import qrcode from 'qrcode-generator';

/** QR-Code (SVG) für den Einladungslink */
function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/**
 * Landingpage: zwei gleichwertige Einstiege (Lokales Spiel / Lichess-Match),
 * Unterauswahl, gemeinsame Einstellungen, Start-Buttons, Fußzeile.
 * Die 3D-Szene wird erst nach dem Start geladen (dynamischer Import in main.ts).
 */

type Top = 'local' | 'lichess' | null;
type LocalOpt = 'coloc' | 'hotseat' | 'engine' | 'online';
type LichessOpt = 'resume' | 'challenge' | 'ai' | 'incoming';

export interface LandingState {
  top: Top;
  local: LocalOpt | null;
  colocRole: 'host' | 'join';
  room: string;
  lichess: LichessOpt | null;
  lichessGameId: string;
  challengeUser: string;
  rated: boolean;
  aiLevel: number;
  engineLevel: number;
  color: 'w' | 'b' | 'random';
  tc: string;
  name: string;
}

const STORE = 'myzel-schach.landing.v1';

const DEFAULT_STATE: LandingState = {
  top: null, local: null, colocRole: 'host', room: '', lichess: null, lichessGameId: '',
  challengeUser: '', rated: false, aiLevel: 3, engineLevel: 3, color: 'w', tc: '10+5', name: '',
};

function loadState(): LandingState {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(s: LandingState): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* privater Modus o. Ä. – Auswahl wird nicht gemerkt */
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Ergebnis der Start-Prüfung – auch für Tests/Logik ohne DOM nutzbar. */
export function startAvailability(
  s: LandingState,
  ctx: { vrSupported: boolean; loggedIn: boolean },
): { browser: boolean; vr: boolean; reason: LKey | null; vrReason: LKey | null } {
  let reason: LKey | null = null;
  if (!s.top) reason = 'pickMode';
  else if (s.top === 'local') {
    if (!s.local) reason = 'pickMode';
    else if ((s.local === 'coloc' || s.local === 'online') && !normalizeRoomCode(s.room)) reason = 'invalidRoom';
  } else {
    if (!ctx.loggedIn) reason = 'needLogin';
    else if (!s.lichess) reason = 'pickMode';
    else if ((s.lichess === 'resume' || s.lichess === 'incoming') && !s.lichessGameId) reason = 'needGame';
    else if (s.lichess === 'challenge' && !s.challengeUser.trim()) reason = 'needUser';
    else if ((s.lichess === 'challenge' || s.lichess === 'ai') && !tcAllowedForLichess(s.tc)) reason = 'badTc';
  }
  const vrReason: LKey | null = !ctx.vrSupported ? 'vrNoSupport' : !VR_GAMEPLAY_AVAILABLE ? 'vrSoon' : null;
  // Co-Location braucht zwei Brillen: im Browser nur als Gast eines Online-Raums sinnvoll
  const colocBrowser = s.top === 'local' && s.local === 'coloc' && s.colocRole === 'host';
  return { browser: reason === null && !colocBrowser, vr: reason === null && vrReason === null, reason: reason ?? (colocBrowser ? 'colocVR' : null), vrReason };
}

function tcOf(id: string): { initial: number; increment: number } {
  return TIME_CONTROLS.find((t) => t.id === id)?.tc ?? { initial: 0, increment: 0 };
}

function tcAllowedForLichess(id: string): boolean {
  const tc = tcOf(id);
  return api.allowedForChallenge(tc.initial, tc.increment);
}

export interface LandingOptions {
  vrSupported: boolean;
  /** Direkt den Beitrittsdialog öffnen (Route ?room=). */
  joinRoom?: string;
  /** Hinweis oben anzeigen (z. B. Login-Fehler). */
  notice?: string;
  /** Nach erfolgreichem Lichess-Login direkt die Lichess-Karte öffnen. */
  openLichess?: boolean;
}

export function showLanding(root: HTMLElement, opts: LandingOptions): Promise<GameConfig> {
  return new Promise((resolve) => {
    const state = loadState();
    if (!state.name) state.name = settings.get().playerName;
    if (opts.openLichess) state.top = 'lichess';
    const phone = matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 700px)').matches && !isStandaloneHeadset();

    let acct: api.Account | null = null;
    let games: api.PlayingGame[] | null = null;
    let incoming: api.Challenge[] | null = null;
    let lichessError = '';
    let waiting: { user: string; cancel: () => void } | null = null;

    root.innerHTML = `<div class="landing"><canvas class="landing-bg" aria-hidden="true"></canvas><div class="landing-scroll"></div></div>`;
    const stopBg = startBackground(root.querySelector('canvas')!);
    const scroll = root.querySelector<HTMLElement>('.landing-scroll')!;

    const finish = (cfg: GameConfig) => {
      stopBg();
      saveState(state);
      settings.set({ playerName: state.name });
      resolve(cfg);
    };

    async function loadLichess(): Promise<void> {
      if (!getToken()) return;
      try {
        acct ??= await api.account();
        [games, incoming] = await Promise.all([api.playing(), api.challenges().then((c) => c.in.filter((x) => x.variant.key === 'standard'))]);
        lichessError = '';
      } catch (e) {
        lichessError = (e as Error).message;
      }
      render();
    }

    const card = (id: string, title: string, desc: string, active: boolean, badge = '') =>
      `<button class="opt ${active ? 'active' : ''}" data-opt="${id}" aria-pressed="${active}">
        <span class="opt-title">${title}${badge ? ` <span class="badge">${badge}</span>` : ''}</span><span class="opt-desc">${desc}</span></button>`;

    function render(): void {
      const loggedIn = !!getToken();
      const av = startAvailability(state, { vrSupported: opts.vrSupported, loggedIn });
      const tcOptions = TIME_CONTROLS.map((c) => {
        const lichessOk = tcAllowedForLichess(c.id);
        const disabled = state.top === 'lichess' && !lichessOk;
        return `<option value="${c.id}" ${c.id === state.tc ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${c.id === 'none' ? L('noClock') : c.id}${disabled ? ' (Bullet ✕)' : ''}</option>`;
      }).join('');

      let localPanel = '';
      if (state.top === 'local') {
        const coloc = `${card('coloc', L('coloc'), L('colocDesc'), state.local === 'coloc')}`;
        const opts2 = phone
          ? coloc + `<p class="note">${L('phoneNote')}</p>`
          : coloc +
            card('hotseat', L('hotseat'), L('hotseatDesc'), state.local === 'hotseat') +
            card('engine', L('engine'), L('engineDesc'), state.local === 'engine') +
            card('online', L('online'), L('onlineDesc'), state.local === 'online');
        let colocBox = '';
        if (state.local === 'coloc' || state.local === 'online') {
          const link = state.room ? roomLink(location.origin, location.pathname, state.room) : '';
          colocBox = `<div class="subbox">
            <div class="seg" role="tablist">
              <button data-role="host" class="${state.colocRole === 'host' ? 'active' : ''}">${L('host')}</button>
              <button data-role="join" class="${state.colocRole === 'join' ? 'active' : ''}">${L('join')}</button>
            </div>
            ${state.colocRole === 'host'
              ? `<p>${L('roomCode')}: <b class="code">${esc(state.room || '—')}</b></p>
                 ${link ? `<p class="linkrow"><input readonly value="${esc(link)}" aria-label="${L('roomLink')}"><button data-act="copy">${L('copy')}</button></p>
                 <div class="qr">${qrSvg(link)}</div>` : ''}
                 <p class="note">${L('netHostNote')}</p>`
              : `<label>${L('roomCode')}<input id="roomIn" value="${esc(state.room)}" maxlength="8" autocapitalize="characters" autocomplete="off"></label>
                 <p class="note">${L('netJoinNote')}</p>`}
            </div>`;
        }
        localPanel = `<section class="panel"><h2>${L('local')}</h2><div class="opts">${opts2}</div>${colocBox}</section>`;
      }

      let lichessPanel = '';
      if (state.top === 'lichess') {
        if (!loggedIn) {
          lichessPanel = `<section class="panel"><h2>${L('lichess')}</h2>
            <button class="big" data-act="login">♞ ${L('login')}</button><p class="note">${L('loginNote')}</p>
            ${lichessError ? `<p class="err">${esc(lichessError)}</p>` : ''}</section>`;
        } else {
          const gameList = games === null ? '…' : games.length === 0 ? `<p class="note">${L('noGames')}</p>` :
            games.map((g) => `<label class="pick"><input type="radio" name="lgame" value="${esc(g.gameId)}" ${state.lichess === 'resume' && state.lichessGameId === g.gameId ? 'checked' : ''}>
              vs ${esc(g.opponent.ai ? `KI ${g.opponent.ai}` : g.opponent.username)} · ${esc(g.speed)} · ${g.color === 'white' ? '♔' : '♚'}${g.isMyTurn ? ' ●' : ''}</label>`).join('');
          const inList = incoming === null ? '…' : incoming.length === 0 ? `<p class="note">${L('noIncoming')}</p>` :
            incoming.map((c) => `<label class="pick"><input type="radio" name="lchal" value="${esc(c.id)}" ${state.lichess === 'incoming' && state.lichessGameId === c.id ? 'checked' : ''}>
              ${esc(c.challenger.name)}${c.challenger.rating ? ` (${c.challenger.rating})` : ''} · ${esc(c.timeControl.show ?? c.speed)} · ${c.rated ? L('rated') : '—'}</label>`).join('');
          lichessPanel = `<section class="panel"><h2>${L('lichess')}</h2>
            <div class="acct"><span class="avatar" aria-hidden="true">${esc((acct?.username ?? '?').slice(0, 1).toUpperCase())}</span>
              <span>${L('loggedInAs')} <b>${esc(acct ? `${acct.title ? acct.title + ' ' : ''}${acct.username}` : '…')}</b></span>
              <button data-act="logout">${L('logout')}</button><button data-act="refresh" aria-label="${L('refresh')}">⟳</button></div>
            ${lichessError ? `<p class="err">${esc(lichessError)}</p>` : ''}
            <div class="opts">
              ${card('resume', L('resume'), '', state.lichess === 'resume')}
              ${state.lichess === 'resume' ? `<div class="subbox">${gameList}</div>` : ''}
              ${card('challenge', L('challenge'), L('challengeHint'), state.lichess === 'challenge')}
              ${state.lichess === 'challenge' ? `<div class="subbox"><label>${L('username')}<input id="chUser" value="${esc(state.challengeUser)}" autocomplete="off"></label>
                 <label class="check"><input type="checkbox" id="rated" ${state.rated ? 'checked' : ''}> ${L('rated')}</label></div>` : ''}
              ${card('ai', L('ai'), L('aiHint'), state.lichess === 'ai')}
              ${state.lichess === 'ai' ? `<div class="subbox"><label>${L('strength')} <b>${state.aiLevel}</b><input type="range" id="aiLvl" min="1" max="8" value="${state.aiLevel}"></label></div>` : ''}
              ${card('incoming', L('incoming'), '', state.lichess === 'incoming')}
              ${state.lichess === 'incoming' ? `<div class="subbox">${inList}</div>` : ''}
            </div><p class="note">${L('fairPlay')}</p></section>`;
        }
      }

      const showSettings = (state.top === 'local' && state.local) || (state.top === 'lichess' && loggedIn && state.lichess);
      const needsColorTc = state.top === 'local' ? state.local !== 'coloc' || state.colocRole === 'host' : state.lichess === 'challenge' || state.lichess === 'ai';
      const settingsPanel = showSettings
        ? `<section class="panel"><h2>${L('settingsTitle')}</h2><div class="grid">
            ${state.top === 'local' ? `<label>${L('name')}<input id="name" value="${esc(state.name)}" maxlength="24" autocomplete="nickname"></label>` : ''}
            ${needsColorTc && state.local !== 'hotseat' ? `<label>${L('color')}<select id="color">
              <option value="w" ${state.color === 'w' ? 'selected' : ''}>${L('white')}</option>
              <option value="b" ${state.color === 'b' ? 'selected' : ''}>${L('black')}</option>
              <option value="random" ${state.color === 'random' ? 'selected' : ''}>${L('random')}</option></select></label>` : ''}
            ${needsColorTc ? `<label>${L('timeControl')}<select id="tc">${tcOptions}</select></label>` : ''}
            ${state.top === 'local' && state.local === 'engine' ? `<label>${L('strength')} <b>${state.engineLevel}</b><input type="range" id="engLvl" min="1" max="8" value="${state.engineLevel}"></label>` : ''}
          </div></section>`
        : '';

      const waitBox = waiting ? `<div class="waiting" role="status">${L('waiting', { user: esc(waiting.user) })} <button data-act="cancelWait">${L('cancel')}</button></div>` : '';

      scroll.innerHTML = `
        <main class="landing-main">
          <header class="hero"><h1>${L('title')}</h1><p>${L('subtitle')}</p></header>
          ${opts.notice ? `<p class="err banner">${esc(opts.notice)}</p>` : ''}
          <section class="tops">
            <button class="top ${state.top === 'local' ? 'active' : ''}" data-top="local" aria-pressed="${state.top === 'local'}">
              <span class="top-icon" aria-hidden="true">♜</span><span class="top-title">${L('local')}</span><span class="top-desc">${L('localDesc')}</span></button>
            <button class="top ${state.top === 'lichess' ? 'active' : ''}" data-top="lichess" aria-pressed="${state.top === 'lichess'}">
              <span class="top-icon" aria-hidden="true">♞</span><span class="top-title">${L('lichess')}</span><span class="top-desc">${L('lichessDesc')}</span></button>
          </section>
          ${localPanel}${lichessPanel}${settingsPanel}
          <section class="start-row">
            <button class="big primary" id="startVR" ${av.vr && !waiting ? '' : 'disabled'} aria-describedby="vrWhy">${L('startVR')}</button>
            <button class="big primary" id="startBrowser" ${av.browser && !waiting ? '' : 'disabled'} aria-describedby="why">${L('startBrowser')}</button>
            <p class="why" id="why">${av.reason ? L(av.reason) : ''}</p>
            <p class="why" id="vrWhy">${av.vrReason ? L(av.vrReason) : ''}</p>
            ${waitBox}
          </section>
        </main>
        <footer class="landing-foot">
          <label>${L('language')} <select id="lang"><option value="de">Deutsch</option><option value="en">English</option></select></label>
          <label>${L('quality')} <select id="quality">
            <option value="auto">${L('qAuto')}</option><option value="low">${L('qLow')}</option><option value="medium">${L('qMedium')}</option><option value="high">${L('qHigh')}</option></select></label>
          <button data-act="help">${L('help')}</button>
          <a href="https://lichess.org" target="_blank" rel="noopener">lichess.org ↗</a>
        </footer>
        <dialog id="helpDlg"><h2>${L('help')}</h2>${L('helpBody')}<form method="dialog"><button>${L('close')}</button></form></dialog>
        <dialog id="joinDlg"><h2>${L('joinTitle')}</h2>
          <form method="dialog" id="joinForm"><label>${L('roomCode')}<input id="joinIn" maxlength="10" autocapitalize="characters" autocomplete="off"></label>
          <p class="err" id="joinErr"></p><p class="note">${L('colocDesc')}</p>
          <div class="row"><button value="cancel" formnovalidate>${L('cancel')}</button><button value="ok" id="joinOk">${L('joinBtn')}</button></div></form></dialog>`;
      bind();
    }

    function bind(): void {
      const $ = <T extends HTMLElement>(sel: string) => scroll.querySelector<T>(sel);
      scroll.querySelectorAll<HTMLButtonElement>('[data-top]').forEach((b) =>
        b.addEventListener('click', () => {
          state.top = b.dataset.top as Top;
          if (state.top === 'lichess') void loadLichess();
          saveState(state);
          render();
        }),
      );
      scroll.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) =>
        b.addEventListener('click', () => {
          const o = b.dataset.opt!;
          if (state.top === 'local') {
            state.local = o as LocalOpt;
            if ((o === 'coloc' || o === 'online') && state.colocRole === 'host' && !state.room) state.room = generateRoomCode();
          } else {
            if (state.lichess !== o) state.lichessGameId = '';
            state.lichess = o as LichessOpt;
            if (o === 'ai' && !tcAllowedForLichess(state.tc)) state.tc = '10+5';
          }
          saveState(state);
          render();
        }),
      );
      scroll.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((b) =>
        b.addEventListener('click', () => {
          state.colocRole = b.dataset.role as 'host' | 'join';
          state.room = state.colocRole === 'host' ? generateRoomCode() : '';
          render();
        }),
      );
      const on = (sel: string, ev: string, fn: (el: HTMLInputElement) => void) => {
        const el = $<HTMLInputElement>(sel);
        if (el) el.addEventListener(ev, () => fn(el));
      };
      on('#roomIn', 'input', (el) => (state.room = normalizeRoomCode(el.value) ?? el.value.toUpperCase()));
      on('#name', 'input', (el) => (state.name = el.value.trim()));
      on('#color', 'change', (el) => (state.color = el.value as LandingState['color']));
      on('#tc', 'change', (el) => { state.tc = el.value; render(); });
      on('#engLvl', 'input', (el) => { state.engineLevel = Number(el.value); el.previousElementSibling!.textContent = el.value; });
      on('#aiLvl', 'input', (el) => { state.aiLevel = Number(el.value); el.previousElementSibling!.textContent = el.value; });
      on('#chUser', 'input', (el) => {
        state.challengeUser = el.value.trim();
        const av = startAvailability(state, { vrSupported: opts.vrSupported, loggedIn: !!getToken() });
        $<HTMLButtonElement>('#startBrowser')!.disabled = !av.browser;
        $<HTMLElement>('#why')!.textContent = av.reason ? L(av.reason) : '';
      });
      on('#rated', 'change', (el) => (state.rated = el.checked));
      scroll.querySelectorAll<HTMLInputElement>('input[name=lgame], input[name=lchal]').forEach((r) =>
        r.addEventListener('change', () => { state.lichessGameId = r.value; render(); }),
      );

      const lang = $<HTMLSelectElement>('#lang')!;
      lang.value = settings.get().lang;
      lang.addEventListener('change', () => { settings.set({ lang: lang.value as Lang }); document.documentElement.lang = lang.value; render(); });
      const q = $<HTMLSelectElement>('#quality')!;
      q.value = settings.get().quality ?? 'auto';
      q.addEventListener('change', () => settings.set({ quality: q.value === 'auto' ? null : (q.value as Quality) }));

      const acts: Record<string, () => void> = {
        login: () => void login().catch((e) => { lichessError = String(e.message ?? e); render(); }),
        logout: () => void logout().then(() => { acct = null; games = incoming = null; render(); }),
        refresh: () => void loadLichess(),
        help: () => $<HTMLDialogElement>('#helpDlg')!.showModal(),
        copy: () => {
          const v = $<HTMLInputElement>('.linkrow input')!.value;
          void navigator.clipboard?.writeText(v).catch(() => undefined);
        },
        cancelWait: () => { waiting?.cancel(); waiting = null; render(); },
      };
      scroll.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => acts[b.dataset.act!]()));

      // Beitrittsdialog
      const joinDlg = $<HTMLDialogElement>('#joinDlg')!;
      $<HTMLFormElement>('#joinForm')!.addEventListener('submit', (e) => {
        const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value !== 'ok') return;
        const code = normalizeRoomCode($<HTMLInputElement>('#joinIn')!.value);
        if (!code) {
          e.preventDefault();
          $<HTMLElement>('#joinErr')!.textContent = L('invalidRoom');
          return;
        }
        state.top = 'local';
        state.local = 'coloc';
        state.colocRole = 'join';
        state.room = code;
        saveState(state);
        setTimeout(render);
      });

      $<HTMLButtonElement>('#startBrowser')!.addEventListener('click', () => void start(false));
      $<HTMLButtonElement>('#startVR')!.addEventListener('click', () => void start(true));
      openJoin = () => {
        $<HTMLInputElement>('#joinIn')!.value = opts.joinRoom ?? '';
        joinDlg.showModal();
      };
    }

    let openJoin: () => void = () => {};

    async function start(vr: boolean): Promise<void> {
      const base = { name: state.name, color: state.color, tc: state.tc, engineLevel: state.engineLevel, vr };
      if (state.top === 'local') {
        const mode: GameMode =
          state.local === 'coloc' ? (state.colocRole === 'host' ? 'coloc-host' : 'coloc-join') : state.local === 'online' ? 'online-link' : (state.local as GameMode);
        const net = state.local === 'coloc' || state.local === 'online';
        finish({ ...base, mode, room: state.room || undefined, role: net ? (state.colocRole === 'host' ? 'host' : 'guest') : undefined });
        return;
      }
      // Lichess
      const lcColor = state.color === 'w' ? 'white' : state.color === 'b' ? 'black' : 'random';
      const tc = tcOf(state.tc);
      const clock = tc.initial > 0 ? { limit: tc.initial, increment: tc.increment } : {};
      try {
        lichessError = '';
        if (state.lichess === 'resume') finish({ ...base, mode: 'lichess', lichess: { gameId: state.lichessGameId } });
        else if (state.lichess === 'incoming') {
          await api.acceptChallenge(state.lichessGameId);
          finish({ ...base, mode: 'lichess', lichess: { gameId: state.lichessGameId } });
        } else if (state.lichess === 'ai') {
          const g = await api.challengeAI(state.aiLevel, clock, lcColor);
          finish({ ...base, mode: 'lichess', lichess: { gameId: g.id } });
        } else if (state.lichess === 'challenge') {
          const ch = await api.challengeUser(state.challengeUser, clock, lcColor, state.rated);
          const gameId = await waitForAcceptance(ch.id, state.challengeUser);
          if (gameId) finish({ ...base, mode: 'lichess', lichess: { gameId } });
        }
      } catch (e) {
        lichessError = (e as Error).message;
        render();
      }
    }

    /** Wartet über den Event-Stream auf Spielstart (Annahme) oder Ablehnung/Ablauf. */
    function waitForAcceptance(challengeId: string, user: string): Promise<string | null> {
      return new Promise((res) => {
        type Ev = { type: string; game?: { id?: string; gameId?: string }; challenge?: { id: string } };
        let done = false;
        const end = (v: string | null, msg?: LKey) => {
          if (done) return;
          done = true;
          stop();
          clearTimeout(timer);
          waiting = null;
          if (msg) lichessError = L(msg);
          render();
          res(v);
        };
        const stop = api.stream<Ev>('/api/stream/event', (e) => {
          const gid = e.game?.gameId ?? e.game?.id;
          if (e.type === 'gameStart' && gid === challengeId) end(challengeId);
          if (e.type === 'challengeDeclined' && e.challenge?.id === challengeId) end(null, 'declined');
        }, (err) => { if (err) end(null); });
        const timer = setTimeout(() => { void api.cancelChallenge(challengeId).catch(() => undefined); end(null, 'expired'); }, 25_000);
        waiting = { user, cancel: () => { void api.cancelChallenge(challengeId).catch(() => undefined); end(null); } };
        render();
      });
    }

    document.documentElement.lang = settings.get().lang;
    render();
    if (state.top === 'lichess') void loadLichess();
    if (opts.joinRoom) openJoin();
  });
}
