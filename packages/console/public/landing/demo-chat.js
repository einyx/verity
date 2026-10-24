// Opens the demo chat as a modal from the Request a Demo buttons. The chat itself is the assistant-ui
// app in demo-chat-app.js, loaded the first time the modal opens. The buttons only open the modal once
// the published landing page document has the demo chat switched on.
(() => {
  const dialog = document.getElementById('demo-chat');
  const closeButton = document.getElementById('demo-chat-close');

  if (!(dialog instanceof HTMLDialogElement) || !closeButton) {
    return;
  }

  const appSrc = '/console/landing/demo-chat-app.js?v=2ac5133aad';
  let enabled = false;
  let appRequested = false;

  // Loads the chat app once. It mounts itself into #demo-chat-root when it runs.
  const loadApp = () => {
    if (appRequested) {
      return;
    }

    appRequested = true;
    const script = document.createElement('script');
    script.src = appSrc;
    script.async = true;
    document.head.append(script);
  };

  const open = () => {
    if (!enabled) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    loadApp();
    // On later opens the app is already mounted; put the cursor back in the composer.
    requestAnimationFrame(() => {
      dialog.querySelector('.demo-chat-input')?.focus();
    });
  };

  closeButton.addEventListener('click', () => {
    dialog.close();
  });

  // Clicking the backdrop closes the modal. Only the dialog element itself reports a click there.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  // Every Request a Demo button opens the modal. The published CMS document can still point them at
  // /demo, which does not exist on this site, so those clicks never navigate away.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link) {
      return;
    }

    const url = new URL(link.href, location.href);
    const isDemoLink =
      url.pathname === '/demo' || url.pathname.startsWith('/demo/') || url.hash === '#demo-chat';
    if (!isDemoLink) {
      return;
    }

    event.preventDefault();
    open();
  });

  // Enables the buttons only when the published document turns the demo chat on. Any failure leaves
  // them inert.
  fetch('/api/landing-page', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      enabled = data?.published?.demoChat?.enabled === true;

      // A visit to /demo redirects here with the anchor, so open the modal straight away.
      if (enabled && location.hash === '#demo-chat') {
        // Drop the anchor so a reload does not open the chat again.
        history.replaceState(null, '', location.pathname + location.search);
        open();
      }
    })
    .catch(() => {
      // Keep the chat disabled when the document cannot be read.
    });
})();
