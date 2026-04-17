# Plano de Reorganização de `packages` (domain-specific)

Data: 2026-04-17
Autor: Copilot (automatizado)

Resumo
------
Este documento descreve um plano de baixo-risco para reorganizar packages domain-specific do monorepo `previa_finance` movendo-os para uma hierarquia mais clara (ex.: `packages/domains/*`) e atualizando workspaces/imports conforme necessário. O objetivo é melhorar a escalabilidade e legibilidade do repositório sem causar regressões em CI.

Inventário atual (detectado)
---------------------------
- Root workspace: workspaces em `package.json` contém `apps/*` e `packages/*`.
- Pacotes detectados em `packages/`:
  - `packages/core` — core shared code
  - `packages/db` — módulo de banco de dados / schema
  - `packages/parsers` — (presumido) parsers
- Apps detectadas:
  - `apps/web` (tem `package.json`)
  - `apps/api` (diretório presente; confirmar `package.json`)

Objetivo da reorganização
-------------------------
- Mover packages de domínio (ex.: `db`, `auth`, `payments`, `investments`) para `packages/domains/<domain>`.
- Manter packages utilitários / infra em `packages/<infra>` ou `packages/libs` (ex.: `core`, `parsers`).
- Atualizar os workspaces no root `package.json` para cobrir novos globs.
- Atualizar imports e paths quando necessário e garantir que aliases/tsconfig paths sejam consistentes.
- Rodar validações (build, typecheck, tests) e criar PRs pequenos e reversíveis.

Proposta de nova estrutura (exemplo)
-----------------------------------
- packages/
  - domains/
    - db/        -> (mover `packages/db` para `packages/domains/db`)
    - finance/   -> (se houver payment/investment domain)
    - auth/      -> (quando existir pacote de autenticação)
  - libs/
    - core/      -> `packages/core` (move ou mantem em top-level `packages/core`)
    - parsers/   -> `packages/parsers`

Notas:
- Manter `core` em `packages/core` ou movê-lo para `packages/libs/core` depende da preferência; ambas são válidas. Se mantiver, menos mudanças são necessárias.
- A raiz `workspaces` precisa ser atualizada se os novos diretórios não corresponderem ao glob atual.

Passo a passo (migração incremental — recomendada)
-------------------------------------------------
1. Audit e inventário (não destrutivo)
   - Executar: `pnpm -w -s list --depth 0` para ver versões e dependências visíveis.
   - Listar todos os `package.json` e seus `name` e `dependencies`.
   - Verificar `tsconfig.json` (paths) nos pacotes que usam aliases.

2. Planejar o mapeamento e decidir targets
   - Escolher quais packages serão movidos (ex.: mover `db` -> `domains/db`).
   - Decidir onde `core` ficará (mantido em `packages/core` ou `packages/libs/core`).

3. Atualizar `package.json` root (workspaces)
   - Adicionar novos globs antes de mover fisicamente:
     - Exemplo: alterar "workspaces" para: `["apps/*","packages/*","packages/domains/*","packages/libs/*"]` ou simplesmente `["apps/*","packages/*"]` se os novos subdirs ficarem sob `packages/` e o glob `packages/*` continuar a encontrar apenas o primeiro nível (OBS: `packages/*` NÃO encontra `packages/domains/*`).
   - Recomendo adicionar `packages/domains/*` e `packages/libs/*` explicitamente.

4. Criar branch de migração pequena (por pacote)
   - Para cada pacote a mover, criar um branch: `feat/reorg/db-to-domains-db`.
   - No branch:
     a) Criar nova pasta target (`packages/domains/db`) e mover os arquivos (git mv ou commit de criação/remoção).
     b) Atualizar o `name` no `package.json` se manter o mesmo namespace (normalmente não precisa mudar `name`), e garantir `main/types` apontam para os caminhos válidos.
     c) Atualizar referências internas (import paths) em outros pacotes: buscar `@previa/db` ou imports relativos e ajustar se necessário.
     d) Atualizar `tsconfig.json` ou `paths` na raiz se uso de path aliases (`compilerOptions.paths`).
     e) Rodar `pnpm -w i` (instalar), `pnpm -w build`, `pnpm -w -s test` e `pnpm -w -s lint`.
   - Se tudo verde, abrir PR pequeno com descrição e checklist.

