import { z } from 'zod';
import { isValidCpf } from '../lib/cedente/validators.js';

const yesNo = z.enum(['sim', 'nao']).default('nao');
const required = (label: string) => z.string().trim().min(1, `${label} é obrigatório`);
const optionalText = z.string().trim().optional();

const ESTADOS_CIVIS = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'] as const;

/**
 * PF registration form for cedentes. Must stay identical to the web schema
 * (admin-frontend `schemas/cedente-pf.schema.ts`).
 */
export const cedentePessoaSchema = z.object({
  nome: required('Nome completo'),
  cpf: z
    .string()
    .min(1, 'CPF é obrigatório')
    .refine((v) => isValidCpf(v), 'CPF inválido'),
  dataNascimento: required('Data de nascimento'),
  rg: required('RG'),
  orgaoEmissor: optionalText,
  estadoCivil: z
    .string({ required_error: 'Estado civil é obrigatório' })
    .min(1, 'Estado civil é obrigatório')
    .refine((v) => (ESTADOS_CIVIS as readonly string[]).includes(v), 'Estado civil inválido'),
  nacionalidade: required('Nacionalidade'),
  profissao: required('Profissão'),
  politicallyExposed: yesNo,
  email: z.string().trim().min(1, 'E-mail é obrigatório').email('E-mail inválido'),
  ddi1: required('DDI'),
  ddd1: required('DDD'),
  telefone1: required('Telefone'),
  logradouro: required('Logradouro'),
  numero: required('Número'),
  complemento: optionalText,
  bairro: required('Bairro'),
  cidade: required('Cidade'),
  estado: required('UF'),
  cep: required('CEP'),
  pais: required('País'),
  banco: required('Banco'),
  agenciaNumero: required('Agência'),
  contaCorrente: required('Conta'),
  digito: required('Dígito'),
});

export type CedentePessoaData = z.infer<typeof cedentePessoaSchema>;
