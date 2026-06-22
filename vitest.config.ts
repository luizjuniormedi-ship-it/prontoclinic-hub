import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/services/**/*.ts'],
      exclude: [
        'node_modules/**',
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/types/**',
        '**/*.d.ts',
        'src/lib/supabase.ts',
        'src/lib/env.ts'
      ],
      // Thresholds por arquivo — aplicados apenas aos services testados.
      // Conforme novos testes forem adicionados, expanda esta lista.
      // Meta de evolução: 70% lines / 60% branches / 70% funcs / 70% stmts.
      thresholds: {
        'src/services/statusTransitions.ts': {
          lines: 70, branches: 60, functions: 70, statements: 70,
        },
        'src/services/validationService.ts': {
          lines: 60, branches: 50, functions: 60, statements: 60,
        },
        'src/services/patientsService.ts': {
          lines: 50, branches: 45, functions: 50, statements: 50,
        },
        'src/services/priceTableService.ts': {
          lines: 50, branches: 50, functions: 30, statements: 50,
        },
        'src/services/insuranceService.ts': {
          lines: 40, branches: 40, functions: 30, statements: 40,
        },
        'src/services/lgpdService.ts': {
          lines: 60, branches: 55, functions: 60, statements: 60,
        },
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});