import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

// Point the app's config/db at a throwaway data dir so tests never touch real data.
const DATA_DIR = path.join(os.tmpdir(), `combinedstorage-vitest-${process.pid}`);

export default defineConfig({
  test: {
    // Dummy Google creds so config.google is populated for the OAuth-URL test.
    env: {
      DATA_DIR,
      GOOGLE_CLIENT_ID: 'test-google-client',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
    },
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
