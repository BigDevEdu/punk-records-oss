# Punk-Records — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIO: superpowers:subagent-driven-development, tarefa por tarefa, usando o **modelo indicado em cada tarefa**. Passos em checkbox (`- [ ]`). Mensagens de commit em pt-BR, **sem** `Co-Authored-By` nem assinatura do Claude.

**Objetivo:** servidor MCP self-hosted (Streamable HTTP) sobre um único EpochDB, com token por agente e isolamento lógico por projeto (`agent` / `project_admin` / `global`).

**Arquitetura:** um processo Python (FastMCP) com middleware ASGI de bearer token, camada de autorização pura (`authz.py`) que gera filtros e sanitiza metadata, e um wrapper (`store.py`) que é o único dono do `storage_dir` (flock). Caddy termina TLS.

**Stack:** Python 3.12, `mcp` (FastMCP), `epochdb` fixado em commit, `pyyaml`, `pytest`, `anyio`. Docker Compose + Caddy.

**Spec:** `docs/PRD.md`, `docs/TRD.md`, `docs/adr/0001…0005`. O executor lê o TRD §4–§7 e §10 antes de cada tarefa.

## Global Constraints

- EpochDB fixado: `epochdb @ git+https://github.com/jersobh/epochdb@ad1373042f0ac9c2ac72e21683b5b75489616f58`.
- Python `>=3.12`; dependências de runtime: só `mcp>=2.3,<3`, `epochdb[embeddings]`, `pyyaml`, `uvicorn` (+ o que elas puxam).
- Uma instância `EpochDB(storage_dir=…, embedding_model=…, dim=…)` sem `tenant`/`namespace`; 1 processo, 1 worker.
- Embedding padrão `paraphrase-multilingual-MiniLM-L12-v2`, `dim=384`. Testes usam `PR_TEST_EMBEDDING_MODEL` (padrão `all-MiniLM-L6-v2`, menor; isolamento não depende de idioma).
- Projeto reservado `_shared`; chaves reservadas `agent_id`, `project`, `created_by_role` e qualquer chave iniciada por `_`.
- Operadores de filtro aceitos do cliente: `$eq $ne $in $nin $gt $gte $lt $lte`.
- Tools com prefixo `memory_`; erro sempre `{"error": "forbidden|invalid|not_found", "detail": str}`.
- Tokens: prefixo `pr_`, `secrets.token_urlsafe(32)`, guardados só como SHA-256 hex.
- Log de auditoria nunca contém texto de memória nem de query.

## Review Focus

