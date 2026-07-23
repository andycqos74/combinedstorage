import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

// Point the app's config/db at a throwaway data dir so tests never touch real data.
const DATA_DIR = path.join(os.tmpdir(), `combinedstorage-vitest-${process.pid}`);

export default defineConfig({
  test: {
    env: { DATA_DIR },
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
