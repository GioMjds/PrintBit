import {
  identifyStudent,
  normalizeStudentIdInput,
} from '../../src/public/student-portal/app';

function response(ok: boolean, status: number): Response {
  return { ok, status } as Response;
}

describe('student phone portal', () => {
  test.each([
    ['1', '1'],
    ['1234', '123-4'],
    ['1234567', '123-4567'],
    ['12a3 45-6789', '123-4567'],
  ])('normalizes and formats %p as %p without retaining extra input', (raw, expected) => {
    expect(normalizeStudentIdInput(raw)).toBe(expected);
  });

  test('submits only the normalized seven-digit student ID with no-store semantics', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(true, 200));

    await expect(identifyStudent('123 4567', fetcher)).resolves.toBe('success');
    expect(fetcher).toHaveBeenCalledWith('/api/portal/identify', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: '123-4567' }),
    });
  });

  test('distinguishes kiosk-in-use without exposing server error details', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(false, 409));

    await expect(identifyStudent('123-4567', fetcher)).resolves.toBe(
      'kiosk-in-use',
    );
  });

  test.each([
    ['invalid input', '123', jest.fn()],
    ['server rejection', '123-4567', jest.fn().mockResolvedValue(response(false, 422))],
    ['network failure', '123-4567', jest.fn().mockRejectedValue(new Error('private server detail'))],
  ])('returns one generic rejection for %s', async (_case, studentId, fetcher) => {
    await expect(identifyStudent(studentId, fetcher)).resolves.toBe('rejected');
  });
});
