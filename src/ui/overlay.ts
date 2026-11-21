import { type ClockState, formatClock } from '../core/clock';
import { type Quality, settings } from '../core/settings';
import type { Color, GameResult, PieceSymbol } from '../core/types';
import { type I18nKey, colorName, t } from './i18n';

export interface OverlayHandlers {
  resign(): void;
  offerDraw(): void;
  undo(): void;
  flip(): void;
  camera(mode: 'orbit' | 'first'): void;
  newGame(): void;
  rematch(): void;
  savePgn(): void;
  copyPgn(): void;
  exportLichess(): void;
  analysis(on: boolean): void;
  analysisStep(ply: number): void;
  qualityChanged(q: Quality | null): void;
}

const GLYPH: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 2D-Overlay für den Desktop-Modus: Zugliste (SAN), Uhr, geschlagene Figuren, Menü. */
export class Overlay {
  private el: HTMLElement;
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
  private analysisPly = 0;
  private analysisMax = 0;
  private subTimer = 0;
  names: Record<Color, string> = { w: '', b: '' };

  constructor(parent: HTMLElement, private h: OverlayHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    parent.appendChild(this.el);
    this.render();
    settings.on('change', () => this.render());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
      if (!this.q('.analysis').hidden) {
        if (e.key === 'ArrowLeft') this.stepAnalysis(this.analysisPly - 1);
        if (e.key === 'ArrowRight') this.stepAnalysis(this.analysisPly + 1);
        if (e.key === 'Home') this.stepAnalysis(0);
        if (e.key === 'End') this.stepAnalysis(this.analysisMax);
      }
      if (e.key === 'Escape') this.toggleMenu();
      if (e.key === 'f' || e.key === 'F') this.h.flip();
    });
  }

  private render(): void {
    const s = settings.get();
    const qv = s.quality ?? 'auto';
    this.el.innerHTML = `
      <div class="panel side">
        <div class="clock-row" data-c="b"><span class="name"></span><span class="clock">–</span></div>
        <div class="captured" data-c="b"></div>
        <div class="status" aria-live="polite"></div>
        <div class="moves-wrap"><div class="moves-title">${t('moves')}</div><ol class="moves"></ol></div>
        <div class="captured" data-c="w"></div>
        <div class="clock-row" data-c="w"><span class="name"></span><span class="clock">–</span></div>
        <button class="menu-btn">☰ ${t('menu')}</button>
      </div>
      <div class="hint"></div>
      <div class="subtitle" aria-live="polite"></div>
      <div class="toast" hidden></div>
      <div class="modal menu" hidden>
        <div class="modal-card">
          <h2>${t('menu')}</h2>
          <div class="btn-col">
            <button data-a="undo">↶ ${t('undo')}</button>
            <button data-a="draw">½ ${t('offerDraw')}</button>
            <button data-a="resign">⚑ ${t('resign')}</button>
            <button data-a="flip">⟲ ${t('flip')} (F)</button>
            <button data-a="cam-orbit">◎ ${t('camOrbit')}</button>
            <button data-a="cam-first">⛶ ${t('camFirst')}</button>
            <button data-a="pgn">⤓ ${t('savePgn')}</button>
            <button data-a="new">✦ ${t('newGame')}</button>
          </div>
          <h3>${t('settings')}</h3>
          <div class="settings">
            <label>${t('language')} <select data-s="lang"><option value="de">Deutsch</option><option value="en">English</option></select></label>
            <label>${t('quality')} <select data-s="quality">
              <option value="auto">${t('qAuto')}</option><option value="low">${t('qLow')}</option>
              <option value="medium">${t('qMedium')}</option><option value="high">${t('qHigh')}</option></select></label>
            <label><input type="checkbox" data-s="colorblind"> ${t('colorblind')}</label>
            <label><input type="checkbox" data-s="markNoLegalMoves"> ${t('markNoMoves')}</label>
            <label><input type="checkbox" data-s="subtitles"> ${t('subtitles')}</label>
            <label>${t('volume')} <input type="range" min="0" max="1" step="0.05" data-s="volume"></label>
            <label>${t('creatures')} <input type="range" min="0" max="1" step="0.05" data-s="creaturesVolume"></label>
            <label><input type="checkbox" data-s="insects"> ${t('insects')}</label>
            <label><input type="checkbox" data-s="insectLanding"> ${t('insectLanding')}</label>
            <label>${t('coordSize')} <select data-s="coordSize"><option value="S">S</option><option value="M">M</option><option value="L">L</option></select></label>
            <label><input type="checkbox" data-s="coordHighContrast"> ${t('coordContrast')}</label>
            <label><input type="checkbox" data-s="coordsOnSquares"> ${t('coordsOnSquares')}</label>
            <label>${t('pieceContrast')} <select data-s="pieceContrast"><option value="off">${t('pcOff')}</option><option value="normal">${t('pcNormal')}</option><option value="high">${t('pcHigh')}</option></select></label>
            <label><input type="checkbox" data-s="whiteOutline"> ${t('whiteOutline')}</label>
          </div>
          <button class="close">${t('close')}</button>
        </div>
      </div>
      <div class="modal end" hidden>
        <div class="modal-card">
          <h2 class="end-title"></h2>
          <div class="btn-col">
            <button data-a="rematch">↻ ${t('rematch')}</button>
            <button data-a="pgn">⤓ ${t('savePgn')}</button>
            <button data-a="copy">⧉ ${t('copyPgn')}</button>
            <button data-a="lichess">♞ ${t('exportLichess')}</button>
            <button data-a="analysis">⌕ ${t('analysis')}</button>
            <button data-a="new">✦ ${t('newGame')}</button>
          </div>
          <button class="close">${t('close')}</button>
        </div>
      </div>
      <div class="modal confirm" hidden>
        <div class="modal-card"><h2 class="confirm-q"></h2>
          <div class="btn-row"><button data-v="1">${t('yes')}</button><button data-v="0">${t('no')}</button></div></div>
      </div>
      <div class="analysis" hidden>
        <button data-n="first">⏮</button><button data-n="prev">◀</button>
        <span class="ply"></span>
        <button data-n="next">▶</button><button data-n="last">⏭</button>
        <button data-n="exit">✕</button>
        <div class="analysis-hint">${t('analysisHint')}</div>
      </div>`;

    this.q('.menu-btn').addEventListener('click', () => this.toggleMenu());
    this.el.querySelectorAll<HTMLButtonElement>('.modal .close').forEach((b) =>
      b.addEventListener('click', () => (b.closest<HTMLElement>('.modal')!.hidden = true)),
    );
    const act: Record<string, () => void> = {
      undo: () => this.h.undo(),
      draw: () => this.h.offerDraw(),
      resign: () => this.h.resign(),
      flip: () => this.h.flip(),
      'cam-orbit': () => this.h.camera('orbit'),
      'cam-first': () => this.h.camera('first'),
      pgn: () => this.h.savePgn(),
      copy: () => this.h.copyPgn(),
      lichess: () => this.h.exportLichess(),
      rematch: () => this.h.rematch(),
      new: () => this.h.newGame(),
      analysis: () => this.h.analysis(true),
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        b.closest<HTMLElement>('.modal')!.hidden = true;
        act[b.dataset.a!]();
      }),
    );
    // Einstellungen
    this.q<HTMLSelectElement>('[data-s=lang]').value = s.lang;
    this.q<HTMLSelectElement>('[data-s=quality]').value = qv;
    for (const k of ['colorblind', 'markNoLegalMoves', 'subtitles', 'insects', 'insectLanding', 'coordHighContrast', 'coordsOnSquares', 'whiteOutline'] as const) {
      const cb = this.q<HTMLInputElement>(`[data-s=${k}]`);
      cb.checked = s[k];
      cb.addEventListener('change', () => settings.set({ [k]: cb.checked }));
    }
    const cv = this.q<HTMLInputElement>('[data-s=creaturesVolume]');
    cv.value = String(s.creaturesVolume);
    cv.addEventListener('input', () => settings.set({ creaturesVolume: Number(cv.value) }));
    const pc = this.q<HTMLSelectElement>('[data-s=pieceContrast]');
    pc.value = s.pieceContrast;
    pc.addEventListener('change', () => settings.set({ pieceContrast: pc.value as 'off' | 'normal' | 'high' }));
    const cs = this.q<HTMLSelectElement>('[data-s=coordSize]');
    cs.value = s.coordSize;
    cs.addEventListener('change', () => settings.set({ coordSize: cs.value as 'S' | 'M' | 'L' }));
    const vol = this.q<HTMLInputElement>('[data-s=volume]');
    vol.value = String(s.volume);
    vol.addEventListener('input', () => settings.set({ volume: Number(vol.value) }));
    this.q<HTMLSelectElement>('[data-s=lang]').addEventListener('change', (e) =>
      settings.set({ lang: (e.target as HTMLSelectElement).value as 'de' | 'en' }),
    );
    this.q<HTMLSelectElement>('[data-s=quality]').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.h.qualityChanged(v === 'auto' ? null : (v as Quality));
    });
    // Analyse
    const nav: Record<string, () => void> = {
      first: () => this.stepAnalysis(0),
      prev: () => this.stepAnalysis(this.analysisPly - 1),
      next: () => this.stepAnalysis(this.analysisPly + 1),
      last: () => this.stepAnalysis(this.analysisMax),
      exit: () => this.h.analysis(false),
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => b.addEventListener('click', () => nav[b.dataset.n!]()));
    this.onRerender?.();
  }

  /** Wird nach jedem Neu-Rendern (Sprachwechsel) aufgerufen, damit der Inhalt wieder befüllt wird. */
  onRerender: (() => void) | null = null;

  toggleMenu(): void {
    const m = this.q('.menu');
    m.hidden = !m.hidden;
  }

  setStatus(text: string, alert = false): void {
    const s = this.q('.status');
    s.textContent = text;
    s.classList.toggle('alert', alert);
  }

  setClocks(state: ClockState | null, turn: Color): void {
    for (const c of ['w', 'b'] as Color[]) {
      const row = this.q(`.clock-row[data-c=${c}]`);
      row.querySelector('.name')!.textContent = this.names[c] || colorName(c);
      row.querySelector('.clock')!.textContent = state ? formatClock(state[c]) : '';
      row.classList.toggle('active', turn === c);
      row.classList.toggle('low', !!state && state[c] < 20_000);
    }
  }

  setMoves(san: string[], highlightPly?: number): void {
    const ol = this.q('.moves');
    let html = '';
    for (let i = 0; i < san.length; i += 2) {
      const cls = (k: number) => (highlightPly === k + 1 ? ' class="cur"' : '');
      html += `<li><span${cls(i)}>${esc(san[i])}</span>${san[i + 1] ? `<span${cls(i + 1)}>${esc(san[i + 1])}</span>` : ''}</li>`;
    }
    ol.innerHTML = html;
    ol.parentElement!.scrollTop = ol.parentElement!.scrollHeight;
  }

  /** `capturedBy[c]` = von Farbe c geschlagene Figuren; angezeigt neben dem Schlagenden. */
  setCaptured(capturedBy: Record<Color, PieceSymbol[]>): void {
    for (const c of ['w', 'b'] as Color[]) {
      const opp: Color = c === 'w' ? 'b' : 'w';
      const sorted = [...capturedBy[c]].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      this.q(`.captured[data-c=${c}]`).textContent = sorted.map((p) => GLYPH[opp][p]).join('');
    }
  }

  setHint(text: string): void {
    this.q('.hint').textContent = text;
  }

  toast(text: string, ms = 3500): void {
    const el = this.q('.toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(Number(el.dataset.timer));
    el.dataset.timer = String(window.setTimeout(() => (el.hidden = true), ms));
  }

  subtitle(key: I18nKey): void {
    if (!settings.get().subtitles) return;
    const el = this.q('.subtitle');
    el.textContent = t(key);
    el.classList.add('show');
    clearTimeout(this.subTimer);
    this.subTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  confirm(question: string): Promise<boolean> {
    const m = this.q('.confirm');
    this.q('.confirm-q').textContent = question;
    m.hidden = false;
    return new Promise((res) => {
      m.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => {
        b.onclick = () => {
          m.hidden = true;
          res(b.dataset.v === '1');
        };
      });
    });
  }

  showEnd(r: GameResult | null): void {
    const m = this.q('.end');
    if (!r) {
      m.hidden = true;
      return;
    }
    this.q('.end-title').textContent = resultText(r);
    m.hidden = false;
  }

  showAnalysis(on: boolean, max = 0): void {
    this.q('.analysis').hidden = !on;
    this.analysisMax = max;
    if (on) this.stepAnalysis(max);
  }

  private stepAnalysis(ply: number): void {
    this.analysisPly = Math.max(0, Math.min(this.analysisMax, ply));
    this.q('.ply').textContent = `${this.analysisPly} / ${this.analysisMax}`;
    this.h.analysisStep(this.analysisPly);
  }

  get analysisIndex(): number {
    return this.analysisPly;
  }
}

export function resultText(r: GameResult): string {
  const winner = r.winner ? colorName(r.winner) : '';
  const loser = r.winner ? colorName(r.winner === 'w' ? 'b' : 'w') : '';
  if (r.reason === 'timeout' && !r.winner) return t('end.timeoutDraw');
  return t(`end.${r.reason}` as I18nKey, { winner, loser });
}
