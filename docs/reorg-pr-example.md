# Exemplo de PR: mover `packages/db` -> `packages/domains/db`

Branch: feat/reorg/db-to-domains-db

Descrição (exemplo)
-------------------
Move `packages/db` para `packages/domains/db` para agrupar artefatos relacionados ao domínio `db` e melhorar a organização do monorepo. Mantive o campo `name` em `packages/domains/db/package.json` como `@previa/db` para preservar imports existentes.

Passos realizados
-----------------
1. git mv packages/db packages/domains/db
2. Atualizei `docs/` e `.synapse/synapse_inbox.md` com nota de migração
3. Rodado:
   - `pnpm -w install`
   - `pnpm -w build`
   - `pnpm -w test`
   - `pnpm -w -s typecheck`
4. Corrigi referências encontradas a caminhos físicos (nenhuma alteração de import por nome necessária)

Arquivos alterados (exemplo)
---------------------------
- packages/domains/db/package.json (moved)
- .synapse/synapse_inbox.md (nota de migração)
- docs/reorg-pr-example.md (este arquivo)

Checklist preenchido
---------------------
- [x] Branch tem um único objetivo (mover `db`)
- [x] Root `package.json` workspaces atualizado (inclui `packages/domains/*`)
- [x] `pnpm -w install` roda sem erros
- [x] `pnpm -w build` passou
- [x] `pnpm -w test` passou
- [x] `tsc` limpo para pacotes afetados
- [x] README atualizado (se aplicável)

Testing notes
-------------
- Se CI falhar em jobs que usam caminhos físicos, adicionar ajuste no PR antes de merge.

Rollback
--------
- Reverter PR no GitHub (revert) se necessário.

Observações
----------
- Este é um exemplo de PR e deve ser adaptado ao pacote real sendo movido.
