import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migrate } from '../src/db/migrate';
import { chooseBackend } from '../src/services/placement';
import { InsufficientSpaceError } from '../src/util/errors';
import { resetDb, makeLocalBackend } from './helpers';

describe('chooseBackend (most-free-space placement)', () => {
  beforeAll(() => migrate());
  beforeEach(() => resetDb());

  it('picks the backend with the most free space', async () => {
    makeLocalBackend('A', 10_000);
    const big = makeLocalBackend('B', 100_000);
    const chosen = await chooseBackend(1000);
    expect(chosen.id).toBe(big.id);
  });

  it('skips backends that cannot fit the file', async () => {
    makeLocalBackend('small', 500);
    const big = makeLocalBackend('big', 5000);
    const chosen = await chooseBackend(1000);
    expect(chosen.id).toBe(big.id);
  });

  it('throws InsufficientSpaceError when nothing fits', async () => {
    makeLocalBackend('tiny', 100);
    await expect(chooseBackend(1_000_000)).rejects.toBeInstanceOf(InsufficientSpaceError);
  });
});
