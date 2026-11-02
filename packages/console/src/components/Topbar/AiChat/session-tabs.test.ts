import { readSessionTabs, closeSessionTab, sessionTabsKey } from './session-tabs';

describe('device-only session tabs', () => {
  it('only accepts deduplicated opaque tab IDs and a matching active ID', () => {
    expect(
      readSessionTabs(
        JSON.stringify({ openIds: ['a', 'a', '', 4, 'b'], activeId: 'b', text: 'secret' })
      )
    ).toEqual({ openIds: ['a', 'b'], activeId: 'b' });
    expect(readSessionTabs('invalid')).toEqual({ openIds: [], activeId: undefined });
  });
  it('closing selects an adjacent tab without changing session data', () => {
    expect(closeSessionTab({ openIds: ['a', 'b', 'c'], activeId: 'b' }, 'b')).toEqual({
      openIds: ['a', 'c'],
      activeId: 'c',
    });
    expect(closeSessionTab({ openIds: ['a'], activeId: 'a' }, 'a')).toEqual({
      openIds: [],
      activeId: undefined,
    });
  });
  it('tenant and authenticated principal cannot collide in a storage key', () => {
    expect(sessionTabsKey({ tenantId: 'a:b', userId: 'c' })).not.toBe(
      sessionTabsKey({ tenantId: 'a', userId: 'b:c' })
    );
  });
});
