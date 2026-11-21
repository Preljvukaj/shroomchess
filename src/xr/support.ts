/** Erkennt, ob `immersive-vr` verfügbar ist (Spezifikation 2: automatische Moduserkennung). */
export async function isVRSupported(): Promise<boolean> {
  if (!window.isSecureContext) return false;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}
