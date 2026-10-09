export function matchesCronBearer(
  authorizationHeader: string | null,
  configuredSecret: string | null | undefined,
) {
  const secret = String(configuredSecret || '').trim();
  return secret.length > 0 && authorizationHeader === `Bearer ${secret}`;
}
