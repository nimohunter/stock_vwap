import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so tests can import app modules the same way.
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts'],
  },
});
