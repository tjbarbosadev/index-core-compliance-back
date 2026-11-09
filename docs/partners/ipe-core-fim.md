# Ipe Core — caixinha FIM

Guia para o backend do banco. A Index registra a aplicação e calcula o rendimento. Não há PIX, liquidação nem crédito no fundo: o valor é visual.

Base: `https://api.admin.opcore.com.br`

Chame a partir do servidor do banco, com `Authorization: Bearer opc_…`. Não coloque o token no aplicativo e não chame esta API direto do browser. O CORS desta API não libera o domínio do banco.

Limite: 120 requisições por minuto. Acima disso a resposta é `429` com `Retry-After`.

## O que este token pode consumir

Só estas rotas:

| Método | Rota                                    | Escopo                    |
| ------ | --------------------------------------- | ------------------------- |
| `POST` | `/v1/fim/subscriptions`                 | `fim.subscriptions.write` |
| `POST` | `/v1/fim/redemptions`                   | `fim.redemptions.write`   |
| `GET`  | `/v1/fim/shareholders/:document`        | `fim.shareholders.read`   |
| `GET`  | `/v1/fim/shareholders/:document/yields` | `fim.shareholders.read`   |

Qualquer outra rota `/v1` responde `403` com `{ "error": "Escopo ausente" }`.

A chave do cliente é o `document`: CPF com 11 dígitos ou CNPJ com 14, sem pontuação. O banco não usa o id interno do cotista.

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

- `name` e `document` são obrigatórios.
- `email` e `phone` são opcionais.
- `amountBrl` é o valor em reais, no máximo duas casas decimais, mínimo 100. Uma cota vale R$ 1.
- `externalId` é o id da operação no banco, único para este token. Repetir o mesmo id não soma de novo.
- `fundId` só é necessário se houver mais de um FIM ativo.

A primeira aplicação do documento abre a caixinha. A seguinte soma na mesma. A resposta:

```json
{
  "document": "12345678901",
  "result": "created",
  "amountBrl": 100,
  "totalContributed": 100,
  "balance": 100,
  "yieldAccumulated": 0
}
```

`result` é `created` ou `toppedUp`.

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/subscriptions' \
  -H 'Authorization: Bearer opc_••••' \
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

- `document`, `amountBrl` e `externalId` são obrigatórios.
- O resgate sai do **aportado** (`totalContributed`), não do saldo com rendimento.
- Depois de reservar o valor, a caixinha deve sobrar pelo menos **R$ 100** (1 cota). O teto é `availableToRedeem`.
- No pedido a API **reserva** o valor: a caixinha **inteira para de render**.
- Liquidação em **D+5 dias úteis** (segunda–sexta; sem calendário de feriado). Em `settlesOn` o aportado cai e o rendimento volta no restante.
- `externalId` único por token. Repetir o mesmo id não cria outro resgate.

A resposta:

```json
{
  "document": "12345678901",
  "result": "pending",
  "amountBrl": 149.9,
  "settlesOn": "2026-06-08",
  "totalContributed": 1000,
  "availableToRedeem": 750.1,
  "frozenUntil": "2026-06-08",
  "balance": 1000.42,
  "yieldAccumulated": 0.42
}
```

Enquanto o resgate está pendente, `totalContributed` ainda não desconta o valor; `availableToRedeem` e o freeze já refletem a reserva. Após a liquidação, `totalContributed` cai pelo `amountBrl` e o rendimento acumulado permanece na caixinha.

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/redemptions' \
  -H 'Authorization: Bearer opc_••••' \
  -H 'Content-Type: application/json' \
  -d '{"document":"12345678901","amountBrl":149.9,"externalId":"bank-redeem-1"}'
```

## Números básicos

`GET /v1/fim/shareholders/12345678901`

```json
{
  "name": "Maria Exemplo",
  "document": "12345678901",
  "totalContributed": 1000,
  "quotaCount": 1000,
  "balance": 1000.42,
  "yieldDay": 0,
  "yieldAccumulated": 0.42,
  "startDate": "2026-06-01",
  "visualizationDate": "2026-05-29",
  "pendingRedemptionTotal": 149.9,
  "availableToRedeem": 750.1,
  "frozenUntil": "2026-06-08",
  "yielding": false
}
```

- `totalContributed` / `quotaCount`: aportado líquido de resgates **já liquidados** (1 cota = R$ 1). Pendentes ainda não reduzem este número.
- `pendingRedemptionTotal`: soma dos resgates ainda não liquidados.
- `availableToRedeem`: quanto ainda pode resgatar mantendo residual ≥ R$ 100.
- `frozenUntil`: data de liquidação do freeze ativo (`settlesOn`), ou `null` se estiver rendendo.
- `yielding`: `false` enquanto a caixinha estiver congelada por resgate.
- `visualizationDate`: último dia já calculado.

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901' \
  -H 'Authorization: Bearer opc_••••'
```

## Rendimentos

`GET /v1/fim/shareholders/12345678901/yields`

Use um dos dois modos. Não misture.

- Últimos 30, 60 ou 90 dias corridos, até a data de visualização: `?days=30`, `?days=60` ou `?days=90`.
- Período escolhido, inclusive: `?from=2026-05-01&to=2026-05-29`. Datas anteriores ao início da caixinha e posteriores à data de visualização são cortadas.

Cada item traz `referenceDate`, `selicPercent`, `principal`, `yieldDay`, `yieldAccumulated` e `balanceTotal`. Em dias de freeze, `yieldDay` fica 0.

```bash
curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/yields?days=30' \
  -H 'Authorization: Bearer opc_••••'

curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/yields?days=60' \
  -H 'Authorization: Bearer opc_••••'

curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/yields?days=90' \
  -H 'Authorization: Bearer opc_••••'

curl -sS 'https://api.admin.opcore.com.br/v1/fim/shareholders/12345678901/yields?from=2026-05-01&to=2026-05-29' \
  -H 'Authorization: Bearer opc_••••'
```

## Erros

| HTTP | Quando                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------- |
| 400  | Campo inválido, aporte abaixo de 100, resgate acima do disponível / residual &lt; 100, ou `days` misturado com `from`/`to` |
| 401  | Token ausente ou inválido                                                                                                  |
| 403  | Token sem o escopo da rota                                                                                                 |
| 404  | Documento sem caixinha FIM, ou fundo inexistente                                                                           |
| 409  | `externalId` já usado para outro documento ou outro fundo                                                                  |
| 429  | Limite de 120 requisições por minuto                                                                                       |
