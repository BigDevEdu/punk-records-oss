# Painel de administração — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIO: superpowers:subagent-driven-development, tarefa por tarefa, com o **modelo indicado em cada tarefa**. Passos em checkbox (`- [ ]`). Commits em pt-BR, **sem** `Co-Authored-By` nem assinatura do Claude.

**Objetivo:** painel web em `/admin` (React + Vite) para ver a memória como grafo por similaridade e administrar agentes, servido pelo mesmo processo do MCP.

**Arquitetura:** API JSON nova em `/admin/api` (Starlette, sessão por cookie após login com token `global`) reaproveitando `MemoryStore`, `ConfigStore` e `authz`; grafo kNN calculado em numpy fora da fila do store; auditoria passa a ser gravada em arquivo para "último uso" e Atividade; SPA React buildada num estágio Node do Dockerfile e servida como estáticos.

**Stack:** Python 3.12, Starlette (já via `mcp`), numpy (já via `epochdb`); React 18, Vite, TypeScript, `react-router-dom` 6, `react-force-graph-2d`, `@fontsource/ibm-plex-sans`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-painel-admin-design.md` + mockups em `docs/superpowers/specs/mockups/` (referência visual obrigatória para T6–T8).

## Global Constraints

- Nenhuma dependência Python nova (numpy e Starlette já estão instalados).
- Painel aceita só token de agente **ativo** com papel **`global`**; sessão de **12 h**; cookie `pr_session` com `HttpOnly; Secure; SameSite=Strict; Path=/admin` (sem `Secure` só com `PR_ADMIN_INSECURE_COOKIE=1`).
- Login com falha: 401 após atraso de **500 ms**, `detail` = "Esse token não tem papel global. Use um token de administrador."
- Mutações da API exigem `Content-Type: application/json`.
- Erros: `{"error": "forbidden|invalid|not_found|unauthorized", "detail": str}`.
- Grafo: `k=5`, `min_sim=0.55`, grupos com arestas ≥ `0.6` e tamanho ≥ 3; texto do nó até **160** caracteres.
- Auditoria em `/data/audit.jsonl` (`<storage_dir>/audit.jsonl`), rotação ao passar de **10 MB** para `audit.jsonl.1`.
- Id de agente e de projeto novo: `^[a-z0-9][a-z0-9-]{1,62}$`; `_shared` não pode ser criado.
- Proibido revogar, excluir, rebaixar de `global` ou gerar token do **agente da própria sessão** → `forbidden` "Você não pode alterar o agente da sua própria sessão."
- Visual = spec §9 (tokens de cor, IBM Plex Sans empacotada, raio 6/8 px, bordas 1 px, **sem sombras, gradientes, vidro, emojis, rótulos em maiúsculas ou "·" entre metadados**).
- Node só no estágio de build do Docker; imagem final continua só Python.

## Review Focus

1. **Admin revoga o próprio token pelo CLI com o painel aberto** → a próxima chamada da API dá 401 e a SPA volta ao login. Teste em T4 (`test_session_dies_when_agent_revoked`) e T6 (cliente redireciona em 401).
2. **Memória apagada (soft ou hard) ainda aparecendo no grafo** por versão antiga no cold tier. Teste em T3 (`test_all_live_skips_old_versions_of_deleted`).
3. **Deep link `/admin/agentes` recarregado no navegador** → precisa devolver o `index.html`, não 404. Teste em T4 (`test_spa_fallback_serves_index`).
4. **`agents.yaml` ausente** (servidor recém-subido) e o painel tentando listar ou criar o primeiro agente → lista vazia; criar gera o arquivo. Teste em T1 (`test_create_agent_creates_file`).
5. **Grafo com 0 ou 1 memória** → `{"nodes": [...], "edges": [], "clusters": []}` sem erro de numpy. Teste em T3 (`test_build_graph_small_inputs`).

---

## Etapas e modelos

| Etapa | Tarefas | Entrega revisável | Implementador | Revisor |
|---|---|---|---|---|
| P1 — Base do backend | T1 agents_file · T2 activity · T3 grafo | módulos puros testados | T1 haiku · T2 sonnet · T3 sonnet | sonnet |
| P2 — API do painel | T4 sessão e montagem · T5 rotas de dados e agentes | API completa com testes | T4 **opus** · T5 sonnet | T4 **opus** · T5 sonnet |
| P3 — Frontend | T6 base, login e layout · T7 Cérebro · T8 Agentes e Atividade | SPA navegável contra o backend local | sonnet nas três | sonnet |
| P4 — Integração | T9 Docker, docs | `docker build` e painel em `/admin` | haiku | sonnet; revisão final **opus** |

Cada etapa termina em branch/PR próprio para o usuário revisar; na P3, revisão visual do usuário contra os mockups antes do PR.

---

## Estrutura de arquivos

```
punk_records/agents_file.py   T1  ler/gravar agents.yaml (sai de cli.py) + operações de agente
punk_records/activity.py      T2  handler de log em arquivo, último uso, leitura do fim
punk_records/graph.py         T3  kNN, grupos, nomes, montagem do grafo, cache
punk_records/store.py         T3  + all_live()
punk_records/admin.py         T4/T5  sessão, rotas /admin/api, estáticos e fallback
punk_records/server.py        T4  BearerAuth ignora /admin; build_app monta o painel
punk_records/cli.py           T1/T2  usa agents_file; serve instala o ActivityLog
web/                          T6–T8  SPA
Dockerfile                    T9  estágio Node
tests/test_agents_file.py  tests/test_activity.py  tests/test_graph.py  tests/test_admin.py
```

---

## P1 — Base do backend

### Task 1: agents_file (modelo: haiku)

**Files:** Create `punk_records/agents_file.py`, `tests/test_agents_file.py`; Modify `punk_records/cli.py` (usar o módulo; comportamento do CLI inalterado).

**Interfaces — Produces:**
- `load_raw(path: str, create: bool = False) -> dict` e `save(path: str, raw: dict) -> None` — movidos de `cli.py` (`_load_raw`, `_save`); `save` **levanta `ConfigError`** em vez de imprimir/retornar 1 (o CLI captura e imprime).
- `ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")`
- `new_token() -> str` (`"pr_" + secrets.token_urlsafe(32)`).
- `create_agent(path, agent_id, role, projects) -> str` (token; `ConfigError` se id inválido, já existe, projeto inválido ou `_shared`).
- `update_agent(path, agent_id, *, role=None, projects=None, disabled=None) -> None`
- `rotate_token(path, agent_id) -> str`
- `delete_agent(path, agent_id) -> None`
- Projetos novos entram na lista `projects` do topo (regra do CLI). Agente inexistente → `KeyError(agent_id)`.
- Um `threading.Lock` de módulo envolve cada operação ler-modificar-gravar.

