import { defaultLandingPageContent } from '@logto/schemas';

import { editLandingPageDraft, enabledAskAiTools } from './ai-chat-landing-page.js';

const { jest } = import.meta;

describe('editLandingPageDraft', () => {
  it('reads the authorized draft and asks the editor AI for a validated edit', async () => {
    const edited = {
      ...defaultLandingPageContent,
      sections: defaultLandingPageContent.sections.map((section) =>
        section.id === 'trust' ? { ...section, heading: 'AI governance' } : section
      ),
    };
    const fetchImpl = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ draft: defaultLandingPageContent }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ draft: edited }), { status: 200 }));

    const result = await editLandingPageDraft({
      instruction: 'Add an AI section by duplicating Security & Governance.',
      apiBase: 'https://console.example.com/api',
      token: 'caller-token',
      fetchImpl,
    });

    expect(result).toEqual(edited);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://console.example.com/api/landing-page/editor',
      'https://console.example.com/api/landing-page/ai-edit',
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer caller-token' },
    });
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer caller-token', 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      instruction: 'Add an AI section by duplicating Security & Governance.',
      draft: defaultLandingPageContent,
    });
  });

  it('stops when the caller cannot read the editor draft', async () => {
    const fetchImpl = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 403 }));

    await expect(
      editLandingPageDraft({
        instruction: 'Add an AI section.',
        apiBase: 'https://console.example.com/api',
        token: 'caller-token',
        fetchImpl,
      })
    ).rejects.toThrow('Landing page editor request failed (403)');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('offers landing-page editing only when dev features are enabled', () => {
    expect(enabledAskAiTools(false).map(({ name }) => name)).not.toContain('edit_landing_page');
    expect(enabledAskAiTools(true).map(({ name }) => name)).toContain('edit_landing_page');
  });
});
