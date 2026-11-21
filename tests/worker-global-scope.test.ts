import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Cloudflare global scope', () => {
  // Workers reject random values and timers while a module loads; the live site answered 1101 when one slipped in.
  it('loads the server without generating random values or starting timers', async () => {
    vi.resetModules();
    const forbidden = () => { throw new Error('Disallowed operation called within global scope.'); };
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: forbidden, getRandomValues: forbidden });
    vi.stubGlobal('setTimeout', forbidden);
    vi.stubGlobal('setInterval', forbidden);
    await expect(import('../server/studio')).resolves.toBeDefined();
  });
});
