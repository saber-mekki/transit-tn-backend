// Tests for POST /api/auth/forgot-password and /api/auth/reset-password.
// Uses an in-memory fake of Prisma and of sendEmail: no database, no email.
// Run: npx ts-node -T tests/resetPassword.test.ts
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import type { AddressInfo } from 'node:net';

// ─── Fakes ───────────────────────────────────────
type User = { id: string; email: string | null; password: string };
type Code = { email: string; code: string; expiresAt: Date; createdAt: Date };
let users: User[] = [];
let codes: Code[] = [];
let sentEmails: { to: string; html: string }[] = [];

const matchesEmail = (where: any, email: string | null) =>
  !!email && email.toLowerCase() === String(where.email.equals).toLowerCase();

const fakePrisma = {
  user: {
    findFirst: async ({ where }: any) => users.find(u => matchesEmail(where, u.email)) ?? null,
    update: async ({ where, data }: any) => {
      const user = users.find(u => u.id === where.id)!;
      Object.assign(user, data);
      return user;
    },
  },
  emailVerification: {
    create: async ({ data }: any) => { codes.push({ ...data, createdAt: new Date() }); return data; },
    deleteMany: async ({ where }: any) => { codes = codes.filter(c => c.email !== where.email); },
    findFirst: async ({ where }: any) =>
      codes
        .filter(c => c.email === where.email && c.expiresAt > where.expiresAt.gt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
  },
};

const mockModule = (relativePath: string, exports: any) => {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as any;
};
mockModule('../src/db', { __esModule: true, default: fakePrisma });
mockModule('../src/utils/sendEmail', {
  sendEmail: async (to: string, _subject: string, html: string) => { sentEmails.push({ to, html }); },
});

// Load the real routes only after the fakes are in place
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { router } = require('../src/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', router);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
after(() => server.close());

const post = async (route: string, body: object) => {
  const res = await fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
};
const codeFromLastEmail = () => sentEmails.at(-1)!.html.match(/>(\d{6})</)![1];

beforeEach(async () => {
  users = [{ id: 'u1', email: 'test@example.com', password: await bcrypt.hash('OldPassword1!', 4) }];
  codes = [];
  sentEmails = [];
});

// ─── Tests ───────────────────────────────────────
test('old attack: email + new password without code is refused', async () => {
  const res = await post('reset-password', { email: 'test@example.com', newPassword: 'Hacked123!' });
  assert.equal(res.status, 400);
  assert.ok(await bcrypt.compare('OldPassword1!', users[0].password), 'password must not change');
});

test('forgot-password sends a 6-digit code to an existing account', async () => {
  const res = await post('forgot-password', { email: 'test@example.com' });
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'test@example.com');
  assert.match(codeFromLastEmail(), /^\d{6}$/);
});

test('forgot-password gives the same answer for an unknown email and sends nothing', async () => {
  const known = await post('forgot-password', { email: 'test@example.com' });
  const unknown = await post('forgot-password', { email: 'nobody@example.com' });
  assert.equal(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(sentEmails.length, 1, 'only the known account gets an email');
});

test('success path: correct code changes the password, then the code cannot be reused', async () => {
  await post('forgot-password', { email: 'test@example.com' });
  const code = codeFromLastEmail();

  const res = await post('reset-password', { email: 'test@example.com', code, newPassword: 'NewPassword1!' });
  assert.equal(res.status, 200);
  assert.ok(await bcrypt.compare('NewPassword1!', users[0].password), 'new password must be saved');

  const reuse = await post('reset-password', { email: 'test@example.com', code, newPassword: 'Another123!' });
  assert.equal(reuse.status, 400);
  assert.ok(await bcrypt.compare('NewPassword1!', users[0].password), 'reused code must not work');
});

test('email matching is case-insensitive', async () => {
  await post('forgot-password', { email: 'TEST@Example.com' });
  const code = codeFromLastEmail();
  const res = await post('reset-password', { email: 'Test@Example.COM', code, newPassword: 'NewPassword1!' });
  assert.equal(res.status, 200);
});

test('wrong code is refused', async () => {
  await post('forgot-password', { email: 'test@example.com' });
  const code = codeFromLastEmail();
  const wrong = code === '111111' ? '222222' : '111111';
  const res = await post('reset-password', { email: 'test@example.com', code: wrong, newPassword: 'Hacked123!' });
  assert.equal(res.status, 400);
  assert.ok(await bcrypt.compare('OldPassword1!', users[0].password));
});

test('after 5 wrong codes the real code is burned', async () => {
  await post('forgot-password', { email: 'test@example.com' });
  const code = codeFromLastEmail();
  const wrong = code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) {
    await post('reset-password', { email: 'test@example.com', code: wrong, newPassword: 'Hacked123!' });
  }
  const res = await post('reset-password', { email: 'test@example.com', code, newPassword: 'NewPassword1!' });
  assert.equal(res.status, 400);
  assert.ok(await bcrypt.compare('OldPassword1!', users[0].password));
});

test('expired code is refused', async () => {
  await post('forgot-password', { email: 'test@example.com' });
  const code = codeFromLastEmail();
  codes[0].expiresAt = new Date(Date.now() - 1000);
  const res = await post('reset-password', { email: 'test@example.com', code, newPassword: 'NewPassword1!' });
  assert.equal(res.status, 400);
});

test('a signup verification code cannot be used to reset a password', async () => {
  // /api/verify/send-code stores codes under the raw email
  codes.push({ email: 'test@example.com', code: '654321', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
  const res = await post('reset-password', { email: 'test@example.com', code: '654321', newPassword: 'Hacked123!' });
  assert.equal(res.status, 400);
});

test('new password shorter than 8 characters is refused', async () => {
  await post('forgot-password', { email: 'test@example.com' });
  const res = await post('reset-password', { email: 'test@example.com', code: codeFromLastEmail(), newPassword: 'short' });
  assert.equal(res.status, 400);
});
