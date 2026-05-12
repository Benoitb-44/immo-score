import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/financial-calc.ts', 'src/lib/repositories/loyer.repository.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
