import { useEffect, useState } from 'react';

import styles from './App.module.scss';
import prysmMark from './assets/prysm-mark.svg';

const prysmUrl = `https://prysm.sh/?${new URLSearchParams({
  utm_source: 'sign_in',
  utm_medium: 'powered_by',
}).toString()}`;

export const useIsDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      setIsDarkMode(event.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, []);

  return isDarkMode;
};

const Footer = ({ isDarkMode }: { readonly isDarkMode: boolean }) => (
  <div className={styles.footerContainer}>
    <a
      className={styles.footer}
      href={prysmUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Powered By Prysm"
    >
      <span>Powered by</span>
      <img className={styles.staticLogo} src={prysmMark} alt="Prysm" />
      <img className={styles.highlightLogo} src={prysmMark} alt="Prysm" />
    </a>
  </div>
);

export default Footer;