- [ ] **Step 1: testes** (`tmp_path`): `test_create_agent_creates_file` (arquivo ausente → criado; `load_config` acha o hash do token devolvido), `test_create_duplicate_id_raises`, `test_invalid_id_raises` (`"Bad_Id"`, `"_shared"` como projeto), `test_update_role_projects_disabled`, `test_rotate_invalidates_old_token`, `test_delete_agent`, `test_unknown_agent_keyerror`. Os testes atuais de `tests/test_cli.py` continuam passando sem alteração.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_agents_file.py -v` → FAIL (import).
- [ ] **Step 3:** implementar e adaptar `cli.py`.
- [ ] **Step 4:** `.venv/bin/pytest -q` → tudo PASS.
- [ ] **Step 5:** commit `refactor: agents_file com operações de agente compartilhadas pelo CLI e pelo painel`.

### Task 2: activity (modelo: sonnet)

**Files:** Create `punk_records/activity.py`, `tests/test_activity.py`; Modify `punk_records/cli.py` (`_serve` instala o log), `punk_records/server.py` (`build_app(..., activity=None)` repassa ao painel; nada muda no wrapper).

**Interfaces — Produces:**
- `class ActivityLog(path: str, max_bytes: int = 10_000_000)`:
  - `handler() -> logging.Handler` — anexa cada `record.getMessage()` (a linha JSON) + `\n` ao arquivo; rotaciona para `path + ".1"` quando passar de `max_bytes`; atualiza `last_used[agent_id] = ts`.
  - `last_used: dict[str, float]` — reconstruído no `__init__` lendo o arquivo atual.
  - `tail(limit: int = 100, agent: str | None = None) -> list[dict]` — mais novas primeiro, lendo o fim do arquivo em blocos (não carrega tudo); linhas inválidas são ignoradas.
- `install(activity: ActivityLog) -> None` — adiciona o handler ao logger `punk_records.audit` (idempotente).
- `_serve`: `ActivityLog(os.path.join(settings.storage_dir, "audit.jsonl"))`, `install`, repassa para `build_app`.

- [ ] **Step 1: testes:** `test_handler_appends_and_updates_last_used`, `test_rotation_at_max_bytes` (`max_bytes=200`; após várias linhas existe `.1` e o atual é menor que 200 + uma linha), `test_last_used_rebuilt_on_init`, `test_tail_newest_first_and_agent_filter`, `test_tail_skips_bad_lines`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `.venv/bin/pytest -q` → PASS.
- [ ] **Step 5:** commit `feat: auditoria gravada em arquivo com último uso por agente`.

### Task 3: grafo (modelo: sonnet)

**Files:** Create `punk_records/graph.py`, `tests/test_graph.py`; Modify `punk_records/store.py` (+ `all_live`), `tests/test_store.py`.

**Interfaces — Produces:**
- `MemoryStore.all_live() -> tuple[list[dict], numpy.ndarray]` — registros no formato de `memory_to_dict` (sem `score`, sem `context_neighbors`) e matriz `float32 (n, dim)` na mesma ordem. Fonte: `hot_tier.atoms` + `cold_tier.load_epoch(e)` de todas as épocas; **deduplica por id ficando com o `created_at` mais novo, depois** descarta `_deleted` e ids em `deleted_atom_ids`. Roda sob `db._internal_lock`.
- `graph.knn_edges(emb, k, min_sim) -> list[tuple[int, int, float]]` — cosseno sobre linhas normalizadas; `i < j`, sem duplicatas, peso arredondado a 3 casas. `# ponytail: O(N²); índice ANN acima de ~10 mil`.
- `graph.clusters(n, edges, min_sim=0.6, min_size=3) -> list[list[int]]` — componentes conexos só com arestas de peso ≥ `min_sim`, tamanho ≥ `min_size`, maiores primeiro.
- `graph.cluster_label(texts_in, texts_all) -> str` — 2–3 palavras (minúsculas, ≥ 3 letras, sem números, sem stopwords pt/en definidas no módulo) com maior razão frequência-no-grupo ÷ frequência-total; juntadas por `", "` com `" e "` antes da última (ex.: `"deploy, dokploy e traefik"`).
- `graph.build_graph(records, emb, *, visible=None, projects=None, types=None, k=5, min_sim=0.55) -> dict` — filtra registros por `visible` (frozenset de projetos ou `None` = tudo), `projects`, `types` **antes** do kNN; devolve `{"nodes": [{id, text[:160], project, agent_id, memory_type, created_at, updated_at, degree}], "edges": [{"source", "target", "sim"}], "clusters": [{"id", "label", "node_ids"}], "total": int}`.
- `graph.GraphCache` — `get(key) / put(key, value)`, guarda só o último resultado por chave; a chave é montada em T5.

