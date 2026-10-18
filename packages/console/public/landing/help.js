    (() => {
      const dialog = document.getElementById('help-dialog');
      if (!dialog) return;
      document.querySelectorAll('[data-help-open]').forEach((button) => {
        button.addEventListener('click', () => {
          document.getElementById('mobile-nav')?.removeAttribute('open');
          dialog.showModal();
        });
      });
      dialog.querySelector('[data-help-close]')?.addEventListener('click', () => dialog.close());
      // A click on the backdrop lands on the dialog itself, outside its padded content box.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    })();
