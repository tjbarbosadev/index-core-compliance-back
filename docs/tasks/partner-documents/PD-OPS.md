# PD-OPS — Env Mega, scopes do token e smoke produção

| Campo          | Valor                                                 |
| -------------- | ----------------------------------------------------- |
| ID             | `PD-OPS`                                              |
| Task principal | [PD-FEATURES](PD-FEATURES.md)                         |
| Onda           | ops                                                   |
| Tipo           | Checklist (sem PR de código, salvo hotfix)            |
| Tamanho        | S                                                     |
| Repo           | ops / `dl3809`                                        |
| Status         | `todo`                                                |
| Issue          | https://github.com/index-core/admin-backend/issues/11 |
| Worktree       | —                                                     |

## Objetivo

Habilitar a feature em produção após merge de `PD-04` (e deploy da API).

## Definição de pronto

- [ ] `MEGA_VAULT_*` e/ou `MEGA_EMAIL`/`MEGA_PASSWORD` no `.env` da API em `~/projects/opcore/api`.
- [ ] Container recriado / deploy com migrate `partner_documents`.
- [ ] `api_partners.scopes` do Ipe Core inclui `fim.documents.read` e `fim.documents.write`.
- [ ] Smoke: `POST` multipart QA → arquivo visível no Mega em `partner-docs/...`; `GET` lista; `DELETE` limpa.
- [ ] Evidências coladas na issue (sem colar token completo nem arquivos sensíveis).

## Dependências

`PD-04` merged + deploy (aprovação explícita do Thiago para deploy).

## Passos

1. Confirmar migrate no deploy log.
2. Atualizar scopes (SQL ou UI parceiros / admin).
3. Smoke com CPF `excludeFromPl`.
4. Fechar issue com checklist marcado.

## Referências

TechSpec §8; PRD Fase 0/3; `AGENTS.md` deploy.
