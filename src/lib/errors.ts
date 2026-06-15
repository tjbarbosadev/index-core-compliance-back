import { TRPCError } from '@trpc/server';

export const APP_ERROR = {
  UNAUTHORIZED: () =>
    new TRPCError({ code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada' }),
  FORBIDDEN: () => new TRPCError({ code: 'FORBIDDEN', message: 'Permissão ausente' }),
  NOT_FOUND: (entity: string) =>
    new TRPCError({ code: 'NOT_FOUND', message: `${entity} não encontrado` }),
  CONFLICT: (message: string) => new TRPCError({ code: 'CONFLICT', message }),
  BAD_REQUEST: (message: string) => new TRPCError({ code: 'BAD_REQUEST', message }),
  ONBOARDING_EXPIRADO: () => new TRPCError({ code: 'BAD_REQUEST', message: 'ONBOARDING_EXPIRADO' }),
  REGULAMENTO_INDISPONIVEL: () =>
    new TRPCError({ code: 'BAD_REQUEST', message: 'REGULAMENTO_INDISPONIVEL' }),
} as const;

export const KYC_DOCUMENT_TYPES = new Set([
  'rg',
  'cpf',
  'cnh',
  'comprovante_residencia',
  'irpf',
  'extrato_bancario',
  'contrato_social',
  'balanco_patrimonial',
  'minuta_cessao',
]);

export const DEFAULT_REGULATORY_LIMITS: Record<string, Record<string, number>> = {
  fidc: { min_direitos_creditorios_pct: 67 },
  fii: { min_imoveis_pct: 75 },
  fia: { min_acoes_pct: 67 },
  fim: {},
  fi_infra: { min_debentures_infra_pct: 85 },
  fip: { min_participacoes_pct: 90 },
  fi_debentures: { min_debentures_incentivadas_pct: 85 },
  fiagro: { min_ativos_agro_pct: 67 },
  fi_rf: { min_renda_fixa_pct: 80 },
  fi_cambio: { min_ativos_cambiais_pct: 80 },
};
