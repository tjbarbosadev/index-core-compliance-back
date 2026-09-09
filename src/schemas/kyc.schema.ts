import { z } from 'zod';

export const kycDocumentTypeSchema = z.enum(['CPF', 'CNPJ']);

export const generateKycInputSchema = z.object({
  document: z.string().min(11).max(18),
  documentType: kycDocumentTypeSchema,
  partyId: z.string().uuid().optional(),
  onboardingId: z.string().uuid().optional(),
  forceRefresh: z.boolean().optional(),
});

export const listKycInputSchema = z.object({
  document: z.string().optional(),
  partyId: z.string().uuid().optional(),
  riskLevel: z.enum(['baixo', 'medio', 'alto', 'muito_alto']).optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export type GenerateKycInput = z.infer<typeof generateKycInputSchema>;
export type ListKycInput = z.infer<typeof listKycInputSchema>;
