import { describe, expect, it } from 'vitest';

import { defaultMetadata } from './constant.js';
import { acsSmsConfigGuard } from './types.js';

describe('ACS SMS default templates', () => {
  it('uses meshX branding and preserves verification code placeholders', () => {
    const { templates } = acsSmsConfigGuard.parse({
      endpoint: 'https://example.communication.azure.com',
      accessKey: 'test-only-key',
      fromNumber: '+18001110000',
      templates: defaultMetadata.formItems?.find(({ key }) => key === 'templates')?.defaultValue,
    });

    expect(templates.find(({ usageType }) => usageType === 'SignIn')?.content).toBe(
      'Your meshX sign-in verification code is {{code}}. The code will remain active for 10 minutes.'
    );
    for (const { content } of templates) {
      expect(content).toMatch(/^Your meshX /);
      expect(content).toContain('{{code}}');
      expect(content).not.toContain('Logto');
    }
  });
});
