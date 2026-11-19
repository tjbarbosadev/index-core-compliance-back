# Tasks — Documentos do parceiro (Mega)

| Campo                   | Valor                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Entrada                 | [PRD](../../PRD-PARTNER-DOCUMENTS-MEGA-2026-11.md) · [TechSpec](../../TECHSPEC-PARTNER-DOCUMENTS-MEGA-2026-11.md) |
| Task principal          | [`PD-FEATURES`](PD-FEATURES.md)                                                                                   |
| Subtarefas              | esta pasta (`PD-00` … `PD-OPS`)                                                                                   |
| Backlog                 | [`backlog.md`](backlog.md)                                                                                        |
| Repo principal          | `index-core/admin-backend` (`admin/admin-index-core/api`)                                                         |
| Repo docs UI (opcional) | `index-core/admin-frontend` (`admin/admin-index-core/web`)                                                        |

## Issues no GitHub

| ID          | Issue                                                 |
| ----------- | ----------------------------------------------------- |
| PD-FEATURES | https://github.com/index-core/admin-backend/issues/4  |
| PD-00       | https://github.com/index-core/admin-backend/issues/5  |
| PD-01       | https://github.com/index-core/admin-backend/issues/6  |
| PD-02       | https://github.com/index-core/admin-backend/issues/7  |
| PD-03       | https://github.com/index-core/admin-backend/issues/8  |
| PD-04       | https://github.com/index-core/admin-backend/issues/9  |
| PD-05       | https://github.com/index-core/admin-backend/issues/10 |
| PD-OPS      | https://github.com/index-core/admin-backend/issues/11 |
| PD-06       | https://github.com/index-core/admin-frontend/issues/2 |

No PR: `Closes #<n>` (mesmo repo) ou `Closes index-core/admin-frontend#2` quando aplicável.

## Como uma task funciona

- **Uma task = worktree + PR** (exceto `PD-OPS` = checklist pós-merge).
- Ramo: `task/<ID>` (ex.: `task/PD-01`).
- Título do PR: Conventional Commit em inglês + `[<ID>]`.
- Autor único Thiago Barbosa; **proibido** `Co-authored-by` e menção a ferramenta no PR.
- Respeitar **onda** e dependências; mesma onda = paralelo.
- **Só começar a task depois do merge das dependências** na `main`. Worktrees de ondas futuras só após o merge.
- Deploy / env produção (`PD-OPS`) só com aprovação explícita do Thiago.
- **Não** usar nextcorefim/KYC slots neste epic.

## Worktree (obrigatório nas tasks de código)

```bash
cd /home/thiago/Ipebank/admin/admin-index-core/api
git fetch origin
git worktree add ../api-PD-01 -b task/PD-01 origin/main
```

Quando **done** (PR mergeado):

```bash
cd /home/thiago/Ipebank/admin/admin-index-core/api
git worktree remove ../api-PD-01
git branch -d task/PD-01 2>/dev/null || true
git worktree prune
# atualizar backlog.md
```

## Ondas

| Onda | IDs              | Pode começar quando                                         |
| ---- | ---------------- | ----------------------------------------------------------- |
| 0    | `PD-00`          | já (specs no repo)                                          |
| 1    | `PD-01`, `PD-02` | já (paralelo; não dependem um do outro)                     |
| 2    | `PD-03`          | **após merge** de `PD-01` **e** `PD-02`                     |
| 3    | `PD-04`, `PD-05` | **após merge** de `PD-03` (paralelo entre si)               |
| 4    | `PD-06`          | após merge de `PD-05` (ou TechSpec estável + rotas em main) |
| ops  | `PD-OPS`         | após merge de `PD-04` + deploy                              |

## Tamanhos

| Tam. | Agente | Revisão |
| ---- | ------ | ------- |
| S    | ≤ 2 h  | ~10 min |
| M    | ≤ 4 h  | ~15 min |
| L    | ≤ 8 h  | ~25 min |

## Ciclo

1. DoR: TechSpec + dependências **merged** em `origin/main`; issue aberta.
2. Criar worktree `task/<ID>` a partir de `origin/main` (não da worktree irmã).
3. Implementar; `lint` / `format:check` / `typecheck` / `test` / `build`.
4. PR com `Closes #<n>` + evidências; aprovação Thiago; **merge**.
5. Remover worktree; atualizar `backlog.md`; só então abrir worktree da próxima onda.
