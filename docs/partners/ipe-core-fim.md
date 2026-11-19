# Ipe Core — caixinha FIM

Guia para o backend do banco. A Index registra a aplicação e calcula o rendimento. Não há PIX, liquidação nem crédito no fundo: o valor é visual.

## Spec OpenAPI (Swagger)

Contrato máquina-legível (tags **Caixinha** e **Documentos**):

- [`ipe-core-fim.openapi.yaml`](./ipe-core-fim.openapi.yaml)

Importe no [Swagger Editor](https://editor.swagger.io/) ou em qualquer cliente OpenAPI 3. Exemplos de auth usam o placeholder `opc_…`.

Base: `https://api.admin.opcore.com.br`

Token (sem expiração; válido até revogar ou rotacionar):

```
opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d
```

Chame a partir do servidor do banco, com `Authorization: Bearer opc_…`. Não coloque o token no aplicativo e não chame esta API direto do browser. O CORS desta API não libera o domínio do banco.

Limite: 120 requisições por minuto. Acima disso a resposta é `429` com `Retry-After`.

## O que este token pode consumir

| Método   | Rota                                               | Escopo                    |
| -------- | -------------------------------------------------- | ------------------------- |
| `POST`   | `/v1/fim/subscriptions`                            | `fim.subscriptions.write` |
| `POST`   | `/v1/fim/redemptions`                              | `fim.redemptions.write`   |
| `POST`   | `/v1/fim/cancellations`                            | `fim.cancellations.write` |
| `GET`    | `/v1/fim/shareholders/:document`                   | `fim.shareholders.read`   |
| `GET`    | `/v1/fim/shareholders/:document/yields`            | `fim.shareholders.read`   |
| `POST`   | `/v1/fim/shareholders/:document/documents`         | `fim.documents.write`     |
| `GET`    | `/v1/fim/shareholders/:document/documents`         | `fim.documents.read`      |
| `GET`    | `/v1/fim/shareholders/:document/documents/:fileId` | `fim.documents.read`      |
| `DELETE` | `/v1/fim/shareholders/:document/documents/:fileId` | `fim.documents.write`     |

Qualquer outra rota `/v1` responde `403` com `{ "error": "Escopo ausente" }`.

A chave do cliente é o `document`: CPF com 11 dígitos ou CNPJ com 14, sem pontuação.

## Corte de horário (quando o aporte começa a poder render)

Horário de Brasília (`America/Sao_Paulo`):

| Momento do pedido | `accruesOn`                                              |
| ----------------- | -------------------------------------------------------- |
| Antes das 10:00   | D+1 útil B3                                              |
| 10:00 até 17:30   | Mesmo dia útil B3 (ou o próximo, se hoje não for pregão) |
| Depois das 17:30  | D+2 úteis B3                                             |

Dias úteis B3 = segunda–sexta menos feriados de pregão (lista versionada na Index).

## Como testar (não há ambiente de desenvolvimento)

Não existe staging nem sandbox separado. A integração aponta só para produção (`api.admin.opcore.com.br`). Para validar contratos, cortes de horário e D+5 **sem gravar nada**, use dry-run.

### Dry-run

Nas rotas de escrita (`subscriptions`, `redemptions`, `cancellations`), envie o header:

```
X-Fim-Dry-Run: 1
```

(também aceita `true` ou `yes`)

A API:

1. autentica o token e checa o escopo;
2. valida o corpo (mesmas regras da operação real);
3. calcula a resposta (`accruesOn`, `settlesOn`, `availableToRedeem`, etc.);
4. **não** faz `INSERT`/`UPDATE`, **não** envia e-mail e **não** muda saldo.

A resposta inclui `"dryRun": true`. Os GETs (`shareholders`, `yields`) são só leitura — use-os normalmente, sem o header.

#### Exemplos

Aplicação (valida mínimo R$ 100 na 1ª vez e devolve `accruesOn` / `status`):

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/subscriptions' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'X-Fim-Dry-Run: 1' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Maria Exemplo","document":"12345678901","amountBrl":100,"externalId":"dry-op-1"}'
```

Resgate (valida teto do saldo e devolve `settlesOn` em D+5 B3):

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/redemptions' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'X-Fim-Dry-Run: 1' \
  -H 'Content-Type: application/json' \
  -d '{"document":"12345678901","amountBrl":50,"externalId":"dry-redeem-1"}'
```

Cancelamento (exige que a operação já exista e esteja `pending`; dry-run não marca cancelado):

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/cancellations' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'X-Fim-Dry-Run: 1' \
  -H 'Content-Type: application/json' \
  -d '{"kind":"subscription","externalId":"bank-op-1"}'
```

### Quando for operação real

Sem o header `X-Fim-Dry-Run`, a chamada **grava em produção**. Cotistas criados pela API entram com `excludeFromPl` (fora do PL consolidado). Use documentos de QA sob responsabilidade do banco; não reutilize `externalId` de dry-run em produção real se quiser IDs limpos (dry-run não ocupa o `externalId`).

## Registrar uma aplicação

`POST /v1/fim/subscriptions`

```json
{
  "name": "Maria Exemplo",
  "document": "12345678901",
  "email": "maria@example.com",
  "phone": "11999990000",
  "amountBrl": 100,
  "externalId": "bank-op-1"
}
```

- Primeira aplicação do documento: `amountBrl` mínimo **100**.
- Aportes seguintes: qualquer valor **> 0** (até duas casas).
- `externalId` único por token. Cancelado não pode ser reutilizado (409).
- Resposta traz `accruesOn` e `status` (`pending` até a data de corte, depois `active`).

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/subscriptions' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Maria Exemplo","document":"12345678901","amountBrl":100,"externalId":"bank-op-1"}'
```

## Registrar um resgate

`POST /v1/fim/redemptions`

```json
{
  "document": "12345678901",
  "amountBrl": 149.9,
  "externalId": "bank-redeem-1"
}
```

- O resgate sai do **saldo** (principal + rendimento). Pode **zerar** a caixinha.
- No pedido a API **reserva** o valor: **só esse montante** para de render; o restante continua.
- Liquidação em **D+5 dias úteis B3** (`settlesOn`).
- Teto = `availableToRedeem` (saldo − reservas pendentes).

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/redemptions' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'Content-Type: application/json' \
  -d '{"document":"12345678901","amountBrl":149.9,"externalId":"bank-redeem-1"}'
```

## Cancelar aplicação ou resgate pendente

`POST /v1/fim/cancellations`

```json
{
  "kind": "subscription",
  "externalId": "bank-op-1"
}
```

ou `"kind": "redemption"`.

- Aplicação: só com `status` `pending` (ainda não começou a render).
- Resgate: só com `status` `pending` (antes de `settlesOn`).
- O mesmo `externalId` não pode ser reusado depois (409).

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/cancellations' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d' \
  -H 'Content-Type: application/json' \
  -d '{"kind":"redemption","externalId":"bank-redeem-1"}'
```

## Números básicos

`GET /v1/fim/shareholders/12345678901`

Campos relevantes:

- `totalContributed` — aportado líquido de resgates já liquidados
- `balance` — saldo marcado a mercado
- `pendingRedemptionTotal` / `frozenAmount` — valor reservado que não rende
- `availableToRedeem` — `balance − pendingRedemptionTotal` (pode ser 0)
- `frozenUntil` — maior `settlesOn` ativo, ou `null`
- `yielding` — há saldo além do congelado

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d'
```

## Rendimentos

`GET /v1/fim/shareholders/12345678901/yields?days=30` (ou 60/90) **ou** `?from=&to=`. Não misture.

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/yields?days=30' \
  -H 'Authorization: Bearer opc_c2e88a0407c61f063701b29183c17d62e4652a6bb8287386f491f4b33d43283d'
```

## Anexos genéricos (Mega)

Anexos livres por cotista (comprovantes, contratos, etc.), guardados no Mega. **Não** são os slots de KYC: não há tipo de documento nem fluxo de aprovação. Cada anexo é isolado pelo token do parceiro: você só lista, baixa e apaga o que o seu próprio token enviou, mesmo que outro parceiro tenha anexos para o mesmo CPF/CNPJ.

Escopos: `fim.documents.write` (POST, DELETE) e `fim.documents.read` (GET lista, GET download). O token precisa ter o escopo da rota; sem ele a resposta é `403` com `{ "error": "Escopo ausente" }`.

`:document` é o CPF (11 dígitos) ou CNPJ (14) do cotista. Se vier com pontuação, a API remove os não-dígitos.

> **`X-Fim-Dry-Run` não vale para estas rotas.** O header é ignorado: toda chamada de anexos **grava (ou lê/apaga) em produção**, inclusive o upload.

### Enviar um anexo

`POST /v1/fim/shareholders/:document/documents` — `multipart/form-data`

| Campo       | Obrigatório               | Notas                                                           |
| ----------- | ------------------------- | --------------------------------------------------------------- |
| `file`      | sim                       | O arquivo (binário)                                             |
| `name`      | só se for criar o cotista | Nome/razão social; ver auto-create abaixo                       |
| `cotistaId` | não                       | UUID; se enviado, tem de ser o cotista do `:document` do path   |
| `label`     | não                       | Rótulo livre, até 120 caracteres (espaços nas pontas removidos) |

Regras do arquivo:

- MIME aceito: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
- Tamanho máximo: **12 MB** (12 × 1024 × 1024 bytes). Um arquivo por requisição.

**Auto-create no primeiro upload.** Se o CPF/CNPJ ainda não existir na Index, o `POST` cria Party + Cotista automaticamente (entram com `excludeFromPl`, fora do PL consolidado) e **exige o campo `name`**. Não cria aplicação nem vínculo com fundo. Apenas o `POST` cria: `GET` e `DELETE` para um CPF/CNPJ sem cotista respondem `404` com `{ "error": "Cotista não encontrado" }`.

**Deduplicação.** Reenviar o mesmo conteúdo (mesmo `sha256`) para o mesmo cotista não duplica o arquivo: a API devolve o registro existente com `200` e `"created": false`.

Resposta `201` (novo anexo; `200` na deduplicação, com `"created": false`):

```json
{
  "id": "3f1c2a9e-0000-0000-0000-000000000000",
  "document": "12345678901",
  "cotistaId": "7b8d4e21-0000-0000-0000-000000000000",
  "partyId": "9a0e5c33-0000-0000-0000-000000000000",
  "label": "comprovante",
  "originalName": "comprovante.pdf",
  "mimeType": "application/pdf",
  "size": 102400,
  "sha256": "<64 caracteres hex>",
  "createdAt": "2026-11-19T12:00:00.000Z",
  "created": true
}
```

```bash
curl -sS -X POST 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/documents' \
  -H 'Authorization: Bearer opc_…' \
  -F 'file=@./comprovante.pdf;type=application/pdf' \
  -F 'name=Maria Exemplo' \
  -F 'label=comprovante'
```

Não defina `Content-Type` à mão: o `curl -F` monta o `multipart/form-data` com o `boundary` correto. Para um cotista que já existe, `name` pode ser omitido (e `cotistaId` pode ser usado como conferência):

```bash
curl -sS -X POST 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/documents' \
  -H 'Authorization: Bearer opc_…' \
  -F 'file=@./contrato.png;type=image/png' \
  -F 'cotistaId=7b8d4e21-0000-0000-0000-000000000000' \
  -F 'label=contrato'
```

### Listar anexos

`GET /v1/fim/shareholders/:document/documents` — query opcional `cotistaId`.

Resposta `200` (sem identificadores internos do Mega):

```json
{
  "document": "12345678901",
  "cotistaId": "7b8d4e21-0000-0000-0000-000000000000",
  "partyId": "9a0e5c33-0000-0000-0000-000000000000",
  "items": [
    {
      "id": "3f1c2a9e-0000-0000-0000-000000000000",
      "label": "comprovante",
      "originalName": "comprovante.pdf",
      "mimeType": "application/pdf",
      "size": 102400,
      "sha256": "<64 caracteres hex>",
      "createdAt": "2026-11-19T12:00:00.000Z"
    }
  ]
}
```

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/documents' \
  -H 'Authorization: Bearer opc_…'
```

### Baixar um anexo

`GET /v1/fim/shareholders/:document/documents/:fileId` — query opcional `disposition=inline|attachment` (padrão `attachment`).

A resposta é o binário, com `Content-Type` e `Content-Disposition`. Use `-o` (ou `-OJ`) para salvar em arquivo:

```bash
curl -sS -o comprovante.pdf \
  'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/documents/3f1c2a9e-0000-0000-0000-000000000000?disposition=attachment' \
  -H 'Authorization: Bearer opc_…'
```

### Apagar um anexo

`DELETE /v1/fim/shareholders/:document/documents/:fileId`

Apaga o arquivo no Mega e o registro (sem lixeira nem recuperação).

```bash
curl -sS -X DELETE \
  'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/documents/3f1c2a9e-0000-0000-0000-000000000000' \
  -H 'Authorization: Bearer opc_…'
```

Resposta `200`:

```json
{
  "ok": true,
  "id": "3f1c2a9e-0000-0000-0000-000000000000",
  "document": "12345678901",
  "cotistaId": "7b8d4e21-0000-0000-0000-000000000000",
  "partyId": "9a0e5c33-0000-0000-0000-000000000000"
}
```

### Erros específicos de anexos

| HTTP | Quando                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `document` inválido; MIME fora da lista ou arquivo &gt; 12 MB; `name` ausente na criação; multipart inválido; `label` &gt; 120 |
| 403  | Token sem `fim.documents.read` / `fim.documents.write`                                                                         |
| 404  | `GET`/`DELETE` sem cotista; arquivo inexistente ou de outro parceiro                                                           |
| 409  | `cotistaId` existe, mas o CPF/CNPJ é diferente do `:document` do path                                                          |
| 502  | Falha ao falar com o Mega (rede/API)                                                                                           |
| 503  | Armazenamento Mega não configurado                                                                                             |

O corpo de erro segue o padrão do FIM: `{ "error": "<mensagem em português>" }`.

## Erros

| HTTP | Quando                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 400  | Campo inválido, 1ª aplicação &lt; 100, resgate acima do saldo, cancelamento de operação já liquidada/ativa |
| 401  | Token ausente ou inválido                                                                                  |
| 403  | Token sem o escopo da rota                                                                                 |
| 404  | Sem caixinha / operação inexistente                                                                        |
| 409  | `externalId` já usado (inclusive após cancel)                                                              |
| 429  | Limite de 120 req/min                                                                                      |
