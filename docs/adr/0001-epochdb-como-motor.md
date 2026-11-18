# ADR-0001 — EpochDB como motor de memória

- **Status:** Aceito
- **Data:** 2026-11-16

## Contexto

Precisamos de um motor de memória para agentes, self-hosted, com busca semântica, persistência durável e capacidade de corrigir fatos que mudaram. O operador escolheu avaliar o [EpochDB](https://github.com/jersobh/epochdb) (Python, MIT).

O EpochDB oferece: tier quente em RAM (HNSW + WAL + grafo de conhecimento), tier frio em Parquet por época, busca híbrida (semântica + BM25 + entidades + multi-hop) com RRF, supersessão de fatos antigos, filtros de metadados estilo Mongo, skills/perfil de usuário e um servidor MCP stdio de referência. Embeddings locais (SentenceTransformers) ou via `openai:`/`google:`/`ollama:`.

Pontos fracos: projeto jovem (≈27★, um mantenedor), sem versão publicada visível, servidor MCP sem autenticação e com tenant/namespace fixos por processo.

## Decisão

Usar o EpochDB como **biblioteca** (`import epochdb`), dentro do nosso próprio servidor MCP. **Não** usar o `epochdb.mcp_server` diretamente — ele vira referência de quais operações expor.

- Versão **fixada por commit/versão exata** no `pyproject.toml`.
- Toda atualização do EpochDB passa pela suíte de isolamento ([TRD §10](../TRD.md#10-plano-de-testes)).
- Se o upstream parar ou divergir, fazemos fork.
- Instalado com o extra `[embeddings]` (SentenceTransformers).
- Os bugs que encontramos (Q3a, Q7, Q8, Q9 e validação de filtros) foram reportados e corrigidos upstream na 1.14.2 (commit `ee82468`), a versão fixada hoje; ver [TRD §11](../TRD.md#11-questões-em-aberto).

## Consequências

- (+) Recursos ricos de memória (supersessão, grafo, multi-hop) sem construir nada disso.
- (+) Tudo em Python, um processo, sem banco externo.
- (−) Dependência de projeto pouco maduro; precisamos ler o código-fonte em vez de confiar em documentação.
- (−) Comportamentos internos (ex.: filtros não aplicados aos vizinhos de `context_window`) precisam ser contornados na nossa camada.

## Alternativas consideradas

- **mem0 / Zep:** mais maduros, mas mais pesados (dependem de Postgres/Neo4j/serviços) e não foram a escolha do operador.
- **pgvector + código próprio:** controle total e isolamento por SQL/RLS, mas perderíamos supersessão, grafo e busca híbrida — muito código a escrever.
