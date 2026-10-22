import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../lib/env.js';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { sendCotistaAccessNotice } from './email.service.js';

const ORIGINAL_KEY = env.resendApiKey;

describe('sendCotistaAccessNotice', () => {
  afterEach(() => {
    env.resendApiKey = ORIGINAL_KEY;
    send.mockReset();
  });

  it('emails the cotista and copies the admins', async () => {
    env.resendApiKey = 're_test';
    send.mockResolvedValue({ data: { id: 'msg' }, error: null });

    const sent = await sendCotistaAccessNotice({
      to: 'johnny0024022@gmail.com',
      name: 'Johnny',
    });

    expect(sent).toBe(true);
    const recipients = send.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual([
      'johnny0024022@gmail.com',
      'bruno@indexcore.com.br',
      'johny.cunha@indexcore.com.br',
      'thiago.barbosa@indexcore.com.br',
    ]);
    expect(send.mock.calls[0][0].text).toContain('https://indexcore.com.br/login/primeiro-acesso');
    expect(send.mock.calls[1][0].subject).toContain('[CÓPIA]');
  });

  it('does not call Resend without an email', async () => {
    env.resendApiKey = 're_test';

    const sent = await sendCotistaAccessNotice({ to: '  ', name: 'Johnny' });

    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false when Resend rejects the cotista message', async () => {
    env.resendApiKey = 're_test';
    send.mockResolvedValue({ data: null, error: { message: 'blocked' } });

    await expect(
      sendCotistaAccessNotice({ to: 'johnny0024022@gmail.com', name: 'Johnny' }),
    ).resolves.toBe(false);
  });
});
