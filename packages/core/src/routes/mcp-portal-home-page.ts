// The single page a portal host serves: the portal's name, a sign-in button, and after sign-in the
// servers the caller can use and the commands that connect an agent. Inline styles and script only;
// core's CSP allows both on first-party pages.

/** The virtual OIDC client the page signs in with. Shared with the adapter's client metadata. */
export const mcpPortalHomeClientId = 'mcp-portal-home';

const organizationScopes = ['openid', 'urn:logto:scope:organizations'];

/** Escapes a value for embedding in a <script> tag as JSON. */
const forScriptTag = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');

/** The page with the tenant's sign-in config injected. */
export const mcpPortalHomePageHtml = ({
  issuer,
  portalName,
}: {
  issuer: string;
  portalName: string;
}): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${portalName} — MCP portal</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8fa; color: #1f2328; }
  main { width: min(680px, calc(100vw - 48px)); padding: 32px; background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 24px 0 8px; }
  p { color: #59636e; }
  .server { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #eaeef2; }
  .server:last-child { border-bottom: none; }
  .badge { font-size: .75rem; padding: 2px 8px; border-radius: 999px; background: #eef4ff; color: #0969da; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 8px; overflow-x: auto; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #d1d9e0; background: #f6f8fa; cursor: pointer; }
  button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  .error { color: #cf222e; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1 id="portal-name"></h1>
  <p id="sign-in-hint">Sign in to see this portal's servers and how to connect your agent.</p>
  <button id="sign-in" class="primary" hidden>Sign in</button>
  <p id="status" class="error" hidden></p>

  <section id="home" hidden>
    <h2>Servers</h2>
    <div id="servers"></div>
    <h2>Connect your agent</h2>
    <div id="commands"></div>
  </section>
</main>
<script>window.__PORTAL_HOME__ = ${forScriptTag({
  issuer,
  clientId: mcpPortalHomeClientId,
  scopes: organizationScopes,
  portalName,
})};</script>
<script>
  const config = window.__PORTAL_HOME__;
  document.getElementById('portal-name').textContent = config.portalName;
  const signIn = document.getElementById('sign-in');
  const status = document.getElementById('status');

  const showError = (message) => {
    status.textContent = message;
    status.hidden = false;
  };

  const random = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  const pkceChallenge = async (verifier) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

  signIn.addEventListener('click', async () => {
    const verifier = random();
    const state = random();
    sessionStorage.setItem('mcp-portal-home', JSON.stringify({ verifier, state }));
    const challenge = await pkceChallenge(verifier);
    const url = new URL(config.issuer.replace(/\\/$/, '') + '/auth');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scopes.join(' '));
    url.searchParams.set('redirect_uri', location.origin + '/callback');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    location.assign(url.href);
  });

  const exchange = async (code, verifier) => {
    const response = await fetch(location.origin + '/callback/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: verifier }),
    });

    if (!response.ok) {
      throw new Error('Sign-in could not be completed. Try again.');
    }

    return response.json();
  };

  const renderHome = async (accessToken) => {
    const response = await fetch('/mcp-home', { headers: { authorization: 'Bearer ' + accessToken } });

    if (response.status === 403) {
      showError('None of your organizations can use this portal.');
      return;
    }

    if (!response.ok) {
      showError('The portal could not be loaded. Try again.');
      return;
    }

    const data = await response.json();
    sessionStorage.setItem('mcp-portal-home-token', accessToken);
    document.getElementById('sign-in-hint').hidden = true;
    signIn.hidden = true;
    document.getElementById('home').hidden = false;

    const servers = document.getElementById('servers');
    servers.replaceChildren(
      ...data.servers.map((server) => {
        const row = document.createElement('div');
        row.className = 'server';
        const name = document.createElement('span');
        name.textContent = server.name;
        row.append(name);
        if (server.openToAllOrganizations) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'everyone on this portal';
          row.append(badge);
        }
        return row;
      })
    );

    const commands = document.getElementById('commands');
    commands.replaceChildren(
      ...Object.entries(data.commands).map(([client, command]) => {
        const block = document.createElement('div');
        const label = document.createElement('p');
        label.textContent = client;
        const pre = document.createElement('pre');
        pre.textContent = command;
        const copy = document.createElement('button');
        copy.textContent = 'Copy';
        copy.addEventListener('click', () => navigator.clipboard.writeText(command));
        block.append(label, pre, copy);
        return block;
      })
    );
  };

  const storedToken = sessionStorage.getItem('mcp-portal-home-token');

  if (location.pathname === '/callback') {
    const params = new URLSearchParams(location.search);
    const stored = JSON.parse(sessionStorage.getItem('mcp-portal-home') ?? '{}');
    const code = params.get('code');
    const state = params.get('state');

    if (params.get('error')) {
      showError('Sign-in was refused.');
    } else if (!code || !stored.verifier || stored.state !== state) {
      showError('Sign-in could not be resumed. Start again.');
      signIn.hidden = false;
    } else {
      try {
        const { access_token: accessToken } = await exchange(code, stored.verifier);
        sessionStorage.removeItem('mcp-portal-home');
        history.replaceState(null, '', location.origin + '/');
        await renderHome(accessToken);
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
        signIn.hidden = false;
      }
    }
  } else if (storedToken) {
    renderHome(storedToken).catch(() => {
      sessionStorage.removeItem('mcp-portal-home-token');
      signIn.hidden = false;
    });
  } else {
    signIn.hidden = false;
  }
</script>
</body>
</html>
`;
