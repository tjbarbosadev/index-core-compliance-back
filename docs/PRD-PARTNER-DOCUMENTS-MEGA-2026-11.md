# PRD — Upload de documentos do parceiro (Mega)

| Campo          | Valor                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Produto        | OpCore Admin — API parceiro FIM (Ipe Core / Ipebank)                                                                 |
| Status         | Aprovado em brainstorming (2026-11-19)                                                                               |
| TechSpec       | [TECHSPEC-PARTNER-DOCUMENTS-MEGA-2026-11.md](./TECHSPEC-PARTNER-DOCUMENTS-MEGA-2026-11.md)                           |
| Repos          | `admin-backend` (api), docs espelhados em `docs/partners/`                                                           |
| Depende de     | Rotas FIM existentes (`/v1/fim/*`), Mega vault / MEGAcmd                                                             |
| Fora de escopo | Checklist KYC nextcorefim, S3 de documentos internos, UI completa do admin (MVP: API + metadados; UI admin = fase 2) |

## 1. Problema

O parceiro (backend do banco) já integra aplicação, resgate, cancelamento e consulta de cotista via Bearer + escopos FIM. **Não há** rota para enviar arquivos. Hoje o upload Mega só existe no admin autenticado por sessão (`POST /files/fim/:cotistaId/documents`), proxy do checklist KYC do nextcorefim (campo `slot` obrigatório).

O banco precisa enviar **anexos genéricos** (PDF/imagem) vinculados ao cliente, gravados no **nosso drive Mega**, sem misturar com o checklist KYC.

## 2. Objetivo

Expor CRUD de anexos genéricos na API parceiro `/v1/fim/...`, com:

1. Identificação híbrida: CPF/CNPJ sempre; `cotistaId` quando o cliente já for cotista nosso.
2. Auto-criação de `Party` + `Cotista` se o documento ainda não existir (mesmo espírito da subscription FIM: `excludeFromPl: true`).
3. Persistência no Mega em pasta **fora** do checklist KYC/nextcorefim.
4. Metadados e auditoria no Postgres do OpCore.
5. Atualização do guia do parceiro (`docs/partners/ipbank-routes.md` e `api/docs/partners/ipe-core-fim.md`).

## 3. Decisões (brainstorming)

| #   | Decisão                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- |
| D1  | Arquivo genérico (não slots KYC).                                                                   |
| D2  | Chave híbrida: `:document` (CPF/CNPJ) + `cotistaId` opcional/resolvido na resposta.                 |
| D3  | Se não existir cotista → criar Party + Cotista na hora.                                             |
| D4  | CRUD: upload, listar, download, delete.                                                             |
| D5  | Caminho Mega novo, fora do nextcorefim.                                                             |
| D6  | Abordagem: OpCore Admin fala com Mega vault/MEGAcmd; metadados locais (não estender checklist FIM). |

## 4. Personas e casos de uso

| Ator                   | Uso                                                                               |
| ---------------------- | --------------------------------------------------------------------------------- |
| Backend Ipebank        | Envia/consulta/remove anexos do cliente (comprovantes, selfies, contratos, etc.). |
| Operação Index (admin) | Fase 2: ver anexos do party no admin. MVP: dados no banco + Mega.                 |
| Compliance             | Não trata estes anexos como KYC validado; são evidência de parceiro.              |

## 5. Requisitos funcionais

### RF01 — Autenticação e escopos

- Auth: `Authorization: Bearer opc_…` (mesmo modelo atual).
- Novos escopos:
  - `fim.documents.write` — POST e DELETE
  - `fim.documents.read` — GET lista e GET download
- Token sem o escopo → `403` `{ "error": "Escopo ausente" }`.
- Rate limit atual do parceiro (ex.: 120 rpm) aplica-se a estas rotas.
- Rotacionar/atualizar scopes do parceiro Ipe Core via CLI/admin já existente.

### RF02 — Resolução de identidade

Ordem de resolução na escrita e leitura:

1. Se o body/query informar `cotistaId` **e** existir cotista → usar esse registro; CPF/CNPJ do path deve bater com o party (senão `409`).
2. Senão, resolver por `:document` (11 ou 14 dígitos, só números).
3. Se não houver Party/Cotista → **criar** Party (`pf`/`pj` pelo tamanho do documento, `excludeFromPl: true`, status `aprovado`, risco `baixo`) + Cotista. Nome mínimo: body `name` no POST de upload (obrigatório na **primeira** criação); se já existir, `name` opcional.
4. Resposta sempre inclui `cotistaId`, `partyId`, `document` para o parceiro passar a usar o id interno depois.

### RF03 — Rotas

Base: `https://api.admin.opcore.com.br`

