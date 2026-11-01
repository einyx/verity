import { useEffect, useState } from 'react';

const isExpired = (value: string) =>
  !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now();

export default function useReviewExpiry(expiresAt: string) {
  const [expired, setExpired] = useState(() => isExpired(expiresAt));
  useEffect(() => {
    const elapsed = isExpired(expiresAt);
    setExpired(elapsed);
    if (elapsed) {
      return;
    }
    const timer = setTimeout(
      () => {
        setExpired(true);
      },
      Math.max(0, Date.parse(expiresAt) - Date.now())
    );
    return () => {
      clearTimeout(timer);
    };
  }, [expiresAt]);
  return expired;
}
