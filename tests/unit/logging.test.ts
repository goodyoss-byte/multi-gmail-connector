import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/util/logger.js';
import { redact, redactString } from '../../src/util/redact.js';

const SECRETS = {
  access: 'ya29.a0AfB_byC-EXAMPLE-access_token.value',
  refresh: '1//0gEXAMPLErefreshTOKENvalue-abc_def',
  clientSecret: 'GOCSPX-EXAMPLEsecretVALUE123',
  jwt: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl',
};

describe('redaction', () => {
  it('scrubs credential shapes from free text', () => {
    const text = `token ${SECRETS.access} refresh ${SECRETS.refresh} secret ${SECRETS.clientSecret} id ${SECRETS.jwt} Authorization: Bearer abc.def-ghi`;
    const out = redactString(text);
    for (const s of Object.values(SECRETS)) expect(out).not.toContain(s);
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('abc.def-ghi');
  });

  it('scrubs tokens in URLs but keeps the parameter names', () => {
    const out = redactString('http://127.0.0.1:5555/?code=4/0AbCdEf&state=xyz&scope=email');
    expect(out).toBe('http://127.0.0.1:5555/?code=[REDACTED]&state=[REDACTED]&scope=email');
  });

  it('replaces values under sensitive keys, at any depth', () => {
    const out = redact({
      account_id: 'acc_x',
      refresh_token: 'anything',
      nested: { client_secret: 'x', headers: { Authorization: 'Bearer y' }, list: [{ access_token: 'z' }] },
      code: 'c',
      state: 's',
      code_verifier: 'v',
    }) as Record<string, any>;
    expect(out.account_id).toBe('acc_x');
    expect(out.refresh_token).toBe('[REDACTED]');
    expect(out.nested.client_secret).toBe('[REDACTED]');
    expect(out.nested.headers.Authorization).toBe('[REDACTED]');
    expect(out.nested.list[0].access_token).toBe('[REDACTED]');
    expect(out.code).toBe('[REDACTED]');
    expect(out.state).toBe('[REDACTED]');
    expect(out.code_verifier).toBe('[REDACTED]');
  });

  it('redacts Error messages', () => {
    const out = redact(new Error(`failed with ${SECRETS.refresh}`)) as { message: string };
    expect(out.message).not.toContain(SECRETS.refresh);
  });
});

describe('logger', () => {
  it('writes JSON lines with secrets removed and respects the level', () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), 'info');
    log.debug('hidden', { a: 1 });
    log.info(`refresh ok ${SECRETS.access}`, { refresh_token: SECRETS.refresh, detail: `x ${SECRETS.clientSecret}`, account_id: 'acc_1' });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.level).toBe('info');
    expect(entry.account_id).toBe('acc_1');
    for (const s of Object.values(SECRETS)) expect(lines[0]).not.toContain(s);
  });

  it('defaults to stderr, never stdout', () => {
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    let stdout = '';
    let stderr = '';
    process.stdout.write = ((c: string) => ((stdout += c), true)) as typeof process.stdout.write;
    process.stderr.write = ((c: string) => ((stderr += c), true)) as typeof process.stderr.write;
    try {
      createLogger(undefined, 'debug').info('hello');
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    expect(stdout).toBe('');
    expect(stderr).toContain('hello');
  });
});