| Método   | Rota                                               | Escopo                | Descrição                                             |
| -------- | -------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| `POST`   | `/v1/fim/shareholders/:document/documents`         | `fim.documents.write` | Multipart: `file` (+ `name?`, `cotistaId?`, `label?`) |
| `GET`    | `/v1/fim/shareholders/:document/documents`         | `fim.documents.read`  | Lista metadados                                       |
| `GET`    | `/v1/fim/shareholders/:document/documents/:fileId` | `fim.documents.read`  | Download binário (`disposition=inline\|attachment`)   |
| `DELETE` | `/v1/fim/shareholders/:document/documents/:fileId` | `fim.documents.write` | Remove Mega + metadado                                |

Alternativa aceita no mesmo handler (sem duplicar lógica): query `cotistaId=` em GET/DELETE quando o path `:document` já for conhecido.

Dry-run (`X-Fim-Dry-Run`): **não** se aplica a upload/delete de arquivo (efeito colateral externo). Documentar isso no guia.

### RF04 — Upload

- `multipart/form-data`, campo `file` obrigatório.
- MIME: `application/pdf`, `image/jpeg`, `image/png`, `image/webp` (espelhar limite sensato do FIM).
- Tamanho máximo: **12 MB** (igual proxy admin FIM).
- Opcional: `label` (string curta, até 120 chars) para o parceiro classificar o anexo sem virar slot KYC.
- Dedup opcional por `sha256` + `partyId` + `partnerId`: se idêntico, retornar o registro existente (`200`) sem segundo upload Mega.
- Sucesso: `201` (novo) ou `200` (dedup) com metadados.

### RF05 — Listagem

Retorno JSON:

```json
{
  "document": "12345678901",
  "cotistaId": "…",
  "partyId": "…",
  "items": [
    {
      "id": "…",
      "label": "comprovante",
      "originalName": "comprovante.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "sha256": "…",
      "createdAt": "2026-11-19T12:00:00.000Z"
    }
  ]
}
```

Não expor handles Mega brutos ao parceiro.

### RF06 — Download e delete

- Download: stream do Mega; headers `Content-Type` / `Content-Disposition`.
- Delete: apaga no Mega e remove linha local; `404` se não for do party resolvido ou de outro parceiro.
- Isolamento: parceiro só vê/apaga arquivos com `partnerId` = token autenticado (não lê anexos de outro parceiro no mesmo CPF).

### RF07 — Armazenamento Mega

- Fora do nextcorefim / checklist KYC.
- Preferência: cliente Mega no admin-api (vault HTTP `MEGA_VAULT_*` e/ou MEGAcmd `MEGA_EMAIL`/`MEGA_PASSWORD`), padrão já usado em IndexCore carreiras / nextcorefim.
- Pasta sugerida:

  `opcore/partner-docs/{partnerSlugOrId}/{cpfCnpj}/{fileId}__{safeName}`

- `system` no vault: `opcore` (ou equivalente acordado na infra).
- Env novos no `.env` da API admin (servidor): reutilizar vars Mega se já existirem no host; senão documentar `MEGA_VAULT_URL`, `MEGA_VAULT_API_KEY` e/ou conta MEGAcmd.

### RF08 — Modelo de dados (OpCore)

Nova tabela sugerida `partner_documents` (nome final no Prisma à escolha da implementação):

| Campo                     | Tipo     | Notas                                      |
| ------------------------- | -------- | ------------------------------------------ |
| `id`                      | uuid     | PK / `fileId` na API                       |
| `partnerId`               | fk       | parceiro autenticado                       |
| `partyId`                 | fk       | party do cotista                           |
| `cotistaId`               | fk       | denormalizado para lookup                  |
| `label`                   | string?  | classificação livre                        |
| `originalName`            | string   |                                            |
| `mimeType`                | string   |                                            |
| `size`                    | int      |                                            |
| `sha256`                  | string   | hex 64                                     |
| `megaId`                  | string   | handle                                     |
| `megaPath`                | string   | path remoto                                |
| `createdAt` / `deletedAt` | datetime | soft-delete opcional; MVP pode hard-delete |

Índices: `(partnerId, partyId)`, `(sha256, partnerId, partyId)`, `cotistaId`.

### RF09 — Auditoria

- `audit_logs` (ou log de acesso parceiro existente): `partner.documents.upload|list|download|delete` com `partnerId`, `partyId`, `fileId`, IP.
- Não logar conteúdo do arquivo nem token.

### RF10 — Documentação parceiro

Atualizar:

- `docs/partners/ipbank-routes.md`
- `api/docs/partners/ipe-core-fim.md`
- Catálogo web de API docs (`web/src/features/api-docs/data.ts`) se listar rotas FIM
- `docs/API.md` seção REST parceiros

Incluir exemplos `curl`, tabela de escopos, erros, e aviso de criação automática de cotista.

## 6. Requisitos não funcionais