- [ ] **Step 1: testes** com embeddings sintéticos (sem modelo): `test_knn_edges_symmetric_and_threshold`, `test_clusters_components_min_size`, `test_cluster_label_picks_distinctive_words` (`["deploy no dokploy", "dokploy com traefik", "deploy dokploy ok"]` vs total com textos de banco → rótulo contém `dokploy`), `test_build_graph_visible_filters_before_knn` (nó invisível não aparece nem como alvo de aresta), `test_build_graph_small_inputs` (0 e 1 registro). Em `tests/test_store.py`: `test_all_live_skips_old_versions_of_deleted` (grava, `flush`, soft delete → ausente; grava outra, `flush`, hard delete → ausente) e `test_all_live_matrix_aligned`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `.venv/bin/pytest -q` → PASS.
- [ ] **Step 5:** commit `feat: grafo de memórias por similaridade com grupos de assunto`.

**🔍 Revisão P1** — PR "Painel: base do backend".

---

## P2 — API do painel

### Task 4: sessão, montagem e estáticos (modelo: opus)

**Files:** Create `punk_records/admin.py`, `tests/test_admin.py`; Modify `punk_records/server.py`.

**Interfaces — Consumes:** `ConfigStore`, `ActivityLog` (T2). **Produces:**
- `admin.Sessions(ttl=12*3600, now=time.time)` — `create(agent_id) -> str`, `get(sid) -> str | None` (expiradas somem), `drop(sid)`.
- `admin.routes(settings, config_store, store, activity, web_dir) -> list[BaseRoute]`, contendo `POST /admin/api/login`, `POST /admin/api/logout`, `GET /admin/api/me` e o restante de T5; estáticos de `web_dir` em `/admin/assets/...` e **fallback**: qualquer `GET /admin` ou `/admin/{path}` que não seja arquivo existente nem `/admin/api/...` devolve `web_dir/index.html` (se `web_dir` não existir, 404 com `{"error":"not_found","detail":"painel não foi buildado"}`).
- `admin.require_admin(request) -> Agent` — lê o cookie, valida a sessão, **reconsulta o `ConfigStore`** (agente existe, ativo, `global`); senão `401 {"error":"unauthorized"}`. Mutações sem `Content-Type: application/json` → `invalid`.
- `server.BearerAuth`: caminhos que começam com `/admin` passam sem Bearer.
- `server.build_app(settings, config_store, store, activity=None, web_dir=None)`: insere `admin.routes(...)` **antes** das rotas do MCP. `web_dir` padrão = `os.environ.get("PR_WEB_DIR", "/app/web")`.

