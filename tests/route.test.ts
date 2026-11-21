import { describe, expect, it } from 'vitest';
import { generateRoomCode, normalizeRoomCode, parseRoute, roomLink } from '../src/ui/landing/route';

describe('Landingpage-Routing', () => {
  it('ohne Parameter → Landingpage', () => {
    expect(parseRoute('')).toEqual({ view: 'landing' });
    expect(parseRoute('?foo=bar')).toEqual({ view: 'landing' });
  });

  it('?room=XXXX → Beitrittsdialog mit normalisiertem Code', () => {
    expect(parseRoute('?room=abcd')).toEqual({ view: 'join', room: 'ABCD' });
    expect(parseRoute('?room=ab-cd 7')).toEqual({ view: 'join', room: 'ABCD7' });
  });

  it('ungültiger Raumcode → Landingpage statt Fehlerseite', () => {
    expect(parseRoute('?room=')).toEqual({ view: 'landing' });
    expect(parseRoute('?room=ab')).toEqual({ view: 'landing' });
    expect(parseRoute('?room=<script>')).toEqual({ view: 'landing' });
    expect(parseRoute('?room=ABCDEFGHJK')).toEqual({ view: 'landing' }); // zu lang
  });

  it('OAuth-Rückkehr hat Vorrang', () => {
    expect(parseRoute('?code=xyz&state=s1&room=ABCD')).toEqual({ view: 'oauth-callback', code: 'xyz', state: 's1' });
    expect(parseRoute('?error=access_denied')).toEqual({ view: 'oauth-error', error: 'access_denied' });
  });

  it('Debug-Autostart', () => {
    expect(parseRoute('?autostart=engine')).toEqual({ view: 'autostart', mode: 'engine' });
    expect(parseRoute('?autostart=lichess')).toEqual({ view: 'landing' });
  });

  it('Raumcodes: generiert gültig, verwechselbare Zeichen ausgeschlossen', () => {
    for (let i = 0; i < 200; i++) expect(normalizeRoomCode(generateRoomCode())).not.toBeNull();
    expect(normalizeRoomCode('AB0D')).toBeNull();
    expect(normalizeRoomCode('ABOD')).toBeNull(); // O → 0 → ungültig
    expect(roomLink('https://x.y', '/app/', 'ABCD')).toBe('https://x.y/app/?room=ABCD');
  });
});
