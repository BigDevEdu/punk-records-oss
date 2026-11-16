# ADR-0002 — Banco único com isolamento lógico

- **Status:** Aceito
- **Data:** 2026-11-16

## Contexto

A identidade é o **agente**. Um agente comum precisa ler as próprias memórias **e as de outros agentes nos projetos dele**; agentes privilegiados leem um projeto inteiro ou tudo. O objetivo do produto é justamente *unificar* memória.

O EpochDB isola fisicamente via `tenant`/`namespace` (`<storage>/tenants/<t>/ns/<n>`), cada um com seu próprio índice HNSW e grafo. Ele também aceita `filters` em `query()`, aplicados pelo `RetrievalManager.match_filters` sobre chaves de topo de `atom.metadata`, para candidatos de **todos** os canais (semântico, BM25, épocas frias, entidades, multi-hop) — **exceto** os vizinhos de `context_window`.

## Decisão

**Uma única instância EpochDB** (sem `tenant`/`namespace`). Isolamento lógico:

- Em toda escrita, o servidor grava em `metadata` as chaves reservadas `agent_id` e `project`, derivadas do token — nunca do cliente.
- Em toda leitura, o servidor gera o filtro `{"project": {"$in": <projetos visíveis>}}` (ausente para `global`).
- Ver regras completas em [ADR-0003](0003-modelo-de-acesso-agente-projeto-global.md) e [TRD §6](../TRD.md#6-autorização).

## Consequências

- (+) Um índice, um modelo de embedding, um grafo unificado → menos RAM, consultas de projeto/global sem fan-out.
- (+) Fatos e entidades se conectam entre agentes — o objetivo do produto.
- (−) Isolamento depende da nossa camada de autorização. Mitigado por: filtro sempre gerado no servidor, fail-closed, chaves reservadas protegidas, suíte de isolamento como gate.
- (−) Grafo de entidades e timeline não aceitam filtros → restritos a `global` no v1.
- (−) Apagar um projeto inteiro = soft delete por filtro + `compact()`, não `rm -rf` de pasta.

## Alternativas consideradas

- **B — Pasta física por projeto** (`tenant = projeto`): isolamento forte entre projetos, mas uma instância (índice + RAM) por projeto, global exige fan-out + fusão de rankings, e o grafo não liga projetos.
- **C — Pasta física por agente:** isolamento máximo, mas toda leitura de projeto vira fan-out entre agentes e o grafo fica fragmentado — contradiz "próprias + do projeto".
