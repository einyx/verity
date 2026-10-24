(() => {
  // One document-level listener handles every trigger, so the buttons work in every browser without depending on
  // when individual listeners are attached. Help uses the native dialog; Docs is an overlay panel. The language menu lives in locale.js.
  const helpDialog = document.getElementById('help-dialog');
  const panel = (id) => document.getElementById(id);

  const openPanel = (element) => {
    if (!element) return;
    document.getElementById('mobile-nav')?.removeAttribute('open');
    element.hidden = false;
    element.querySelector('button, a')?.focus();
  };
  const closePanel = (element) => {
    if (element) element.hidden = true;
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('[data-help-open]')) {
      document.getElementById('mobile-nav')?.removeAttribute('open');
      helpDialog?.showModal();
      return;
    }
    if (target.closest('[data-docs-open]')) {
      openPanel(panel('docs-modal'));
      return;
    }
    if (target.closest('[data-help-close], [data-dialog-close]')) {
      const dialog = target.closest('dialog');
      if (dialog) dialog.close();
      closePanel(target.closest('[data-modal]'));
      return;
    }
    const modal = target.closest('[data-modal]');
    if (modal && target === modal) {
      closePanel(modal);
    }
  });

  helpDialog?.addEventListener('click', (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-modal]:not([hidden])').forEach(closePanel);
  });
})();
