import { defaultLandingPageContent } from '@logto/schemas';

import {
  editLandingPageDraft,
  enabledAskAiTools,
  pendingActionTools,
} from './ai-chat-landing-page.js';

const { jest } = import.meta;

describe('editLandingPageDraft', () => {
  it('cancels oversized editor JSON before parsing the document', async () => {
    const cancel = jest.fn();
    const chunks = [
      new TextEncoder().encode(
        JSON.stringify({ draft: defaultLandingPageContent, padding: 'x'.repeat(2_000_000) })
      ),
      new Uint8Array(1),
    ];
    await expect(
      editLandingPageDraft({
        instruction: 'Improve the title',
        apiBase: 'https://cloud.example/api',
        token: 'synthetic',
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Consume a finite synthetic byte stream.
                const chunk = chunks.shift();
                if (chunk) {
                  controller.enqueue(chunk);
                } else {
                  controller.close();
                }
              },
              cancel,
            })
          ),
      })
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalled();
  });
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

  it('offers production landing-page editing and confirmed draft saves with dev features disabled', () => {
    expect(enabledAskAiTools(false).map(({ name }) => name)).toContain('edit_landing_page');
    expect(pendingActionTools(false).map(({ name }) => name)).toContain('save_landing_page_draft');
    expect(enabledAskAiTools(true).map(({ name }) => name)).toContain('edit_landing_page');
  });
});
