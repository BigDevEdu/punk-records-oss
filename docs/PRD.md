# PRD — Punk-Records: memória unificada para agentes

- **Status:** rascunho v1
- **Data:** 2026-11-16
- **Dono:** Eduardo (operador)
- **Docs relacionados:** [TRD](TRD.md) · [ADRs](adr/)

## 1. Problema

Cada ferramenta de agente (Claude Code, n8n, scripts próprios, etc.) mantém sua própria memória. O que um agente aprende — uma convenção de projeto, uma decisão, uma preferência do usuário, um erro já resolvido — não chega aos outros. Resultado: retrabalho, decisões repetidas ou contraditórias e contexto perdido entre ferramentas.

## 2. Visão

Um servidor MCP **self-hosted**, chamado Punk-Records, que todos os agentes usam como memória de longo prazo. Cada agente grava com sua própria identidade; agentes que trabalham no mesmo projeto enxergam o que os outros aprenderam ali; agentes privilegiados enxergam um projeto inteiro ou tudo. O motor de memória é o [EpochDB](https://github.com/jersobh/epochdb) ([ADR-0001](adr/0001-epochdb-como-motor.md)).

## 3. Personas

| Persona | Quem é | O que precisa |
|---|---|---|
| **Agente comum** (`agent`) | Um agente de ferramenta (ex.: Claude Code no repo X) | Gravar o que aprende; recuperar o que ele e outros agentes aprenderam nos projetos dele e no `_shared` |
| **Agente de projeto** (`project_admin`) | Agente que cuida de um ou mais projetos (ex.: revisor, orquestrador do projeto) | Ver e curar (editar/apagar) toda a memória dos projetos dele |
| **Agente global** (`global`) | Supervisor/orquestrador | Ver e curar a memória de todos os projetos; usar ferramentas de grafo/timeline |
| **Operador** | Você (humano) | Subir o servidor, emitir/revogar tokens, definir projetos, fazer backup |

## 4. Objetivos

- **O1.** Um único lugar onde agentes de **≥ 2 ferramentas diferentes** gravam e consultam memória do mesmo projeto.
- **O2.** Isolamento: um agente nunca lê memória de projeto que não é dele.
- **O3.** Visão privilegiada por projeto e global, sem precisar de outro sistema.
- **O4.** Rodar em um servidor próprio, com os dados sob controle do operador.

## 5. Não-objetivos (v1)

- Interface web/painel de administração.
- Usuários humanos múltiplos / SaaS / cobrança.
- Cluster, sharding, alta disponibilidade.
- OAuth / SSO.
- Migração automática das memórias existentes de outras ferramentas (pode vir depois como script).

## 6. Anti-objetivos (falha mesmo que "funcione")

- **Vazamento entre projetos** — qualquer caminho em que um agente comum leia memória de projeto fora da sua lista é bug crítico (bloqueia release).
- **Latência que faça agentes desistirem** de consultar a memória.
- **Memória que só cresce e vira ruído** — sem forma de apagar/corrigir, agentes param de confiar.
- **Operação que exige babá** — se subir/atualizar/fazer backup exige mais que alguns comandos, não vai ser mantido.

## 7. Requisitos funcionais

| ID | Requisito | Quem |
|---|---|---|
| RF-01 | Gravar memória (texto + metadados livres) num projeto permitido; o servidor registra autor e projeto | todos |
| RF-02 | Consultar memória por similaridade, restrita aos projetos visíveis ao agente | todos |
| RF-03 | Consulta multi-hop / adaptativa com a mesma restrição | todos |
| RF-04 | Projeto especial `_shared`, legível e gravável por todos | todos |
| RF-05 | Editar/apagar (soft) as próprias memórias | `agent` |
| RF-06 | Editar/apagar qualquer memória dos projetos dele | `project_admin` |
| RF-07 | Ler/editar/apagar qualquer memória; usar grafo de entidades, timeline e SQL analítico | `global` |
| RF-08 | Listar os projetos que o agente pode acessar (`whoami`) | todos |
| RF-09 | Emitir, listar e revogar tokens de agente via CLI | operador |
| RF-10 | Log de auditoria de toda chamada (agente, tool, projeto, ids — sem conteúdo) | sistema |
| RF-11 | Backup e restore documentados | operador |

## 8. Requisitos não-funcionais

| ID | Requisito |
|---|---|
| RNF-01 | p95 de `query` < 300 ms com ~100 mil memórias, num VPS de ~4 GB RAM |
| RNF-02 | Nenhuma memória confirmada é perdida em crash (WAL com fsync) |
| RNF-03 | Todo tráfego via TLS; tokens nunca armazenados em claro |
| RNF-04 | Sobe com `docker compose up -d`; atualização = trocar a imagem |
| RNF-05 | Suíte de testes de isolamento roda a cada upgrade do EpochDB |

## 9. Métricas de sucesso

- Agentes de ≥ 2 ferramentas consultando o mesmo projeto em uso real dentro de 30 dias.
- 0 vazamentos na suíte de isolamento (gate de release).
- Operador percebe menos retrabalho/explicações repetidas aos agentes (qualitativo).

## 10. Riscos

| Risco | Mitigação |
|---|---|
| EpochDB é jovem e de mantenedor único | Versão fixada, testes de isolamento a cada upgrade, fork se necessário ([ADR-0001](adr/0001-epochdb-como-motor.md)) |
| Isolamento lógico falhar por bug de filtro | Filtro sempre gerado pelo servidor, fail-closed, suíte de isolamento ([ADR-0002](adr/0002-banco-unico-isolamento-logico.md), [ADR-0003](adr/0003-modelo-de-acesso-agente-projeto-global.md)) |
| Grafo de entidades unificado expõe nomes entre projetos | Ferramentas de grafo restritas a `global` no v1 |
| Agentes gravarem lixo demais | Soft delete, curadoria por `project_admin`/`global` |
