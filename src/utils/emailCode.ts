import crypto from 'crypto';
import prisma from '../db';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const normalizeEmail = (email: string) => String(email).trim().toLowerCase();

/** Creates a fresh 6-digit code for this email; any earlier code stops working. */
export async function createEmailCode(email: string) {
  const e = normalizeEmail(email);
  const code = crypto.randomInt(100000, 1000000).toString();
  await prisma.emailVerification.deleteMany({ where: { email: e } });
  await prisma.emailVerification.create({ data: { email: e, code, expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
  return code;
}

/**
 * Checks the latest unexpired code for this email. A wrong guess counts as an attempt; after
 * MAX_ATTEMPTS the code is destroyed and a new one must be requested. With consume=true a
 * correct code is used up (one-time).
 */
export async function checkEmailCode(email: string, code: string, consume: boolean): Promise<boolean> {
  const e = normalizeEmail(email);
  const record = await prisma.emailVerification.findFirst({
    where: { email: e, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return false;
  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.emailVerification.deleteMany({ where: { email: e } });
    return false;
  }
  const a = Buffer.from(record.code);
  const b = Buffer.from(String(code).trim());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await prisma.emailVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  if (consume) await prisma.emailVerification.deleteMany({ where: { email: e } });
  return true;
}
