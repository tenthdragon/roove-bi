'use client';

import { useEffect, useState } from 'react';

export default function ScalevWebhookUrl() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Read the public browser origin after hydration, not the build-time URL
    // or the internal localhost address used by the reverse proxy.
    setUrl(new URL('/api/scalev-webhook', window.location.origin).href);
  }, []);

  return <>{url ?? 'Memuat URL…'}</>;
}
