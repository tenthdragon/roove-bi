const DEFAULT_LOCAL_SITE_URL = 'http://localhost:3000';
const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['roove.co.id'];
const DEFAULT_SUPPORT_EMAIL = 'hello@roove.info';

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

function parseUrlOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return stripTrailingSlash(value);
  }
}

function parseCsvEnv(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getPublicSiteOrigin() {
  return parseUrlOrigin(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_LOCAL_SITE_URL);
}

export function buildPublicSiteUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getPublicSiteOrigin()}${normalizedPath}`;
}

export function getScalevWebhookUrl() {
  return buildPublicSiteUrl('/api/scalev-webhook');
}

export function getAllowedEmailDomains() {
  const domains = parseCsvEnv(process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS);
  return domains.length > 0 ? domains : DEFAULT_ALLOWED_EMAIL_DOMAINS;
}

export function isAllowedSignupEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return getAllowedEmailDomains().includes(domain);
}

export function getAllowedEmailDomainsLabel() {
  return getAllowedEmailDomains().map((domain) => `@${domain}`).join(', ');
}

export function getDefaultSignupEmailPlaceholder() {
  const [firstDomain] = getAllowedEmailDomains();
  return `nama@${firstDomain || 'example.com'}`;
}

export function getPublicSiteHost() {
  try {
    return new URL(getPublicSiteOrigin()).host;
  } catch {
    return getPublicSiteOrigin().replace(/^https?:\/\//, '');
  }
}

export function getSupportEmail() {
  return String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim();
}
