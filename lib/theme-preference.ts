// Dashboard theme selection.
//
// The app default applies to everyone who has not chosen a theme. A user's own
// choice is stored on profiles.theme_preference and wins on every device.

export type AppTheme = 'light' | 'dark';
export type ThemePreference = AppTheme | null;

export const APP_DEFAULT_THEME: AppTheme = 'dark';
export const THEME_STORAGE_KEY = 'roove-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === null || value === 'light' || value === 'dark';
}

export function resolveTheme(preference: ThemePreference | undefined): AppTheme {
  return preference === 'light' || preference === 'dark' ? preference : APP_DEFAULT_THEME;
}

/**
 * Read the stored preference from a loaded profile. Returns undefined when the
 * column is not present yet (database not migrated), so callers can fall back
 * to the browser-only theme instead of forcing the default on every load.
 */
export function profileThemePreference(profile: unknown): ThemePreference | undefined {
  if (!profile || typeof profile !== 'object' || !('theme_preference' in profile)) return undefined;
  const value = (profile as { theme_preference: unknown }).theme_preference;
  return isThemePreference(value) ? value : null;
}
