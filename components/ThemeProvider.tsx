'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { APP_DEFAULT_THEME, THEME_STORAGE_KEY } from '@/lib/theme-preference';

// The browser keeps the last applied theme (THEME_STORAGE_KEY) so pages render
// without a flash. Inside the dashboard, ThemeToggle replaces it with the
// signed-in user's saved preference, falling back to APP_DEFAULT_THEME.
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={APP_DEFAULT_THEME}
      enableSystem={false}
      themes={['light', 'dark']}
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}
