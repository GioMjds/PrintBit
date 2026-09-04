export type StudentIdentificationView =
  | 'success'
  | 'rejected'
  | 'kiosk-in-use';

export function normalizeStudentIdInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  return digits.length > 3
    ? `${digits.slice(0, 3)}-${digits.slice(3)}`
    : digits;
}

export async function identifyStudent(
  rawStudentId: string,
  fetcher: typeof fetch = fetch,
): Promise<StudentIdentificationView> {
  const studentId = normalizeStudentIdInput(rawStudentId);
  if (!/^\d{3}-\d{4}$/.test(studentId)) return 'rejected';

  try {
    const response = await fetcher('/api/portal/identify', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    });
    if (response.ok) return 'success';
    return response.status === 409 ? 'kiosk-in-use' : 'rejected';
  } catch {
    return 'rejected';
  }
}

function initializeStudentPortal(): void {
  const form = document.getElementById('studentIdForm') as HTMLFormElement | null;
  const input = document.getElementById('studentId') as HTMLInputElement | null;
  const submit = document.getElementById(
    'verifyStudentId',
  ) as HTMLButtonElement | null;
  const error = document.getElementById('studentIdError');
  const status = document.getElementById('portalStatus');
  if (!form || !input || !submit || !error || !status) return;

  const updateSubmitState = (): void => {
    submit.disabled = normalizeStudentIdInput(input.value).length !== 8;
  };

  input.addEventListener('input', () => {
    input.value = normalizeStudentIdInput(input.value);
    error.textContent = '';
    error.hidden = true;
    status.textContent = '';
    updateSubmitState();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    submit.disabled = true;
    input.readOnly = true;
    form.setAttribute('aria-busy', 'true');
    error.textContent = '';
    error.hidden = true;
    status.textContent = 'Verifying student ID…';

    const outcome = await identifyStudent(input.value);
    input.value = '';
    input.readOnly = false;
    form.removeAttribute('aria-busy');

    if (outcome === 'success') {
      status.textContent = 'Student ID verified. The kiosk is ready.';
      submit.disabled = true;
      return;
    }

    status.textContent = '';
    error.textContent =
      outcome === 'kiosk-in-use'
        ? 'The kiosk is currently in use. Please wait for the current session to end.'
        : 'Student ID could not be verified. Check the number and try again.';
    error.hidden = false;
    updateSubmitState();
    input.focus();
  });

  updateSubmitState();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeStudentPortal, {
      once: true,
    });
  } else {
    initializeStudentPortal();
  }
}
