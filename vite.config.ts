import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR braucht einen sicheren Kontext. Lokal liefert plugin-basic-ssl ein
// selbstsigniertes Zertifikat; `host: true` macht den Server im LAN erreichbar
// (z. B. für die Quest unter https://<PC-IP>:5173).
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
