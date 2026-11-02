import { readFileSync } from 'node:fs';

import { jsonObjectGuard } from '@logto/schemas';
import request from 'supertest';

import { createApp, token, setupKuboTest, cleanupKuboTest } from '#src/test-utils/kubo.js';
import { safeParseJson } from '#src/utils/json.js';

const { jest } = import.meta;

describe('console tenant feature-flag PATCH contract', () => {
  beforeEach(setupKuboTest);
  afterEach(cleanupKuboTest);

  it.each(['true', 'false'])(
    'accepts console-emitted %s strings, not JSON booleans',
    async (value) => {
      // Cross-package test fixture: the console component asserts its emitted PATCH body equals this
      // exact example. Exercise it through the existing real route/schema/auth harness without
      // exporting or duplicating the private tenantPatch schema in the console.
      const fixtures = jsonObjectGuard.parse(
        safeParseJson(
          readFileSync(
            new URL(
              '../../../console/src/pages/Kubo/Stack/tenant-feature-flag-patches.json',
              import.meta.url
            ),
            'utf8'
          )
        )
      );
      const body = jsonObjectGuard.parse(fixtures[value]);
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
      const app = createApp();
      const bearer = `Bearer ${await token()}`;
      const response = await request(app)
        .patch('/kubo/stacks/team-a/foundation?scope=tenant')
        .set('Authorization', bearer)
        .send(body);
      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('PATCH');
      expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(body));

      fetchSpy.mockClear();
      const incompatible = await request(app)
        .patch('/kubo/stacks/team-a/foundation?scope=tenant')
        .set('Authorization', bearer)
        .send({ featureFlags: { sample: value === 'true' } });
      expect(incompatible.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );
});
