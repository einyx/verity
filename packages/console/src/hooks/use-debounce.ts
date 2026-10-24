import { useEffect, useRef } from 'react';

const defaultDelay = 500;

const useDebounce = (delay: number = defaultDelay) => {
  // eslint-disable-next-line unicorn/no-useless-undefined -- React 19 requires an initial argument for useRef.
  const timerRef = useRef<number | undefined>(undefined);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  return (callback: () => void) => {
    clearTimer();
    // eslint-disable-next-line @silverhand/fp/no-mutation
    timerRef.current = window.setTimeout(() => {
      callback();
      clearTimer();
    }, delay);
  };
};

export default useDebounce;
