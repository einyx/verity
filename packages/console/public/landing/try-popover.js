(() => {
  const links = [...document.querySelectorAll('a[href="https://try.meshx.foundation"]')];
  const pop = document.getElementById('try-popover');
  if (!links.length || !pop) return;
  let timer;
  const show = (link) => {
    clearTimeout(timer);
    const r = link.getBoundingClientRect();
    pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - 280)) + 'px';
    pop.style.top = r.bottom + 10 + 'px';
    pop.classList.add('is-open');
  };
  const hide = () => {
    timer = setTimeout(() => pop.classList.remove('is-open'), 120);
  };
  links.forEach((link) => {
    link.setAttribute('aria-describedby', 'try-popover');
    link.addEventListener('mouseenter', () => show(link));
    link.addEventListener('mouseleave', hide);
    link.addEventListener('focus', () => show(link));
    link.addEventListener('blur', hide);
  });
  pop.addEventListener('mouseenter', () => clearTimeout(timer));
  pop.addEventListener('mouseleave', hide);
  window.addEventListener('scroll', hide, { passive: true });
})();
