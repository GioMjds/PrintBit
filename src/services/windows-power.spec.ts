import {
  requestWindowsShutdown,
  WINDOWS_SHUTDOWN_ARGS,
} from './windows-power';

describe('requestWindowsShutdown', () => {
  it('runs the fixed Windows shutdown command on Windows', async () => {
    const runCommand = jest.fn().mockResolvedValue(undefined);

    await requestWindowsShutdown({ platform: 'win32', runCommand });

    expect(runCommand).toHaveBeenCalledWith('shutdown.exe', WINDOWS_SHUTDOWN_ARGS);
  });

  it('rejects when called on a non-Windows host', async () => {
    const runCommand = jest.fn().mockResolvedValue(undefined);

    await expect(
      requestWindowsShutdown({ platform: 'linux', runCommand }),
    ).rejects.toThrow('Windows shutdown is only available on Windows hosts.');
    expect(runCommand).not.toHaveBeenCalled();
  });
});