5. Repetir para cada pacote necessário (menos acoplamento primeiro)
   - Priorizar pacotes com menos dependências (ex.: `db` pode ter várias referencias — avaliar se mover primeiro é sensato).

6. Limpeza e documentação
   - Atualizar README dos pacotes movidos com novo caminho e exemplos.
   - Atualizar `docs/` (adicionar `docs/reorg-packages-plan.md` e link em README raiz se aplicável).

Comandos úteis (locais)
-----------------------
- Listar pacotes e suas versões:
  ```bash
  pnpm -w -s list --depth 0
  ```
- Rodar build e testes em toda monorepo:
  ```bash
  pnpm -w install
  pnpm -w build
  pnpm -w test
  ```
- Mover um pacote (exemplo usando git):
  ```bash
  git checkout -b feat/reorg/db-to-domains-db
  mkdir -p packages/domains/db
  git mv packages/db/* packages/domains/db/
  # remover a antiga pasta vazia, ajustar package.json se necessário
  git add -A
  git commit -m "chore(reorg): move packages/db -> packages/domains/db"
  ```

Checklist de PR (por pacote)
----------------------------
- [ ] Branch tem um único objetivo (mover X)
- [ ] `pnpm -w install` roda sem erros
- [ ] `pnpm -w build` passa
- [ ] `pnpm -w test` passa (ou, quando muito lento, rodar testes do pacote e dependentes directos)
- [ ] `tsc` typecheck limpo (root/afetados)
- [ ] Atualizados `tsconfig.json` / `paths` se aplicável
- [ ] Documentação (README) atualizada com novo caminho
- [ ] Changelog/nota de migração adicionada (breve)
- [ ] Reviewer designado e PR com target branch de integração (ex.: `feat/db-redesign`)

Validações automáticas/locais
-----------------------------
- CI pipeline deve rodar build/test. Garanta que PR esteja configurado para rodar a pipeline completa.
- Validar imports estáticos com `grep` ou `ripgrep`:
  ```bash
  rg "from\s+['\"]@previa/db|@previa/db" -n
  ```
  Ajustar imports que usam caminhos relativos.

Rollback plan
-------------
- Mantenha cada mudança em PRs pequenos. Se algo quebrar:
  - Reverter o PR (GitHub revert) — restaura commits anteriores.
  - Ou re-aplicar `git mv` invertendo e abrir PR de correção.

Riscos e mitigação
------------------
- Quebra de imports/paths: Mitigar rodando `rg` para localizar todos os imports e atualizando-os automaticamente com `jscodeshift` ou scripts sed/ts-morph.
- CI lento/falhas intermitentes: rodar testes por pacote localmente e limitar alterações por PR.
- Pacotes com deep-deps: priorizar mover pacotes com menos dependentes, ou usar um alias temporário.

Sugestões extras (low-risk)
---------------------------
- Em vez de mover tudo de uma vez, considere manter packages no mesmo lugar e apenas adicionar `domains/` como novos pacotes para futuros trabalhos; migrar consumidores gradualmente.
- Use `ts-morph` para reescrita segura de imports quando necessário.
- Atualize `README.md` raiz para documentar nova convenção (ex.: `packages/domains/`, `packages/libs/`).

Entregáveis propostos
--------------------
- `docs/reorg-packages-plan.md` (este documento)
- PRs pequenos por pacote contendo `git mv` + mudanças e checklist
- Script opcional `scripts/migrate-package.sh` (opcional) para automatizar renomeios e substituir imports

Próximos passos sugeridos
------------------------
1. Revisão conjunta deste plano e aprovação do mapeamento (quais pacotes mover, ordem).
2. Executar o passo 1 (audit) localmente e anexar o inventário completo de `package.json` (nome, versão, dependências). Use `pnpm -w list --depth 0`.
3. Iniciar PRs pequenos, um por pacote, seguindo checklist.

Fim do documento.
