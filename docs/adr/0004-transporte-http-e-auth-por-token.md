# ADR-0004 — Transporte HTTP e autenticação por token

- **Status:** Aceito
- **Data:** 2026-11-16

## Contexto

Os agentes rodam em máquinas e ferramentas diferentes (Claude Code local, n8n no servidor, etc.) e precisam alcançar um servidor remoto self-hosted. O MCP de referência do EpochDB usa stdio e não tem autenticação.

## Decisão

- **Transporte:** MCP **Streamable HTTP**, com o SDK oficial Python (`mcp` 2.3, `MCPServer`, HTTP stateless), em `/mcp`.
- **TLS:** terminado por **Caddy** (certificado automático) na frente do app; o app só escuta na rede interna do Compose.
- **Auth:** `Authorization: Bearer <token>` por agente. Tokens aleatórios (≥ 32 bytes, prefixo `pr_`), armazenados apenas como **SHA-256** em `agents.yaml`.
- **Gestão:** CLI `punk-records token new|list|revoke <agent_id>` edita o `agents.yaml`; o servidor recarrega o arquivo ao detectar mudança (mtime) — sem restart.

## Consequências

- (+) Qualquer cliente MCP com suporte a HTTP + header customizado funciona (Claude Code, n8n, etc.).
- (+) Sem banco extra para credenciais; config versionável (sem os segredos em claro).
- (−) Sem expiração automática nem escopos finos por tool no v1.
- (−) Clientes que só falam stdio precisam de um proxy (ex.: `mcp-remote`).

## Alternativas consideradas

- **OAuth 2.1 (spec MCP de autorização):** padrão para clientes públicos, mas exige servidor de autorização — exagero para um operador só. Reavaliar se houver humanos múltiplos.
- **mTLS:** forte, mas distribuir certificados para cada agente/ferramenta é atrito demais.
- **stdio + SSH:** sem auth por agente; cada conexão abriria um processo sobre o mesmo storage (ver [ADR-0005](0005-processo-unico-dono-do-storage.md)).
