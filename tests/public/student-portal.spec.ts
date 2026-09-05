import {
  identifyStudent,
  normalizeStudentIdInput,
} from '../../src/public/student-portal/app';

function response(ok: boolean, status: number): Response {
  return { ok, status } as Response;
}

describe('student phone portal', () => {
  test.each([
    ['2', '2'],
    ['2345', '234-5'],
    ['2345678', '234-5678'],
    ['23a4 56-7890', '234-5678'],
  ])('normalizes and formats %p as %p without retaining extra input', (raw, expected) => {
    expect(normalizeStudentIdInput(raw)).toBe(expected);
  });

  test('submits only the normalized seven-digit student ID with no-store semantics', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(true, 200));

    await expect(identifyStudent('234 5678', fetcher)).resolves.toBe('success');
    expect(fetcher).toHaveBeenCalledWith('/api/portal/identify', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: '234-5678' }),
    });
  });

  test('distinguishes kiosk-in-use without exposing server error details', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(false, 409));

    await expect(identifyStudent('234-5678', fetcher)).resolves.toBe(
      'kiosk-in-use',
    );
  });

  test.each([
    ['invalid input', '123', jest.fn()],
    ['wrong prefix', '134-5678', jest.fn()],
    ['server rejection', '234-5678', jest.fn().mockResolvedValue(response(false, 422))],
    ['network failure', '234-5678', jest.fn().mockRejectedValue(new Error('private server detail'))],
  ])('returns one generic rejection for %s', async (_case, studentId, fetcher) => {
    await expect(identifyStudent(studentId, fetcher)).resolves.toBe('rejected');
  });
});