- [ ] **Step 1: testes** (Starlette `TestClient`, `FakeConfig` como em `tests/test_server.py`, `web_dir` = pasta temporária com `index.html` e `assets/app.js`):
  - `test_login_global_ok_sets_cookie_flags` (cookie `pr_session` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`).
  - `test_login_agent_role_rejected` (401 + `detail` exato da Global Constraints), `test_login_disabled_rejected`.
  - `test_api_without_session_401` (todas as rotas GET de T4/T5 que existirem).
  - `test_bearer_header_does_not_open_admin` (`Authorization: Bearer <token global>` sem cookie → 401).
  - `test_mcp_still_requires_bearer` (`POST /mcp` sem token → 401).
  - `test_session_dies_when_agent_revoked` (login, depois `disabled` no config → `/me` dá 401).
  - `test_session_expires` (`now` injetado).
  - `test_mutation_requires_json` (`POST /admin/api/logout` com `text/plain` → `invalid`).
  - `test_spa_fallback_serves_index` (`GET /admin/agentes` → conteúdo do `index.html`; `GET /admin/assets/app.js` → o arquivo).
  - `test_insecure_cookie_env` (`PR_ADMIN_INSECURE_COOKIE=1` → sem `Secure`).
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `.venv/bin/pytest -q` → PASS (inclui suíte de isolamento intacta).
- [ ] **Step 5:** commit `feat: sessão do painel com login por token global`.

### Task 5: rotas de dados e de agentes (modelo: sonnet)

**Files:** Modify `punk_records/admin.py`, `tests/test_admin.py`.

**Interfaces — Consumes:** T1, T2, T3, T4, `authz.visible_projects/build_filter/check_readable/strip_reserved`, `MemoryStore.query/get/update/delete/find`. **Produces:** as rotas da spec §7, com:
- `as=<agent_id>` resolve o agente pelo `ConfigStore` (inexistente → `not_found`); escopo = `authz.visible_projects(agente)`.
- `GET /graph`: `all_live()` via `run()` com o `STORE_LIMITER` de `server.py`; `build_graph` via `anyio.to_thread.run_sync` **sem** limiter; chave do cache = `(n, max(updated_at), k, min_sim, escopo, projects, types)`. `k` em `[1, 10]`, `min_sim` em `[0.3, 0.95]`.
- `GET /search`: `store.query(q, k, filters=build_filter(agente_as or admin, None, None))` → `[{id, score}]`; `q` vazio → `invalid`.
- `GET /memories/{id}?as=`: com `as`, aplica `check_readable` (invisível → `not_found`); inclui `similar` (até 5, do grafo em cache ou de um kNN só daquela linha).
- `PATCH /memories/{id}` e `DELETE /memories/{id}?hard=`: recusam `as` (`invalid`); reaproveitam o mesmo fluxo do MCP (update com texto explícito e `strip_reserved`; hard usa `store.find`).
- `GET /agents`: inclui `last_used_at` de `activity.last_used` e `memory_count` por `agent_id` de `all_live`.
- Mutações de agente usam T1 e auditam com `tool` = `admin.agent.create|update|token|delete`, sem token.
- Regra de auto-trancamento da Global Constraints.

- [ ] **Step 1: testes** (store real da fixture): `test_graph_as_agent_hides_other_project` (cenário A/X, B/Y: `as=B` não traz nó de X), `test_graph_params_clamped`, `test_search_as_agent_scoped`, `test_memory_detail_as_invisible_not_found`, `test_patch_delete_reject_as`, `test_create_agent_returns_token_once` (GET seguinte não contém token nem hash), `test_create_duplicate_invalid`, `test_cannot_lock_self_out` (revogar, excluir, rebaixar e gerar token do próprio → `forbidden`), `test_rotate_old_token_stops_working` (MCP com token antigo → 401), `test_activity_lists_recent`, `test_admin_mutation_audited_without_token`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `.venv/bin/pytest -q` → PASS.
- [ ] **Step 5:** commit `feat: API do painel para grafo, busca, memórias, agentes e atividade`.

**🔍 Revisão P2** — PR "Painel: API", T4 revisada por opus (sessão e isolamento).

---

## P3 — Frontend

Regras para T6–T8: seguir os mockups da spec (estrutura e tokens); CSS próprio em variáveis; sem biblioteca de componentes; textos em pt-BR, botões dizem a ação. Rodar contra o backend local: `PR_ADMIN_INSECURE_COOKIE=1 PR_WEB_DIR=web/dist .venv/bin/punk-records serve` e `npm run dev` com proxy de `/admin/api` → `http://localhost:8000`.

### Task 6: base, login e layout (modelo: sonnet)

**Files:** Create `web/package.json`, `web/package-lock.json`, `web/vite.config.ts` (`base: "/admin/"`, proxy dev), `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/styles.css` (tokens §9 + `@fontsource/ibm-plex-sans` 400/500/600), `web/src/api.ts`, `web/src/api.test.ts`, `web/src/Layout.tsx` (barra lateral + barra superior), `web/src/pages/Login.tsx`; Modify `.gitignore` (`web/node_modules/`, `web/dist/`).

**Interfaces — Produces:**
- `api.ts`: `request<T>(path: string, init?: RequestInit): Promise<T>` — prefixa `/admin/api`, `credentials: "same-origin"`, JSON; em 401 chama `onUnauthorized()` (padrão: `location.assign("/admin/login")`) e rejeita; em `{error, detail}` rejeita com `ApiError(error, detail)`. Tipos TS espelhando a spec §7 (`GraphResponse`, `MemoryDetail`, `AgentRow`, `ActivityRow`, `Me`).
- Rotas (`createBrowserRouter`, `basename: "/admin"`): `/login`, `/` (Cérebro, T7), `/agentes` (T8), `/atividade` (T8). Rotas internas exigem `/me` ok, senão vão para `/login`.
- Abaixo de 768 px a barra lateral vira um menu no topo e o painel de detalhe vira tela cheia; Agentes e Atividade precisam funcionar a 375 px (o grafo pode mostrar "Abra em uma tela maior para ver o grafo").
- `Layout` recebe contadores de `/me`+`/projects`+`/agents` (Cérebro, Agentes, Atividade "hoje N") e lista de projetos com cor fixa por índice da paleta §9.
- Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`).

- [ ] **Step 1:** `web/src/api.test.ts`: `401 chama onUnauthorized e rejeita`, `erro JSON vira ApiError com detail`.
- [ ] **Step 2:** `cd web && npm install && npm test` → FAIL. **Step 3:** implementar. **Step 4:** `npm test && npm run build` → PASS.
- [ ] **Step 5:** commit `feat: base do painel React com login e layout`.

### Task 7: Cérebro (modelo: sonnet)

**Files:** Create `web/src/pages/Brain.tsx`, `web/src/components/Graph.tsx`, `web/src/components/MemoryPanel.tsx`; Modify `web/src/Layout.tsx` (busca e "Ver como" na barra superior).

- Grafo `react-force-graph-2d`: cor do nó = projeto, raio ∝ `sqrt(degree+1)`; nomes dos grupos desenhados no centro de massa de cada grupo (texto `#8f96a3`, 11 px); clique abre `MemoryPanel`; zoom +, −, centralizar.
- Busca (`/` foca): chama `/search`, destaca os ids e esmaece o resto (opacidade 0,2); `Esc` limpa.
- "Ver como": select com agentes; muda `as` em `/graph` e `/search`; com `as`, o painel mostra a faixa "Vendo como {id}" e esconde Editar/Apagar.
- `MemoryPanel`: texto, tabela Projeto/Autor/Tipo/Criada/Editada (datas `17 nov, 09:12`), parecidas com porcentagem, Editar (textarea + Salvar) e Apagar (confirmação inline "Apagar esta memória?" com Apagar/Cancelar).
- Barra de status: memórias, ligações, controle de similaridade (0,30–0,95, debounce 300 ms), "Atualizado há N s".
- Estados: carregando (esqueleto simples), vazio ("Nenhuma memória ainda. Quando os agentes gravarem, elas aparecem aqui."), erro com o `detail`.

- [ ] **Step 1:** `npm run build` passa; **Step 2:** rodar contra o backend local com algumas memórias gravadas pelo MCP e conferir: busca destaca, "ver como" esconde projeto alheio, editar e apagar refletem no grafo. Registrar no relatório o que foi conferido.
- [ ] **Step 3:** commit `feat: tela Cérebro com grafo, busca, ver como e detalhe`.

### Task 8: Agentes e Atividade (modelo: sonnet)

**Files:** Create `web/src/pages/Agents.tsx`, `web/src/components/AgentPanel.tsx`, `web/src/components/CreateAgent.tsx`, `web/src/components/TokenOnce.tsx`, `web/src/pages/Activity.tsx`.

- Seguir `mockups/painel-agentes.html`: tabela (Agente, Papel, Projetos, Último uso relativo, Status Ativo/Revogado/Sem uso), filtro, "Criar agente".
- `AgentPanel`: memórias gravadas, último uso, quadro "O que este agente pode fazer" (por projeto: Ler tudo/não; Editar as próprias/projeto/tudo conforme papel — regras do ADR-0003), ações: Ver o cérebro como este agente (navega para `/?as=id`), Editar papel e projetos, Gerar novo token, Revogar/Reativar, Excluir (confirmação inline). Ações proibidas para o agente da sessão ficam desabilitadas com dica.
- `CreateAgent`: nome (validação `ID_RE` no cliente também), papel em seletor de três opções com explicação de uma linha, projetos com caixas + "Novo projeto".
- `TokenOnce`: token com Copiar, comando `claude mcp add --transport http punk-records https://{location.host}/mcp --header "Authorization: Bearer {token}"`, botão "Já copiei" que fecha e esquece o token.
- `Activity`: tabela com Hora, Agente, Ação, Projetos, Resultados, Resultado; filtro por agente; atualiza a cada 10 s.

- [ ] **Step 1:** `npm run build` passa; **Step 2:** conferir contra o backend local: criar, ver token uma vez, gerar novo token, revogar, reativar, excluir; tentar revogar o próprio agente (bloqueado). Registrar no relatório.
- [ ] **Step 3:** commit `feat: telas Agentes e Atividade`.

**🔍 Revisão P3** — PR "Painel: frontend". Antes do PR, o usuário abre o painel local e compara com os mockups.

---

## P4 — Integração

### Task 9: Docker e documentação (modelo: haiku)

**Files:** Modify `Dockerfile`, `README.md`, `docs/PRD.md`, `docs/TRD.md`; Create `docs/adr/0006-painel-react-no-mesmo-processo.md`.

- `Dockerfile`: estágio `FROM node:22-alpine AS web` com `WORKDIR /web`, `COPY web/package*.json ./`, `npm ci`, `COPY web/ ./`, `npm run build`; no estágio final `COPY --from=web /web/dist /app/web` e `ENV PR_WEB_DIR=/app/web`. Resto inalterado.
- `.dockerignore`: manter `web/node_modules` e `web/dist` fora do contexto.
- README: seção "Painel" (endereço `https://<domínio>/admin`, login com token global, o que cada tela faz).
- PRD: painel sai dos não-objetivos; RF-12 (painel: grafo, busca, ver como) e RF-13 (gestão de agentes e atividade). TRD: rotas `/admin`, auditoria em arquivo, Dockerfile multi-estágio. ADR-0006: Contexto/Decisão/Consequências/Alternativas (página estática vs React; mesmo processo por causa do ADR-0005; login por token global).

- [ ] **Step 1:** `cd web && npm run build && cd .. && PR_ADMIN_INSECURE_COOKIE=1 PR_WEB_DIR=web/dist .venv/bin/punk-records serve` e `curl -s localhost:8000/admin/agentes | head -c 200` → HTML do `index.html`.
- [ ] **Step 2:** `.venv/bin/pytest -q` → PASS.
- [ ] **Step 3:** commit `chore: painel no build do Docker e documentação`.

**🔍 Revisão final** — branch inteira por **opus**: isolamento (nenhuma rota do painel com token não-global, "ver como" nunca mostra mais que o MCP), cobertura da spec §§2–11.
