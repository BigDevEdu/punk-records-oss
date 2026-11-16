# TRD — Punk-Records: servidor MCP de memória unificada

- **Status:** rascunho v1
- **Data:** 2026-11-16
- **Docs relacionados:** [PRD](PRD.md) · [ADRs](adr/)

## 1. Escopo

Especificação técnica do servidor MCP que expõe o EpochDB a múltiplos agentes com isolamento por projeto. Requisitos de produto no [PRD](PRD.md); decisões e seus porquês nos ADRs.

## 2. Arquitetura

```
 Claude Code ─┐
 n8n ─────────┼─ HTTPS + Bearer ─▶ Caddy (TLS) ─▶ punk-records (1 processo, FastMCP Streamable HTTP /mcp)
 outros ──────┘                                        │
                                                        ├─ auth:     token → AgentPrincipal (agents.yaml)
                                                        ├─ authz:    build_filter / can_write / can_modify
                                                        ├─ tools:    wrappers finos sobre EpochDB
                                                        ├─ audit:    log JSON (stdout)
                                                        └─ EpochDB (1 instância, AsyncEpochDB)
                                                              └─ /data: WAL + Parquet + índices  (volume, flock)
```

- Linguagem: Python 3.12. Dependências: `mcp` (FastMCP), `epochdb==<pin>`, `pyyaml`. Nada mais sem motivo.
- Um processo, um worker, lock exclusivo no storage ([ADR-0005](adr/0005-processo-unico-dono-do-storage.md)).
- Banco único, isolamento lógico ([ADR-0002](adr/0002-banco-unico-isolamento-logico.md)).

## 3. Layout do repositório (proposta)

```
punk_records/
  server.py      # FastMCP app, tools, middleware de auth
  authz.py       # AgentPrincipal, build_filter, can_write, can_modify, sanitize_metadata
  config.py      # leitura de env + agents.yaml (reload por mtime)
  cli.py         # punk-records token new|list|revoke
tests/
  test_isolation.py
docs/ ...
Dockerfile, compose.yaml, Caddyfile, pyproject.toml
```

## 4. Modelo de dados

O EpochDB guarda `text` + `metadata` (dict) por átomo. Nosso contrato sobre `metadata`:

| Chave | Origem | Descrição |
|---|---|---|
| `agent_id` | servidor (token) | autor da memória |
| `project` | servidor (validado) | projeto da memória; `_shared` é reservado |
| `created_by_role` | servidor | papel do autor na escrita |
| `_*` | EpochDB | interno (ex.: `_deleted`); **nunca** aceito do cliente |
| demais | cliente | livres (ex.: `tags`, `source`, `triples`) |

`memory_type` do EpochDB é repassado como está.

## 5. Configuração

### `agents.yaml`

```yaml
projects: [punk-records, rest-db-receba, n8n-flows]   # projetos válidos (além de _shared)
agents:
  - id: claude-code-laptop
    role: agent                 # agent | project_admin | global
    projects: [punk-records, rest-db-receba]
    token_sha256: "9f2c…"
  - id: n8n-orchestrator
    role: global
    projects: []
    token_sha256: "a71b…"
    disabled: false
```

Validação no load: ids únicos, papéis válidos, projetos existentes em `projects`, `_shared` não listado (é implícito). Arquivo inválido → mantém config anterior e loga erro (no boot: aborta).

### Variáveis de ambiente

| Var | Padrão | Uso |
|---|---|---|
| `PR_STORAGE_DIR` | `/data` | storage do EpochDB |
| `PR_AGENTS_FILE` | `/config/agents.yaml` | tokens e papéis |
| `PR_EMBEDDING_MODEL` | `paraphrase-multilingual-MiniLM-L12-v2` | repassado ao EpochDB; multilíngue porque as memórias são em pt-BR (o padrão do EpochDB, `all-MiniLM-L6-v2`, é só inglês) |
| `PR_EMBEDDING_DIM` | `384` | `dim` do EpochDB |
| `PR_HOST` / `PR_PORT` | `0.0.0.0` / `8000` | bind interno |
| `PR_MAX_K` | `50` | teto de `k` por consulta |

**Atenção:** trocar o modelo de embedding depois de ter dados exige reindexação — escolher antes de produção.

## 6. Autorização