| ID    | Requisito                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF01 | Timeouts Mega ≤ 60s; falha Mega → `502` com mensagem clara, sem deixar metadado órfão (transação: upload Mega → insert; se insert falhar, tentar delete Mega). |
| RNF02 | Testes Vitest: auth/escopo, resolução híbrida, auto-create, MIME/tamanho, CRUD isolamento entre parceiros, dedup.                                              |
| RNF03 | Sem staging: validar com token de QA + CPF de teste `excludeFromPl`; não usar dry-run de arquivo.                                                              |
| RNF04 | Commits Conventional Commits em inglês; push `origin` + `personal` nos repos api/web conforme `AGENTS.md`.                                                     |
| RNF05 | Não colocar token Bearer em novos docs de exemplo além do padrão já estabelecido no guia (ou preferir placeholder `opc_…` se o time decidir limpar o guia).    |

## 7. Fora de escopo (MVP)

- Validação Compliance / aprovação de documento.
- UI admin para listar anexos de parceiro (fase 2).
- Alterar checklist KYC ou rotas `/files/fim/:cotistaId/documents`.
- PIX, liquidação, crédito no fundo.
- Upload a partir do browser do app do banco (continua server-to-server).

## 8. Plano de ação

### Fase 0 — Preparação (0,5 d)

1. Confirmar no servidor `dl3809` se Mega vault/MEGAcmd já está acessível à API admin; se não, provisionar env + rede.
2. Definir slug de pasta Mega e `system` com infra.
3. Acrescentar escopos no enum/const `FIM_PARTNER_SCOPES` e no token do parceiro Ipe Core (CLI `partner:create` / rotate scopes).

### Fase 1 — Domínio + Mega client (1–1,5 d)

1. Migration Prisma `partner_documents`.
2. Módulo `lib/mega/` (ou `services/mega/`) no admin-api: upload/download/delete buffer, pasta `partner-docs`.
3. Serviço `partner-documents.service.ts`: resolve identidade, auto-create party/cotista, CRUD, dedup, auditoria.
4. Testes unitários do serviço (mocks Mega + Prisma).

### Fase 2 — Rotas parceiro (1 d)

1. Registrar rotas em `fim-partner.routes.ts` (ou módulo dedicado) com `requireScope`.
2. Multipart raw/multer alinhado a `files.routes` (limite 12 MB).
3. Testes de rota (`fim-partner` / novo `partner-documents.routes.test.ts`).
4. Smoke script opcional (espelhar `smoke-document-uploads.ts`).

### Fase 3 — Docs + liberação (0,5 d)

1. Atualizar guias parceiro + `API.md` + catálogo web.
2. Rotacionar/atualizar scopes do token em produção.
3. Entregar exemplos `curl` ao time Ipebank.
4. Validar um upload real de QA e conferir path no Mega.

### Fase 4 — (Opcional) Admin UI

1. tRPC/query listando `partner_documents` por party.
2. Download via rota session (permissão `documents.view_kyc` ou nova `cotistas.view_partner_docs`).

## 9. Critérios de aceite

- [ ] Parceiro com `fim.documents.write` faz `POST` multipart e recebe `201` + `cotistaId`.
- [ ] CPF novo cria Party + Cotista com `excludeFromPl: true` sem subscription prévia.
- [ ] CPF existente + `cotistaId` coerente funciona; `cotistaId` divergente do CPF → `409`.
- [ ] Arquivo aparece no Mega na pasta `opcore/partner-docs/...` (não sob pasta de application KYC).
- [ ] `GET` lista só arquivos daquele `partnerId`.
- [ ] `GET :fileId` devolve o binário; `DELETE` remove Mega + registro.
- [ ] Token sem escopo → `403`; MIME/tamanho inválidos → `400`.
- [ ] Guias do parceiro listam as 4 rotas e os 2 escopos novos.
- [ ] Suite de testes da API passa no CI.

## 10. Riscos

| Risco                                  | Mitigação                                                |
| -------------------------------------- | -------------------------------------------------------- |
| Mega indisponível na API admin         | Fase 0; falha explícita `503`/`502`.                     |
| Cotista criado sem nome útil           | Exigir `name` no primeiro upload que cria party.         |
| Confusão com docs KYC                  | Pasta e tabela separadas; docs do parceiro deixam claro. |
| Vazamento entre parceiros no mesmo CPF | Filtro obrigatório `partnerId` em todas as queries.      |
| Token/escopos esquecidos em prod       | Checklist Fase 3 + CLI.                                  |

## 11. Referências

- Guia atual: `docs/partners/ipbank-routes.md`, `api/docs/partners/ipe-core-fim.md`
- Upload admin KYC/Mega (não reutilizar contrato de slot): `api/src/routes/files.routes.ts`, `api/src/lib/nextcorefim/fim-documents.ts`
- Mega vault: `nextcorefunds/mega/` ; cliente referência: IndexCore `v2/api/src/modules/mega/`
- Escopos FIM: `api/src/services/partner.service.ts`
- `AGENTS.md` do workspace admin-index-core, fora deste repo (deploy, remotes, commits)
