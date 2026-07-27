import crypto from 'node:crypto';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { sendPartnerTokenEmail } from './email.service.js';

export type AuthenticatedPartner = {
  id: string;
  name: string;
  rateLimitRpm: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashPartnerToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generatePartnerToken(): string {
  return `opc_${crypto.randomBytes(32).toString('hex')}`;
}

function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error('E-mail inválido');
  }
  return trimmed;
}

export async function createApiPartner(input: {
  name: string;
  email: string;
  rateLimitRpm?: number;
}): Promise<{
  partner: AuthenticatedPartner & { email: string };
  token: string;
  emailSent: boolean;
}> {
  const name = input.name.trim();
  if (!name) throw new Error('Nome obrigatório');
  const email = normalizeEmail(input.email);
  const token = generatePartnerToken();
  const row = await prisma.apiPartner.create({
    data: {
      name,
      email,
      tokenHash: hashPartnerToken(token),
      rateLimitRpm: input.rateLimitRpm ?? 120,
      active: true,
    },
  });

  const { sent: emailSent } = await sendPartnerTokenEmail({
    to: email,
    partnerName: row.name,
    token,
    kind: 'created',
  });

  return {
    partner: {
      id: row.id,
      name: row.name,
      email: row.email,
      rateLimitRpm: row.rateLimitRpm,
    },
    token,
    emailSent,
  };
}

export async function authenticatePartnerBearer(
  authorizationHeader: string | undefined,
): Promise<AuthenticatedPartner | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const tokenHash = hashPartnerToken(token);
  const now = new Date();

  const byCurrent = await prisma.apiPartner.findFirst({
    where: { tokenHash, active: true },
  });
  if (byCurrent) {
    return {
      id: byCurrent.id,
      name: byCurrent.name,
      rateLimitRpm: byCurrent.rateLimitRpm,
    };
  }

  const byPrevious = await prisma.apiPartner.findFirst({
    where: {
      previousTokenHash: tokenHash,
      active: true,
      previousTokenValidUntil: { gt: now },
    },
  });
  if (byPrevious) {
    return {
      id: byPrevious.id,
      name: byPrevious.name,
      rateLimitRpm: byPrevious.rateLimitRpm,
    };
  }

  return null;
}

/** Rotaciona o token; o anterior vale até grace period. Retorna o novo token em claro (só uma vez). */
export async function rotatePartnerToken(
  partnerId: string,
): Promise<{ token: string; emailSent: boolean }> {
  const partner = await prisma.apiPartner.findUnique({ where: { id: partnerId } });
  if (!partner || !partner.active) throw new Error('Parceiro não encontrado ou inativo');

  const token = generatePartnerToken();
  const graceUntil = new Date(Date.now() + env.partnerTokenGraceHours * 60 * 60 * 1000);

  await prisma.apiPartner.update({
    where: { id: partnerId },
    data: {
      previousTokenHash: partner.tokenHash,
      previousTokenValidUntil: graceUntil,
      tokenHash: hashPartnerToken(token),
      rotatedAt: new Date(),
    },
  });

  const { sent: emailSent } = await sendPartnerTokenEmail({
    to: partner.email,
    partnerName: partner.name,
    token,
    kind: 'rotated',
  });

  return { token, emailSent };
}

export async function revokePartner(partnerId: string): Promise<void> {
  await prisma.apiPartner.update({
    where: { id: partnerId },
    data: {
      active: false,
      previousTokenHash: null,
      previousTokenValidUntil: null,
    },
  });
}

export async function listPartnerRequests(
  partnerId: string,
  options?: { limit?: number; cursor?: string },
) {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const cursorRow = options?.cursor
    ? await prisma.apiPartnerRequestLog.findUnique({ where: { id: options.cursor } })
    : null;

  const requests = await prisma.apiPartnerRequestLog.findMany({
    where: {
      partnerId,
      ...(cursorRow
        ? {
            OR: [
              { createdAt: { lt: cursorRow.createdAt } },
              { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      method: true,
      path: true,
      statusCode: true,
      ip: true,
      userAgent: true,
      createdAt: true,
    },
  });

  const hasMore = requests.length > limit;
  const items = hasMore ? requests.slice(0, limit) : requests;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  return { requests: items, nextCursor };
}

export async function logPartnerRequest(input: {
  partnerId: string;
  method: string;
  path: string;
  statusCode: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.apiPartnerRequestLog.create({
      data: {
        partnerId: input.partnerId,
        method: input.method.slice(0, 10),
        path: input.path.slice(0, 512),
        statusCode: input.statusCode,
        ip: input.ip?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (err) {
    console.error('[partner-request-log]', err);
  }
}

// --- In-memory sliding window rate limit (per partner) ---

const rateBuckets = new Map<string, number[]>();

export function checkPartnerRateLimit(
  partnerId: string,
  rateLimitRpm: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const cutoff = now - windowMs;
  const hits = (rateBuckets.get(partnerId) ?? []).filter((t) => t > cutoff);

  if (hits.length >= rateLimitRpm) {
    const oldest = hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateBuckets.set(partnerId, hits);
    return { ok: false, retryAfterSec };
  }

  hits.push(now);
  rateBuckets.set(partnerId, hits);
  return { ok: true, retryAfterSec: 0 };
}

/** Test helper */
export function _clearRateBucketsForTests() {
  rateBuckets.clear();
}
