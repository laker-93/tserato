import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // the write tests copy the fixture and shell out to pyserato; give them room
    testTimeout: 30000,
  },
});
