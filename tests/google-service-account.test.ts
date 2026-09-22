import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGoogleServiceAccountKey } from '../lib/google-service-account';

const credential = {
  type: 'service_account',
  project_id: 'roove-bi',
  client_email: 'reader@roove-bi.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n',
};

test('parses a standard service-account JSON value', () => {
  assert.deepEqual(parseGoogleServiceAccountKey(JSON.stringify(credential)), credential);
});

test('parses a value wrapped in deployment-dashboard quotes', () => {
  assert.deepEqual(parseGoogleServiceAccountKey(`'${JSON.stringify(credential)}'`), credential);
});

test('repairs literal newlines inside a private_key JSON string', () => {
  const withLiteralNewlines = JSON.stringify(credential).replace(/\\n/g, '\n');

  assert.deepEqual(parseGoogleServiceAccountKey(withLiteralNewlines), credential);
});

test('normalizes a private key escaped through an additional config layer', () => {
  const doubleEscaped = JSON.stringify({
    ...credential,
    private_key: credential.private_key.replace(/\n/g, '\\n'),
  });

  assert.deepEqual(parseGoogleServiceAccountKey(doubleEscaped), credential);
});

test('rejects JSON that is not a service-account credential', () => {
  assert.throws(
    () => parseGoogleServiceAccountKey('{"type":"authorized_user"}'),
    /must be a service-account JSON object/,
  );
});

test('parse errors do not include credential contents', () => {
  assert.throws(
    () => parseGoogleServiceAccountKey('{"private_key":"TOP_SECRET",}'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /TOP_SECRET/);
      return true;
    },
  );
});