```python
SHARED = "_shared"
RESERVED = {"agent_id", "project", "created_by_role"}

def visible_projects(p):                  # None = sem restrição
    return None if p.role == "global" else set(p.projects) | {SHARED}

def resolve_write_project(p, project):
    if project is None:
        if p.role != "global" and len(p.projects) == 1: return p.projects[0]
        raise Forbidden("project obrigatório")
    if p.role == "global" or project in visible_projects(p): return project
    raise Forbidden(project)

def build_filter(p, project=None, client_filters=None):
    f = validate_client_filters(client_filters)        # rejeita RESERVED, chaves "_*", operadores fora da whitelist
    vis = visible_projects(p)
    if project is not None:
        if vis is not None and project not in vis: raise Forbidden(project)
        f["project"] = project
    elif vis is not None:
        f["project"] = {"$in": sorted(vis)}
    return f

def can_modify(p, atom_meta):
    if p.role == "global": return True
    if p.role == "project_admin" and atom_meta.get("project") in p.projects: return True
    return atom_meta.get("agent_id") == p.id

def sanitize_metadata(p, project, meta):
    meta = {k: v for k, v in (meta or {}).items() if k not in RESERVED and not k.startswith("_")}
    return meta | {"agent_id": p.id, "project": project, "created_by_role": p.role}
```

- Operadores aceitos do cliente: `$eq $ne $in $nin $gt $gte $lt $lte` (o `match_filters` do EpochDB trata operador desconhecido como igualdade com o dict inteiro — rejeitamos antes).
- **Pós-filtro defensivo:** depois de toda leitura, o servidor descarta qualquer resultado cujo `metadata.project` não esteja em `visible_projects` (cinto + suspensório) e loga `isolation_violation` se isso acontecer.
- **`context_window`:** os vizinhos em `metadata.context_neighbors` não passam pelo filtro do EpochDB. Eles são os átomos cronologicamente adjacentes do mesmo `namespace` — com banco único, isso significa **de qualquer projeto**. Cada vizinho é `{id, payload, created_at, memory_type, metadata}` com a `metadata` completa (verificado), então o servidor remove vizinhos cujo `metadata.project` não é visível. Consequência: para não-global a janela pode voltar com menos vizinhos que o pedido.

### Matriz de permissões

| Tool | agent | project_admin | global | Filtro / checagem |
|---|---|---|---|---|
| `whoami` | ✔ | ✔ | ✔ | — |
| `remember` | ✔ | ✔ | ✔ | `resolve_write_project` + `sanitize_metadata` |
| `query` | ✔ | ✔ | ✔ | `build_filter` + pós-filtro |
| `multi_hop` | ✔ | ✔ | ✔ | idem — `EpochDB.multi_hop(filters=)` repassa ao retriever (verificado) |
| `adaptive_query` | ✘ | ✘ | ✔ | **sem `filters`**: o `AdaptiveRouter` chama `query`/`multi_hop` sem filtro, `get_timeline` e `retriever.query_range` (verificado) |
| `update` | próprias | projeto | tudo | `EpochDB.get(id)` → `can_modify(metadata)`; `None` → `not_found` |
| `delete` (soft) | próprias | projeto | tudo | idem |
| `delete hard` / `compact` | ✘ | ✘ | ✔ | — |
| `entity_graph`, `get_timeline` | ✘ | ✘ | ✔ | sem filtro no EpochDB |
| `query_sql` | ✘ | ✘ | ✔ | sem filtro |
| skills, user profile, `hot_summary_snapshot` | ✘ | ✘ | ✔ | sem filtro (v1) |

## 7. Contrato das tools (MCP)

Nomes com prefixo `memory_`. Todas retornam JSON; erros como `{"error": "forbidden|invalid|not_found", "detail": …}`.

| Tool | Parâmetros | Retorno |
|---|---|---|
| `memory_whoami` | — | `{agent_id, role, projects, shared: "_shared"}` |
| `memory_remember` | `text`, `project?`, `metadata?`, `memory_type?` | `{id, project}` |
| `memory_query` | `query`, `project?`, `k=5 (≤PR_MAX_K)`, `min_score=0`, `memory_type?`, `filters?`, `context_window=0` | `[{id, text, score, project, agent_id, metadata, created_at}]` |
| `memory_multi_hop` | `query`, `project?`, `hops=2`, `k=5` | idem |
| `memory_adaptive_query` | `query`, `k=5` | idem (global) |
| `memory_update` | `id`, `text?`, `metadata?` | `{id}` (metadata sanitizada; `project`/`agent_id` imutáveis) |
| `memory_delete` | `id`, `hard=false` | `{id, deleted}` |
| `memory_entity_graph` | `entity`, `depth=2` | grafo (global) |
| `memory_timeline` | `entity?`, `start?`, `end?` | eventos (global) |
| `memory_sql` | `sql` | linhas (global, somente leitura) |