1. **Projeto removido do token com o servidor rodando** → na próxima chamada (reload por mtime) o agente já não vê as memórias desse projeto. Teste em T1 (reload) + T6 (#14).
2. **`agents.yaml` editado com erro ao vivo** → servidor mantém a config anterior e loga erro, não derruba. Teste em T1.
3. **Segundo processo abrindo o mesmo storage** → aborta com mensagem clara contendo o caminho do lock. Teste em T4.
4. **Escritas concorrentes de vários agentes** → nenhuma perdida. Teste em T4 (20 threads).
5. **Entrada degenerada** (`text` vazio/só espaços, `k` ≤ 0 ou > `PR_MAX_K`) → `invalid` para texto vazio; `k` limitado a `[1, PR_MAX_K]`. Teste em T5.

---

## Etapas de entrega e modelos

Cada etapa termina num ponto revisável (branch/PR próprio). Revisor por tarefa: **sonnet**; revisão final da branch: **opus**.

| Etapa | Tarefas | Entrega revisável | Modelo implementador |
|---|---|---|---|
| E1 — Fundação | T1 config · T2 CLI de tokens | `punk-records token new` gera token e `agents.yaml` válido | T1 sonnet · T2 haiku |
| E2 — Núcleo de segurança | T3 authz | funções puras de autorização 100% testadas | **opus** (código crítico de segurança) |
| E3 — Servidor | T4 store · T5 server MCP · T6 suíte de isolamento | servidor sobe local, tools respondem, isolamento comprovado | T4 sonnet · T5 sonnet · T6 **opus** |
| E4 — Deploy | T7 Docker/Compose/Caddy/README | `docker compose up -d` + cliente MCP conecta | haiku |

Por que essa divisão: haiku para tarefas mecânicas com contrato fechado (CLI, Docker); sonnet para código de integração; opus só onde um erro vira vazamento (authz e testes de isolamento) e na revisão final.

---

## Estrutura de arquivos

```
pyproject.toml               # T1 (pacote punk_records, script `punk-records`)
punk_records/__init__.py     # T1
punk_records/config.py       # T1 — Settings (env), Agent, Config, load_config, ConfigStore, hash_token
punk_records/cli.py          # T2 — token new|list|revoke ; T5 adiciona `serve`
punk_records/authz.py        # T3 — regras puras
punk_records/store.py        # T4 — dono do EpochDB (flock, serialização)
punk_records/server.py       # T5 — FastMCP, middleware bearer, tools, auditoria, /healthz
tests/test_config.py  tests/test_cli.py  tests/test_authz.py
tests/test_store.py   tests/test_server.py  tests/test_isolation.py
Dockerfile  compose.yaml  Caddyfile  config/agents.example.yaml  README.md   # T7
```

---

## E1 — Fundação

### Task 1: Projeto + configuração (modelo: sonnet)

**Files:** Create `pyproject.toml`, `punk_records/__init__.py`, `punk_records/config.py`, `tests/test_config.py`, `.gitignore` (inclui `.idea/`, `.venv/`, `data/`, `config/agents.yaml`).

**Interfaces — Produces:**
- `hash_token(token: str) -> str` (sha256 hex).
- `@dataclass(frozen=True) Agent(id: str, role: str, projects: tuple[str, ...], token_sha256: str, disabled: bool = False)`; `role ∈ {"agent","project_admin","global"}`.
- `@dataclass(frozen=True) Config(projects: frozenset[str], agents_by_hash: dict[str, Agent])`.
- `class ConfigError(Exception)`.
- `load_config(path: str) -> Config` — valida: ids únicos, papel válido, projetos do agente ⊂ `projects`, `_shared` não listado em `projects`.
- `class ConfigStore(path)`: `.get() -> Config` recarrega se mtime mudou; em `ConfigError` no reload mantém a anterior e loga `logging.error`; no construtor propaga o erro.
- `@dataclass(frozen=True) Settings(storage_dir="/data", agents_file="/config/agents.yaml", embedding_model="paraphrase-multilingual-MiniLM-L12-v2", embedding_dim=384, host="0.0.0.0", port=8000, max_k=50)`; `settings_from_env() -> Settings` lendo `PR_STORAGE_DIR, PR_AGENTS_FILE, PR_EMBEDDING_MODEL, PR_EMBEDDING_DIM, PR_HOST, PR_PORT, PR_MAX_K`.

- [ ] **Step 1: testes que falham** em `tests/test_config.py`:
  - `test_load_valid` — yaml com 2 agentes → `Config.agents_by_hash[hash_token("pr_x")].id == "a1"`.
  - `test_unknown_project_rejected`, `test_duplicate_id_rejected`, `test_bad_role_rejected`, `test_shared_in_projects_rejected` → `ConfigError`.
  - `test_reload_on_mtime` — reescreve arquivo removendo projeto do agente (`os.utime` para mtime novo) → `.get()` reflete.
  - `test_reload_keeps_previous_on_error` — reescreve com yaml inválido → `.get()` devolve config anterior.
  - `test_settings_from_env` — `monkeypatch.setenv("PR_MAX_K","10")` → `settings_from_env().max_k == 10`.
- [ ] **Step 2:** `pytest tests/test_config.py -v` → FAIL (import).
- [ ] **Step 3:** criar `pyproject.toml` (deps da Global Constraints, extra `dev = ["pytest"]`, script `punk-records = "punk_records.cli:main"`) e implementar `config.py`.
- [ ] **Step 4:** `pip install -e '.[dev]' && pytest tests/test_config.py -v` → PASS.
- [ ] **Step 5:** commit `feat: configuração e carregamento de agents.yaml`.

### Task 2: CLI de tokens (modelo: haiku)

**Files:** Create `punk_records/cli.py`, `tests/test_cli.py`.

**Interfaces — Consumes:** `hash_token`, `load_config` (T1). **Produces:** `main(argv: list[str] | None = None) -> int` com `argparse`, subcomandos:
- `token new <agent_id> --role R --projects a,b [--file PATH]` → imprime o token (`pr_` + `secrets.token_urlsafe(32)`) **uma vez** no stdout; grava agente com `token_sha256`; se o id já existe, substitui o hash (rotação). Projetos novos são adicionados à lista `projects`.
- `token list [--file]` → uma linha por agente `id role projects disabled` (nunca hash).
- `token revoke <agent_id> [--file]` → `disabled: true`.
- `--file` padrão = `settings_from_env().agents_file`. Arquivo inexistente em `new` → cria `{projects: [], agents: []}`. Após gravar, valida com `load_config` (erro → retorna 1 sem gravar).

- [ ] **Step 1: testes** (`tmp_path`): `test_new_creates_file_and_token` (token começa com `pr_`, `load_config` acha o agente pelo hash), `test_new_rotates_existing`, `test_list_hides_hash`, `test_revoke_disables`, `test_invalid_role_returns_1`.
- [ ] **Step 2:** `pytest tests/test_cli.py -v` → FAIL.
- [ ] **Step 3:** implementar `cli.py`.
- [ ] **Step 4:** `pytest -v` → PASS.
- [ ] **Step 5:** commit `feat: CLI para emitir, listar e revogar tokens`.

**🔍 Revisão E1** — PR "Fundação". Checar: nenhum token em claro em disco/log; `.gitignore` cobre `config/agents.yaml`.

---

## E2 — Núcleo de segurança

### Task 3: Autorização (modelo: opus)

**Files:** Create `punk_records/authz.py`, `tests/test_authz.py`.

**Interfaces — Consumes:** `Agent` (T1). **Produces** (todas puras, sem I/O):
- `SHARED = "_shared"`, `RESERVED = frozenset({"agent_id","project","created_by_role"})`, `ALLOWED_OPS` (Global Constraints).
- Exceções `Forbidden(Exception)`, `Invalid(Exception)`, `NotFound(Exception)`.
- `visible_projects(a: Agent) -> frozenset[str] | None` (None = global).
- `resolve_write_project(a: Agent, project: str | None, known: frozenset[str]) -> str` — global pode qualquer projeto de `known ∪ {_shared}`; projeto desconhecido → `Invalid`.
- `validate_client_filters(f: dict | None) -> dict` — rejeita (`Invalid`) chave em `RESERVED`, chave iniciada por `_`, operador `$…` fora de `ALLOWED_OPS`, valor dict com chave não-operador.
- `build_filter(a, project: str | None, client_filters: dict | None) -> dict` — conforme TRD §6.
- `can_modify(a, meta: dict) -> bool` — TRD §6.
- `sanitize_metadata(a, project: str, meta: dict | None) -> dict` — TRD §6.
- `postfilter(a, results: list[dict]) -> tuple[list[dict], int]` — remove resultados com `project` fora do visível e, em cada resultado, vizinhos em `metadata["context_neighbors"]` cujo `metadata.project` não é visível; retorna `(filtrados, n_violações)` (vizinho removido **não** conta como violação; resultado removido conta).
- `require_global(a) -> None` — `Forbidden` se não global.
- `check_readable(a, meta: dict) -> None` — `NotFound` se `meta.project` não visível (não revela existência).

- [ ] **Step 1: testes** — uma função por regra da matriz do TRD §6, incluindo:
  - `test_agent_filter_is_in_projects_plus_shared` → `{"project": {"$in": ["_shared","p1"]}}` (ordenado).
  - `test_global_filter_has_no_project_key`.
  - `test_project_outside_list_forbidden`.
  - `test_client_filter_reserved_key_invalid` (`project`, `agent_id`, `_deleted`), `test_unknown_operator_invalid` (`{"x": {"$regex": "a"}}`).
  - `test_sanitize_strips_and_stamps` — `{"project":"Y","agent_id":"B","_deleted":True,"tag":"k"}` → `{"tag":"k","agent_id":"A","project":"p1","created_by_role":"agent"}`.
  - `test_can_modify_matrix` (agent próprio/alheio, project_admin no projeto/fora, global).
  - `test_postfilter_drops_foreign_result_and_counts`, `test_postfilter_drops_foreign_neighbors`.
  - `test_write_single_project_default`, `test_write_multi_project_requires_project`, `test_write_shared_allowed`, `test_global_write_unknown_project_invalid`.
  - `test_check_readable_foreign_is_not_found`.
- [ ] **Step 2:** `pytest tests/test_authz.py -v` → FAIL.
- [ ] **Step 3:** implementar `authz.py` (o pseudo-código do TRD §6 é a referência).
- [ ] **Step 4:** `pytest -v` → PASS.
- [ ] **Step 5:** commit `feat: camada de autorização por agente e projeto`.

**🔍 Revisão E2** — PR "Autorização" revisado por **opus**. Foco: todo caminho de leitura passa por `build_filter` + `postfilter`; nada aceita `project`/`agent_id` do cliente.

---

## E3 — Servidor

### Task 4: Store dono do EpochDB (modelo: sonnet)

**Files:** Create `punk_records/store.py`, `tests/test_store.py`, `tests/conftest.py`.

**Interfaces — Consumes:** `Settings` (T1). **Produces:**
- `class StorageLocked(Exception)`.
- `class MemoryStore(settings: Settings)`: no `__init__` cria `storage_dir`, faz `fcntl.flock(LOCK_EX|LOCK_NB)` em `<storage_dir>/.punk-records.lock` (falha → `StorageLocked(f"storage em uso: {lock_path}")`), abre `EpochDB(storage_dir=…, embedding_model=…, dim=…)`.
- Métodos síncronos (o servidor chama via `anyio.to_thread.run_sync`), todos retornando dicts serializáveis:
  - `remember(text, metadata, memory_type) -> str`
  - `query(text, k, filters, min_score, memory_type, context_window) -> list[dict]`
  - `multi_hop(text, hops, k, filters, context_window) -> list[dict]`
  - `adaptive_query(text, k) -> list[dict]`
  - `get(id) -> dict | None`
  - `update(id, text, metadata) -> None` — **contorno do Q3a:** lê `get(id)` e chama `EpochDB.update(id, text=text if text is not None else atual.text, metadata=metadata)` para nunca reescrever sobre versão antiga.
  - `delete(id, hard) -> None`, `entity_graph(entity, depth) -> dict`, `timeline(entity, start, end) -> list[dict]`, `sql(query) -> list[dict]`, `compact() -> None`, `close() -> None` (fecha EpochDB e libera o lock).
- `memory_to_dict(m) -> dict` com chaves `id, text, score, project, agent_id, memory_type, created_at, metadata` (`project`/`agent_id` lidos de `m.metadata`).
- `conftest.py`: fixture `store(tmp_path)` com `Settings(storage_dir=str(tmp_path), embedding_model=os.getenv("PR_TEST_EMBEDDING_MODEL","all-MiniLM-L6-v2"), embedding_dim=384)`, fecha no teardown. Fixture com `scope="session"` para o modelo carregar uma vez se possível.

- [ ] **Step 1: testes:** `test_remember_then_get_roundtrip` (metadata preservada), `test_query_respects_filters` (2 memórias com `project` diferentes; filtro `{"project":"a"}` só traz `a`), `test_second_store_same_dir_raises` (`StorageLocked`, mensagem contém `.punk-records.lock`), `test_concurrent_writes` (20 threads `remember` → 20 `get` não-None), `test_soft_delete_hides_from_get`, `test_update_keeps_text_when_only_metadata`.
- [ ] **Step 2:** `pytest tests/test_store.py -v` → FAIL.
- [ ] **Step 3:** implementar `store.py`.
- [ ] **Step 4:** `pytest -v` → PASS.
- [ ] **Step 5:** commit `feat: store único dono do EpochDB com lock de arquivo`.

### Task 5: Servidor MCP (modelo: sonnet)

**Files:** Create `punk_records/server.py`, `tests/test_server.py`; Modify `punk_records/cli.py` (subcomando `serve`).

**Interfaces — Consumes:** T1, T3, T4. **Produces:**
- `current_agent: contextvars.ContextVar[Agent]`.
- `class BearerAuth` — middleware **ASGI puro** (não `BaseHTTPMiddleware`, que quebra streaming): `/healthz` passa; demais exigem `Authorization: Bearer <t>`; `config_store.get().agents_by_hash.get(hash_token(t))` ausente ou `disabled` → 401 JSON `{"error":"unauthorized"}`; senão seta `current_agent`.
- `build_app(settings, config_store, store) -> ASGIApp` — `FastMCP("punk-records", stateless_http=True)`, tools registradas, `mcp.streamable_http_app()` envolvido em `BearerAuth`, rota `GET /healthz` → `{"ok": true}`.
- Tools (assinaturas e regras = TRD §6 matriz + §7): `memory_whoami, memory_remember, memory_query, memory_multi_hop, memory_adaptive_query, memory_update, memory_delete, memory_entity_graph, memory_timeline, memory_sql, memory_compact` (`compact` só global; `store.compact()` repassa a `EpochDB.compact()`). Cada tool: pega `current_agent`, aplica `authz`, chama `store` via `anyio.to_thread.run_sync`, aplica `postfilter` em toda lista, converte `Forbidden/Invalid/NotFound` no dict de erro, grava auditoria.
- `memory_update`/`memory_delete`: `store.get(id)` → `None` → `not_found`; `check_readable` → `can_modify` (falso → `forbidden`). `hard=True` exige global.
- `k` limitado a `[1, settings.max_k]`; `text`/`query` vazio após `strip()` → `invalid`.
- Auditoria: logger `punk_records.audit`, uma linha `json.dumps({ts, agent_id, role, tool, projects, ids, n_results, latency_ms, outcome})`. `postfilter` com violações > 0 → `logging.critical("isolation_violation …")`.
- Descrições das tools orientam o agente (TRD §7, último parágrafo).
- `punk-records serve` → `uvicorn.run(build_app(...), host, port, workers=1)`; `StorageLocked` → mensagem e exit 1.

- [ ] **Step 1: testes** (chamando as funções das tools diretamente com `current_agent.set(...)`, e `starlette.testclient.TestClient` para HTTP):
  - `test_healthz_no_auth` → 200; `test_missing_token_401`; `test_disabled_token_401`.
  - `test_remember_stamps_agent_and_project`; `test_whoami`.
  - `test_empty_text_invalid`; `test_k_clamped` (k=1000 → no máx `max_k` resultados; k=0 → tratado como 1).
  - `test_global_only_tools_forbidden_for_agent` (adaptive, entity_graph, timeline, sql).
  - `test_audit_line_has_no_text` (caplog: texto gravado não aparece no log).
- [ ] **Step 2:** `pytest tests/test_server.py -v` → FAIL.
- [ ] **Step 3:** implementar `server.py` e `serve`.
- [ ] **Step 4:** `pytest -v` → PASS.
- [ ] **Step 5:** smoke manual: `PR_STORAGE_DIR=./data PR_AGENTS_FILE=./config/agents.yaml punk-records serve` e, em outro terminal, `claude mcp add --transport http punk http://localhost:8000/mcp --header "Authorization: Bearer <token>"` → `memory_whoami` responde.
- [ ] **Step 6:** commit `feat: servidor MCP HTTP com auth por token e auditoria`.

### Task 6: Suíte de isolamento (modelo: opus)

**Files:** Create `tests/test_isolation.py`.

**Interfaces — Consumes:** tools de T5, fixtures de T4. Cenário fixo: projetos `X`, `Y`; agentes `A`(agent, X), `C`(agent, X), `B`(agent, Y), `PX`(project_admin, X), `G`(global).

- [ ] **Step 1: escrever os testes 1–13 do TRD §10** literalmente, mais:
  - `test_14_project_removed_from_token_live` — A grava em X; reescreve `agents.yaml` tirando X de A; próxima `memory_query` de A não traz a memória.
  - `test_15_foreign_id_update_is_not_found` — B tenta `memory_update` em id de X → `not_found` (não `forbidden`).
  - Para #8 (`context_window`): gravar em ordem X, Y, X com textos próximos; A consulta com `context_window=2` → nenhum vizinho com `project == "Y"`.
- [ ] **Step 2:** `pytest tests/test_isolation.py -v` → se algum falhar, **é bug de T3/T5**: corrigir lá (não afrouxar o teste) e registrar no commit.
- [ ] **Step 3:** `pytest -v` → tudo PASS.
- [ ] **Step 4:** commit `test: suíte de isolamento entre agentes e projetos`.

**🔍 Revisão E3** — PR "Servidor" revisado por **opus** com foco em vazamento: todo `return` de tool que contenha memórias passou por `postfilter`?

---

## E4 — Deploy

### Task 7: Docker, Compose, Caddy, README (modelo: haiku)

**Files:** Create `Dockerfile`, `compose.yaml`, `Caddyfile`, `config/agents.example.yaml`, `README.md`.

- `Dockerfile`: `python:3.12-slim`, `pip install .`, pré-baixa o modelo no build (`python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"`), usuário não-root, `CMD ["punk-records","serve"]`, `HEALTHCHECK` em `/healthz`.
- `compose.yaml`: `app` (sem `ports`, volumes `data:/data`, `./config:/config:ro`, `restart: unless-stopped`) e `caddy:2` (`80`,`443`, `./Caddyfile`, volume `caddy_data`). Domínio via `PR_DOMAIN`.
- `Caddyfile`: `{$PR_DOMAIN} { reverse_proxy app:8000 }`.
- `README.md` (pt-BR, curto): subir, emitir token (`docker compose run --rm app punk-records token new …` — escreve em `./config`, então esse comando monta `./config` sem `:ro`), conectar Claude Code (`claude mcp add --transport http …`), conectar n8n (MCP Client node com header), backup/restore (TRD §9).

- [ ] **Step 1:** escrever os arquivos.
- [ ] **Step 2:** `docker compose build` → sucesso; `PR_DOMAIN=localhost docker compose up -d` → `docker compose ps` mostra `app` healthy.
- [ ] **Step 3:** `curl -k https://localhost/healthz` → `{"ok": true}`; com token, `claude mcp add` + `memory_whoami` responde.
- [ ] **Step 4:** commit `chore: deploy com Docker Compose e Caddy`.

**🔍 Revisão final** — branch inteira por **opus**: cobertura do PRD (RF-01…RF-11) e do TRD §10.
