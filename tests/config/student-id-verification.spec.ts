const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PRINTBIT_ESP32_COIN_API_KEY = 'test-coin-bridge-key';
});

afterEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

function loadConfig(): typeof import('../../src/config/http.config') {
  return require('../../src/config/http.config') as typeof import('../../src/config/http.config');
}

test('fails closed when student ID verification is enabled without a secret', () => {
  process.env.NODE_ENV = 'production';
  process.env.PRINTBIT_STUDENT_ID_VERIFICATION = 'true';
  delete process.env.PRINTBIT_STUDENT_ID_HMAC_SECRET;

  expect(loadConfig).toThrow(
    'PRINTBIT_STUDENT_ID_HMAC_SECRET must be set when student ID verification is enabled.',
  );
});

test('uses a test-only secret fallback when student ID verification is enabled', () => {
  process.env.NODE_ENV = 'test';
  process.env.PRINTBIT_STUDENT_ID_VERIFICATION = 'true';
  delete process.env.PRINTBIT_STUDENT_ID_HMAC_SECRET;

  const config = loadConfig();

  expect(config.STUDENT_ID_VERIFICATION_ENABLED).toBe(true);
  expect(config.STUDENT_ID_HMAC_SECRET).toBe('printbit-student-id-test-secret');
});

test.each([
  ['1234567', '123-4567'],
  ['123-4567', '123-4567'],
  ['123 4567', null],
  ['0123456', '012-3456'],
  ['12345678', null],
])('normalizes only valid seven-digit student IDs: %s', (raw, expected) => {
  const { normalizeStudentId } = loadConfig();

  expect(normalizeStudentId(raw)).toBe(expected);
});

test('derives the same HMAC lookup key from either valid student ID format', () => {
  process.env.PRINTBIT_STUDENT_ID_HMAC_SECRET = 'test-hmac-secret';
  const { createStudentIdLookupHmac } = loadConfig();

  expect(createStudentIdLookupHmac('1234567')).toBe(
    createStudentIdLookupHmac('123-4567'),
  );
});

test('rejects invalid student IDs before creating a lookup HMAC', () => {
  const { createStudentIdLookupHmac } = loadConfig();

  expect(createStudentIdLookupHmac('123 4567')).toBeNull();
});