As descrições das tools devem orientar o agente: "grave decisões, convenções, erros resolvidos e preferências; use `_shared` para o que vale em qualquer projeto".

## 8. Deploy

- `Dockerfile`: `python:3.12-slim`, instala o pacote, baixa o modelo de embedding no build (evita download no boot), usuário não-root.
- `compose.yaml`: serviços `app` (sem porta publicada) e `caddy` (80/443), volumes `data:/data`, `./config:/config:ro`, `caddy_data`.
- `Caddyfile`: `memory.<seu-domínio> { reverse_proxy app:8000 }`.
- Healthcheck: `GET /healthz` (sem auth) → 200 quando o EpochDB carregou.

## 9. Backup / restore / observabilidade

- **Backup:** `docker compose stop app` → snapshot/tar do volume `data` → `start`. (Diário, via cron do host; retenção definida pelo operador.) Hot backup só após confirmar que o EpochDB tolera cópia com WAL aberto.
- **Restore:** parar, substituir volume, subir; WAL é reaplicado no boot.
- **Auditoria:** uma linha JSON por chamada no stdout: `ts, agent_id, role, tool, project(s), ids, n_results, latency_ms, outcome`. **Sem texto de memória nem query.**
- **Métricas mínimas:** latência p50/p95 por tool e contagem de `forbidden`/`isolation_violation` — derivadas do log.

## 10. Plano de testes

Gate de release e de upgrade do EpochDB. Usa EpochDB real em diretório temporário.

**Suíte de isolamento (`tests/test_isolation.py`):**
1. Agente A (projeto X) grava; agente B (projeto Y) consulta com o mesmo texto → 0 resultados de X.
2. B pede `project="X"` → `forbidden`.
3. A e C (ambos em X) → C vê memória de A.
4. Qualquer agente vê `_shared`.
5. `global` vê X e Y; `project_admin` de X vê X, não Y.
6. Cliente envia `metadata={"project": "Y", "agent_id": "B", "_deleted": true}` → gravado como A/X, sem `_deleted`.
7. Cliente envia `filters={"project": "Y"}` ou operador desconhecido → `invalid`.
8. `context_window>0` não traz vizinhos de outro projeto.
9. `multi_hop` não traz átomos de outro projeto; `adaptive_query` por `agent` → `forbidden`.
13. `update`/`delete` de id inexistente ou já apagado → `not_found` (sem revelar se existe em outro projeto: id de projeto não visível também → `not_found`).
10. A tenta `update`/`delete` de memória de C → `forbidden`; `project_admin` de X consegue.
11. Tools só-global chamadas por `agent` → `forbidden`.
12. Token revogado/ausente/inválido → 401.

**Outros:** carga simples (100k memórias sintéticas, p95 de `query`), crash test (kill -9 durante escrita → memória confirmada sobrevive).

## 11. Questões em aberto

| # | Questão | Como resolver | Bloqueia |
|---|---|---|---|
| Q1 | ~~`multi_hop` e `adaptive_query` repassam `filters`?~~ **Resolvida** (commit `ad13730`): `multi_hop` sim; `adaptive_query` não → só `global`. Liberar a não-global exigiria reimplementar o roteamento chamando nossas tools filtradas. | — | — |
| Q2 | ~~`context_neighbors` expõe `metadata.project`?~~ **Resolvida**: sim, metadata completa por vizinho → pós-filtro no servidor. | — | — |
| Q3 | ~~Há leitura por id?~~ **Resolvida**: `EpochDB.get(memory_id) -> Memory \| None` (hot tier, depois versão mais nova no cold; `None` se apagada). | — | — |
| Q3a | **Bug upstream:** `update()` de memória já no cold tier usa a *primeira* época encontrada, não a versão mais nova (diferente de `get()`), podendo reescrever sobre texto antigo. `project`/`agent_id` são imutáveis, então não afeta autorização. | Teste de regressão; reportar/PR upstream; se preciso, nosso `update` monta texto+metadata a partir de `get()` | correção de update em memória antiga |
| Q4 | ~~Modelo de embedding~~ **Decidida** (operador, 2026-11-16): `paraphrase-multilingual-MiniLM-L12-v2` local (384d, ~470 MB, CPU). Descartados: `ollama:bge-m3` (serviço extra, +RAM) e API externa (texto sai do servidor). | — | — |
| Q5 | Backup a quente é seguro com WAL aberto? | Teste de restore | backup sem parada |
| Q6 | Extração de entidades (KG) cria nós compartilhados entre projetos — risco de vazar nomes via grafo | Já mitigado: grafo só para `global` | liberar grafo a não-global |
