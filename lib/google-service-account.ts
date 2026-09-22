interface GoogleServiceAccountCredentials {
  type: 'service_account';
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

function escapeControlCharactersInsideStrings(value: string): string {
  let result = '';
  let insideString = false;
  let escaped = false;

  for (const character of value) {
    if (!insideString) {
      result += character;
      if (character === '"') insideString = true;
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      result += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      result += character;
      insideString = false;
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20) {
      switch (character) {
        case '\b': result += '\\b'; break;
        case '\f': result += '\\f'; break;
        case '\n': result += '\\n'; break;
        case '\r': result += '\\r'; break;
        case '\t': result += '\\t'; break;
        default: result += `\\u${codePoint.toString(16).padStart(4, '0')}`;
      }
      continue;
    }

    result += character;
  }

  return result;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (originalError) {
    const repaired = escapeControlCharactersInsideStrings(value);
    if (repaired === value) throw originalError;
    return JSON.parse(repaired);
  }
}

function parseCredentialValue(raw: string): unknown {
  const candidates = [raw];

  // Some deployment dashboards preserve quote characters pasted around a value.
  if (
    raw.length >= 2
    && ((raw.startsWith("'") && raw.endsWith("'"))
      || (raw.startsWith('"') && raw.endsWith('"')))
  ) {
    candidates.push(raw.slice(1, -1));
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = parseJson(candidate);
      // Also accept a JSON object stored as a JSON-encoded string.
      return typeof parsed === 'string' ? parseJson(parsed) : parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function parseGoogleServiceAccountKey(
  envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
): GoogleServiceAccountCredentials {
  if (!envKey || envKey.trim() === '') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set or empty');
  }

  let parsed: unknown;
  try {
    parsed = parseCredentialValue(envKey.trim());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${reason}. `
      + 'Paste the service-account JSON as the environment value; wrapping quotes and multiline private keys are supported.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must contain a JSON object');
  }

  const credentials = parsed as Record<string, unknown>;
  if (
    credentials.type !== 'service_account'
    || typeof credentials.client_email !== 'string'
    || typeof credentials.private_key !== 'string'
  ) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY must be a service-account JSON object with client_email and private_key',
    );
  }

  return {
    ...credentials,
    type: 'service_account',
    client_email: credentials.client_email,
    // A double-escaped key can result from copying JSON through another config layer.
    private_key: credentials.private_key.replace(/\\n/g, '\n'),
  };
}
