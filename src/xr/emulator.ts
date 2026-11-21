/**
 * Debug-Modus ohne Brille: Meta „Immersive Web Emulation Runtime“ (IWER) simuliert eine
 * Quest 3 mit Controllern bzw. Händen im normalen Browser. Wird nur mit `?xremu=1` geladen
 * (eigener Chunk, nicht im normalen Bundle).
 *
 *   ?xremu=1               Quest 3 mit Controllern
 *   &hands=1               Handtracking statt Controller
 *   &bounds=4x3            Test-Spielfläche 4 × 3 m (IWER liefert selbst keine boundsGeometry);
 *                          ohne → manuelle Flächeneinrichtung (Ecken antippen)
 *
 * Steuerung per Konsole: `window.__myzelXR` (XRDevice von IWER), z. B.
 *   __myzelXR.controllers.right.position.set(0.2, 0.8, 1)
 *   __myzelXR.controllers.right.updateButtonValue('trigger', 1)
 */
export async function installEmulator(params: URLSearchParams): Promise<void> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const dev = new XRDevice(metaQuest3, { stereoEnabled: false });
  dev.installRuntime();
  dev.position.set(0, 1.6, 1.4);
  if (params.get('hands') === '1') dev.primaryInputMode = 'hand';
  const b = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(params.get('bounds') ?? '');
  if (b) {
    const w = Number(b[1]) / 2;
    const d = Number(b[2]) / 2;
    (window as unknown as { __myzelDebugBounds: { x: number; z: number }[] }).__myzelDebugBounds = [
      { x: -w, z: -d }, { x: w, z: -d }, { x: w, z: d }, { x: -w, z: d },
    ];
  }
  (window as unknown as { __myzelXR: unknown }).__myzelXR = dev;
}
