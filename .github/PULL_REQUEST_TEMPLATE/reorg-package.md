# Reorg: Mover pacote (ex.: packages/db -> packages/domains/db)

Resumo
------
Descreva de forma curta o que este PR faz e por quê. Ex.: "Move `packages/db` para `packages/domains/db` para agrupar artefatos do domínio `db` e melhorar organização do monorepo." 

Motivação
---------
- Por que estamos movendo este pacote? (organização, clareza, boundaries)
- Referência ao ETP ou decisão arquitetural: `docs/ETP.md` e `docs/reorg-packages-plan.md`.

O que foi feito
---------------
- `git mv packages/<orig> packages/domains/<target>`
- Mantido `package.json` com `name` original (ex.: `@previa/db`) para preservar imports
- Atualizados arquivos que referenciam caminhos físicos (listar os arquivos alterados)
- Atualizados `tsconfig`/paths quando necessário

Comandos para validar localmente
-------------------------------
```bash
pnpm -w install
pnpm -w build
pnpm -w test
pnpm -w -s typecheck
```

Checklist (obrigatório antes do merge)
-------------------------------------
- [ ] Branch tem um único objetivo e é pequena (um pacote por PR)
- [ ] Root `package.json` workspaces atualizado se necessário
- [ ] `pnpm -w install` roda sem erros
- [ ] `pnpm -w build` passa
- [ ] `pnpm -w test` passa (ou testes do pacote e dependentes diretos)
- [ ] `tsc` (typecheck) limpo para pacotes afetados
- [ ] Nenhum CI job referencia caminhos físicos antigos (ajustados quando encontrados)
- [ ] README / docs do pacote atualizados com novo caminho quando aplicável
- [ ] Notas de migração no `.synapse/synapse_inbox.md` atualizadas
- [ ] Reviewer(s) designados e PR com target branch apropriado

Rollback plan
-------------
- Reverter o PR via interface do GitHub se algo quebrar ou re-aplicar `git mv` inverso.

Impacto esperado
----------------
- Imports por nome (ex.: `@previa/db`) não precisam mudar.
- Possível necessidade de atualizar scripts/CI que usam caminhos físicos.

Notas adicionais
----------------
- Prefira usar este PR para mover apenas o pacote em questão. Para mudanças em múltiplos pacotes, abra PRs separados para cada um.
- Se precisar reescrever imports em massa, considere `ts-morph` ou `jscodeshift`.
