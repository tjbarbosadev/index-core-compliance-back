import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ingestSiteProposal, sendSiteProposalEmail } = vi.hoisted(() => ({
  ingestSiteProposal: vi.fn(),
  sendSiteProposalEmail: vi.fn(),
}));

vi.mock('../lib/env.js', () => ({
  env: {
    corsOrigins: ['https://nextcorefidc.com.br'],
    webUrl: 'https://admin.opcore.com.br',
    siteProposalNotifyEmails: ['qa@example.com'],
  },
}));
vi.mock('../services/onboarding.service.js', () => ({ ingestSiteProposal }));
vi.mock('../services/email.service.js', () => ({ sendSiteProposalEmail }));

import {
  _clearPublicSiteRateBucketsForTests,
  registerPublicSitesRoutes,
} from './public-sites.routes.js';

const ORIGIN = 'https://nextcorefidc.com.br';
const PATH = '/public/sites/nexafidic/proposals';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerPublicSitesRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  _clearPublicSiteRateBucketsForTests();
  ingestSiteProposal.mockResolvedValue({ created: true, process: { id: 'proc-1' } });
  sendSiteProposalEmail.mockResolvedValue([]);
});

async function messageOf(res: Response): Promise<string> {
  return ((await res.json()) as { message: string }).message;
}

function post(body: unknown, headers: Record<string, string> = { Origin: ORIGIN }) {
  return fetch(`${baseUrl}${PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const pfBody = {
  name: 'Maria Teste',
  cpf: '123.456.789-09',
  email: 'maria@example.com',
  residencialTelefone: '(11) 99999-0000',
  pessoaVinculadaSefer: 'nao',
  qualificacaoInvestidor: 'Qualificado',
};

const pjBody = {
  company: 'Empresa Teste LTDA',
  cnpj: '12.345.678/0001-95',
  email: 'contato@empresa.com',
  ddd1: '11',
  telefone1: '3333-0000',
  contasBancarias: [{ agenciaNumero: '0001', contaCorrente: '123' }],
};

describe('POST /public/sites/nexafidic/proposals', () => {
  it('creates a PF onboarding and notifies by email', async () => {
    const res = await post(pfBody);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, id: 'proc-1' });

    const input = ingestSiteProposal.mock.calls[0]![0];
    expect(input).toMatchObject({
      source: 'nexafidic',
      partyType: 'pf',
      cpfCnpj: '12345678909',
      legalName: 'Maria Teste',
      email: 'maria@example.com',
      phone: '(11) 99999-0000',
      fundCnpj: '68057459000165',
      quotaType: 'senior_i',
    });
    expect(input.payload).toMatchObject({
      pessoaVinculadaIndexCore: 'nao',
      qualificacao: 'Qualificado',
    });
    expect(sendSiteProposalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['qa@example.com'],
        onboardingUrl: 'https://admin.opcore.com.br/onboarding/proc-1',
        created: true,
      }),
    );
  });

  it('creates a PJ onboarding with normalized arrays', async () => {
    const res = await post(pjBody);
    expect(res.status).toBe(201);
    const input = ingestSiteProposal.mock.calls[0]![0];
    expect(input).toMatchObject({
      partyType: 'pj',
      cpfCnpj: '12345678000195',
      legalName: 'Empresa Teste LTDA',
      phone: '11 3333-0000',
    });
    expect(input.payload.contasBancarias).toEqual([{ agencia: '0001', conta: '123' }]);
  });

  it('returns 200 when an open process is updated', async () => {
    ingestSiteProposal.mockResolvedValue({ created: false, process: { id: 'proc-1' } });
    const res = await post(pfBody);
    expect(res.status).toBe(200);
  });

  it('rejects an invalid document', async () => {
    const res = await post({ ...pfBody, cpf: '123' });
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toBe('CPF inválido');
    expect(ingestSiteProposal).not.toHaveBeenCalled();
  });

  it('rejects requests without an allowed Origin', async () => {
    expect((await post(pfBody, {})).status).toBe(403);
    expect((await post(pfBody, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(ingestSiteProposal).not.toHaveBeenCalled();
  });

  it('maps a concluded registration to 409 with a message', async () => {
    ingestSiteProposal.mockRejectedValue({ code: 'CONFLICT', message: 'x' });
    const res = await post(pfBody);
    expect(res.status).toBe(409);
    expect(await messageOf(res)).toMatch(/cadastro concluído/);
  });

  it('keeps the response successful when the email fails', async () => {
    sendSiteProposalEmail.mockRejectedValue(new Error('resend down'));
    const res = await post(pfBody);
    expect(res.status).toBe(201);
  });

  it('rate limits per IP after 5 requests per minute', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post(pfBody)).status).toBe(201);
    }
    const res = await post(pfBody);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});
