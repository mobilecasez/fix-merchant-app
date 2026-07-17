import { useState, useEffect } from 'react';

interface ClientOnlyProps {
  children: React.ReactNode;
  // Rendered on the server and before hydration. Pass real, crawlable content here
  // so search engines and no-JS clients see the page instead of an empty body.
  fallback?: React.ReactNode;
}

export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return isClient ? <>{children}</> : <>{fallback}</>;
}
