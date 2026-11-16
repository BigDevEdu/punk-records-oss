# ADR-0003 — Modelo de acesso: agente, projeto, global

- **Status:** Aceito (pontos marcados como *proposta* aguardam confirmação do operador)
- **Data:** 2026-11-16

## Contexto

Com banco único ([ADR-0002](0002-banco-unico-isolamento-logico.md)), todo o isolamento vem de regras aplicadas pelo servidor. Elas precisam ser simples o bastante para serem auditáveis e testáveis.

## Decisão

### Papéis

| Papel | Lê | Grava | Edita/apaga |
|---|---|---|---|
| `agent` | memórias com `project ∈ projects(token) ∪ {_shared}` | em `projects(token) ∪ {_shared}`, sempre como si mesmo | só memórias com `agent_id == self` |
| `project_admin` | igual a `agent` | igual a `agent` | qualquer memória com `project ∈ projects(token)` |
| `global` | tudo | em qualquer projeto, como si mesmo | qualquer memória |

- **Ninguém grava em nome de outro agente.** `agent_id` sempre vem do token.
- **`_shared`** (*proposta*): projeto reservado, todos leem e gravam; usado para preferências do usuário e fatos transversais. Edição/apagamento em `_shared` segue a regra do papel (o `agent` só mexe no que é dele; só `global` cura `_shared` inteiro).
- **Projeto por chamada:** tools recebem `project` opcional; se o token tem exatamente um projeto, ele é o padrão; senão é obrigatório na escrita e, na leitura, omitido = todos os visíveis.
- Projeto pedido fora da lista → erro `forbidden` (nunca resultado vazio silencioso, para facilitar debug do agente).

### Fail-closed

- Uma operação do EpochDB só é exposta a `agent`/`project_admin` se **comprovadamente** respeita o filtro. Verificado no commit `ad13730`: `query` e `multi_hop` (via `filters`).
- Operações sem filtro (`adaptive_query`, `entity_graph`, `get_timeline`, `query_sql`, `hot_summary_snapshot`, skills, user profile) → **somente `global`** no v1.
- `context_window` (vizinhos temporais) **não** é filtrado pelo EpochDB e, com banco único, traz vizinhos de qualquer projeto → o servidor remove vizinhos cujo `metadata.project` não é visível antes de responder.

### Chaves reservadas

`agent_id`, `project`, `created_by_role` e **qualquer chave começando com `_`** (ex.: `_deleted`, usado internamente pelo EpochDB) são removidas/rejeitadas do `metadata` enviado pelo cliente e não podem aparecer em `filters` do cliente.

## Consequências

- (+) Regra de leitura é um único `$in` — fácil de testar.
- (+) Ferramentas novas do EpochDB não vazam por padrão.
- (−) Agentes comuns perdem grafo/timeline no v1. Liberar exige spike que prove o filtro (ou implementar o filtro na nossa camada).

## Alternativas consideradas

- **Só as próprias memórias para o agente comum:** isolamento mais forte, mas derrota o objetivo de unificar.
- **Visibilidade por memória (private/project/global marcada na escrita):** mais flexível, mas mais regras e mais chance de vazar por marcação errada. Pode ser adicionada depois como chave reservada `visibility`.
