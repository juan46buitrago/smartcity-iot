import { defineConfig } from 'vitest/config';

// Configuración propia: las pruebas no necesitan los complementos de Vite (Tailwind, React) de la app.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
