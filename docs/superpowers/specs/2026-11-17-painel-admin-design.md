# Painel de administração do Punk-Records — design

- **Status:** implementado
- **Data:** 2026-11-17
- **Relacionados:** [PRD](../../PRD.md) · [TRD](../../TRD.md) · [ADRs](../../adr/)
- **Mockups aprovados (referência visual obrigatória):** [`mockups/painel-cerebro-login.html`](mockups/painel-cerebro-login.html) (Cérebro + Login) e [`mockups/painel-agentes.html`](mockups/painel-agentes.html) (Agentes). Fragmentos HTML com o CSS embutido; a estrutura de cada tela segue esses arquivos.

## 1. Por quê

O operador (Eduardo) quer, sem terminal:

1. **Entender o que os agentes aprendem** — ver a memória inteira como um grafo, com os assuntos agrupados, pesquisar e abrir cada memória.
2. **Administrar acessos** — ver agentes e permissões, criar, editar, revogar, gerar novo token e excluir.

Isso muda um não-objetivo do PRD v1 ("Interface web/painel de administração"); o PRD deve ser atualizado junto.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Grafo da memória com ligações por similaridade de significado e grupos de assunto nomeados.
- "Ver como agente X": o grafo e a busca mostram só o que aquele agente enxerga.
- Busca semântica que destaca os resultados no grafo.
- Detalhe da memória com memórias parecidas; editar texto e apagar (soft).
- CRUD de agentes com o token mostrado uma única vez.
- Último uso por agente e um feed de atividade recente.

**Não-objetivos (v1)**
- Curadoria assistida (duplicatas, contradições, memórias órfãs).
- Controle de linha do tempo no grafo, tema claro, celular com grafo (no celular o painel precisa abrir e a tela de Agentes funcionar; o grafo pode ficar indisponível).
- Login de várias pessoas, OAuth, papéis de usuário humano.
- Extração de entidades (abordagem B) e ligações explícitas (C).

**Anti-objetivos**
- Painel que fura o isolamento: nada do painel pode ser acessado com token não-global, e "ver como" nunca mostra mais do que o agente veria pelo MCP.
- Visual de "IA genérica" (gradientes, vidro fosco, brilhos) — o usuário rejeitou explicitamente.
- Operador se trancar fora: o painel não deixa revogar nem excluir o agente da própria sessão.

## 3. Decisões tomadas com o usuário

| Decisão | Escolha |
|---|---|
| Ligações do grafo | **A — similaridade de embeddings** (cada memória ligada às 3–5 mais parecidas acima de um limite) |
| Acesso | **Login com token de papel `global`**, sessão em cookie |
| Tecnologia do frontend | **React + Vite** (o usuário preferiu a SPA à página estática) |
| Layout | **A — três colunas** (barra lateral, grafo, painel de detalhe), visual de ferramenta profissional (mockup v3) |
| Telas | Login, Cérebro, Agentes (lista + detalhe + criar + token uma vez), Atividade |

### Abordagens consideradas (frontend)

1. Página estática servida pelo app (HTML + JS + `force-graph` via CDN) — sem build, menos peças. Recomendada pelo Claude; **não escolhida**.
2. **SPA React/Vite embutida na imagem — escolhida.** Interface mais rica e mais fácil de crescer; custa Node no build e mais arquivos.
3. Serviço separado — **descartado**: só um processo pode abrir o EpochDB (ADR-0005).

## 4. Arquitetura

```
navegador ──HTTPS──▶ proxy ──▶ app (mesmo processo, 1 worker)
                                 ├─ /mcp            MCP (BearerAuth, como hoje)
                                 ├─ /healthz
                                 ├─ /admin/         SPA (arquivos estáticos do build)
                                 └─ /admin/api/*    API JSON do painel (sessão por cookie)
                                          └─ MemoryStore / ConfigStore / authz (reaproveitados)
```

- O painel roda **no mesmo processo e no mesmo domínio** do MCP.
- `BearerAuth` passa a ignorar caminhos que começam com `/admin` (eles têm autenticação própria) — além do `/healthz` que já ignora.
- **Build:** Dockerfile multi-estágio. Estágio `web` com `node:22-alpine` roda `npm ci && npm run build` em `web/`; o estágio final Python copia `web/dist` para `/app/web`. **Node não vai para a imagem final.**
- Starlette `StaticFiles(directory="/app/web", html=True)` montado em `/admin`; rotas da SPA que não são arquivo devolvem `index.html` (fallback de SPA).
- Em desenvolvimento: `vite dev` com proxy de `/admin/api` para o servidor Python local.

### Código novo (proposta de layout)

```
punk_records/admin.py        rotas /admin/api/* e montagem dos estáticos
punk_records/graph.py        kNN por similaridade, grupos e nomes dos grupos (funções puras + cache)
punk_records/activity.py     registro de auditoria em arquivo, último uso por agente
punk_records/agents_file.py  leitura/gravação do agents.yaml (extraído de cli.py, usado por CLI e painel)
web/                         app React + Vite + TypeScript
tests/test_admin.py  tests/test_graph.py  tests/test_activity.py
```

## 5. Autenticação do painel

- `POST /admin/api/login {token}`: aceita só token de agente **ativo** com papel **`global`**. Sucesso → cria sessão (`secrets.token_urlsafe(32)`), guarda em memória `{sessão: (agent_id, expira_em)}` com validade de **12 h**, e devolve cookie `pr_session` com `HttpOnly; Secure; SameSite=Strict; Path=/admin`.
- Falha → 401 com mensagem que diz o que fazer ("Esse token não tem papel global. Use um token de administrador."), após atraso fixo de 500 ms (freio simples para tentativa e erro).
- **Toda** requisição da API confere a sessão **e** reconsulta o `ConfigStore`: se o agente da sessão foi revogado, excluído ou deixou de ser global, a sessão cai na hora (401).
- `POST /admin/api/logout` apaga a sessão.
- Mutações exigem `Content-Type: application/json` (junto com `SameSite=Strict`, cobre CSRF).
- Sessões em memória: reiniciar o servidor desloga todo mundo. Aceitável (um operador).
- O cookie `Secure` exige HTTPS; em desenvolvimento local (`http://localhost`) a flag é omitida quando `PR_ADMIN_INSECURE_COOKIE=1`.

## 6. Grafo e ligações

**Fonte:** todas as memórias **vivas** (hot tier + versão mais nova de cada id no cold tier, sem `_deleted` e sem ids em `deleted_atom_ids`), com embedding, texto, metadata e datas. Novo método `MemoryStore.all_live()` — cuidado: `EpochDB.get_timeline()` carrega todas as versões do cold tier e pode devolver uma versão antiga sem `_deleted` de uma memória já apagada; deduplicar por id ficando com a mais nova **antes** de descartar as apagadas.

**Ligações (kNN):** matriz de embeddings normalizados (numpy), similaridade de cosseno, para cada memória as `k` mais parecidas (padrão `k=5`) com similaridade ≥ `min_sim` (padrão `0.55`, ajustável na barra de status). Arestas sem duplicata (a–b = b–a), com o peso.
`# ponytail: O(N²) em memória; até ~10 mil memórias leva segundos. Acima disso, usar o índice HNSW do EpochDB ou um índice próprio.`

**Cache:** resultado guardado em memória com chave = (quantidade de memórias vivas, maior `updated_at`, `k`, `min_sim`). Gravação, edição ou exclusão invalida.

**Grupos de assunto:** componentes conexos do grafo kNN com `min_sim` de agrupamento (padrão `0.6`); grupos com menos de 3 memórias ficam sem nome. **Nome do grupo:** as 2–3 palavras mais características do grupo (frequência no grupo ÷ frequência no total, sem stopwords em português e inglês, sem números), juntadas com "e" — ex.: "Deploy e infraestrutura" vira algo como "deploy e dokploy". Determinístico, sem LLM.

**"Ver como agente X":** o servidor filtra nós por `authz.visible_projects(X)` **antes** de calcular o grafo devolvido (ligações para memórias invisíveis não aparecem). Busca usa `authz.build_filter(X, None, None)`.

**Tamanho do ponto:** número de ligações. **Cor:** projeto (paleta categórica fixa, ver §9; mais de 8 projetos → as cores repetem; a forma alternativa de ponto prevista foi cortada).

## 7. API do painel (`/admin/api`)

Todas exigem sessão (exceto `login`). Erros no mesmo formato do MCP: `{"error": "forbidden|invalid|not_found|unauthorized", "detail": str}`.

| Método e rota | Faz |
|---|---|
| `POST /login`, `POST /logout`, `GET /me` | sessão; `/me` devolve o agente logado |
| `GET /graph?as=&projects=&types=&min_sim=&k=` | `{nodes, edges, clusters, total}`; nó = `{id, text (até 160 caracteres), project, agent_id, memory_type, created_at, updated_at, degree}` |
| `GET /search?q=&as=&k=` | ids e similaridade dos resultados (reaproveita `store.query` + `build_filter`) |
| `GET /memories/{id}` | memória completa + até 5 parecidas (do kNN) |
| `PATCH /memories/{id} {text?, metadata?}` | reaproveita `store.update` (texto explícito; reservadas removidas) |
| `DELETE /memories/{id}?hard=` | soft por padrão; `hard=true` usa `store.find` como o MCP |
| `GET /projects` | projetos com contagem de memórias e cor |
| `GET /agents` | `{id, role, projects, disabled, last_used_at, memory_count}` |
| `POST /agents {id, role, projects}` | cria; devolve `{token}` **uma vez**; id já existente → `invalid` (no painel criar não substitui; para trocar o token use "gerar novo token") |
| `PATCH /agents/{id} {role?, projects?, disabled?}` | editar papel/projetos, revogar (`disabled: true`) ou reativar |
| `POST /agents/{id}/token` | gera novo token (o antigo para de valer); devolve `{token}` uma vez |
| `DELETE /agents/{id}` | remove do `agents.yaml`; memórias ficam com o `agent_id` antigo |
| `GET /activity?limit=&agent=` | últimas entradas da auditoria (mais novas primeiro) |

- Id de agente: `^[a-z0-9][a-z0-9-]{1,62}$`. Projeto novo: mesma regra; `_shared` não pode ser criado nem listado como projeto de agente.
- Revogar, excluir, rebaixar de `global` ou gerar novo token **do agente da própria sessão** → `forbidden` ("Você não pode alterar o agente da sua própria sessão.").
- Toda mutação do painel também gera linha de auditoria (`tool: "admin.agent.create"` etc., sem token nem texto).
- Gravação do `agents.yaml`: as funções `_load_raw`/`_save` do `cli.py` são movidas para `agents_file.py` (validação + troca atômica) e usadas pelo CLI e pelo painel. O `ConfigStore` recarrega sozinho.

## 8. Auditoria persistida, último uso e Atividade

- Além do stdout, cada linha de auditoria (MCP e painel) é anexada a **`/data/audit.jsonl`**. Ao passar de **10 MB**, o arquivo vira `audit.jsonl.1` (substituindo o anterior) e um novo começa.
- **Último uso:** dicionário em memória `{agent_id: ts}` atualizado a cada chamada MCP autenticada; no boot é reconstruído lendo o `audit.jsonl` atual.
- **Atividade:** `GET /activity` lê o fim do arquivo (sem carregar tudo). A tela mostra hora, agente, ação, projeto(s), quantidade de resultados e resultado (ok/erro). Nunca texto de memória.
- O formato da linha não muda (mesmos campos de hoje).

## 9. Visual (do mockup v3)

| Token | Valor |
|---|---|
| fundo | `#16181d` |
| superfície / superfície 2 | `#1c1f26` / `#22262e` |
| borda | `#2b3039` |
| texto / texto secundário | `#e3e6eb` / `#8f96a3` |
| destaque (seleção, ação principal) | `#5b8def` |
| projetos (categórica) | `#5b8def`, `#3fb68b`, `#e0a43b`, `#d1617a`, depois `#9b7bd4`, `#4fb3bf`, `#c98a5b`, `#8fa35b` |
| erro | `#e8899c` |

- Fonte **IBM Plex Sans** (empacotada no build, não via Google Fonts), números tabulares. Raio 6 px em controles, 8 px em painéis; bordas de 1 px; **sem sombras, gradientes ou vidro**.
- Rótulos em caixa normal (sem maiúsculas espaçadas), sem "·" entre metadados, sem emojis na interface.
- Estrutura: barra lateral (Cérebro, Agentes, Atividade com contadores; projetos com quadrado de cor), barra superior (caminho, busca, "Ver como"), conteúdo, painel de detalhe à direita, barra de status no Cérebro.
- Foco visível em tudo, contraste AA, `prefers-reduced-motion` respeitado. Atalhos: `/` foca a busca, `Esc` fecha o detalhe.
- Mensagens: verbos simples, botões dizem o que fazem ("Criar agente", "Gerar novo token"), erros dizem o que fazer.

## 10. Frontend (React)

- **Stack:** React 18 + Vite + TypeScript. Grafo com **`react-force-graph-2d`** (canvas; aguenta alguns milhares de nós). Roteamento com `react-router` (`/admin/login`, `/admin`, `/admin/agentes`, `/admin/atividade`). Estado de servidor com chamadas `fetch` simples e um hook por recurso — sem biblioteca de estado global.
- Sem biblioteca de componentes; CSS próprio com os tokens da §9 em variáveis CSS.
- Sem sessão (401) em qualquer chamada → vai para o login.
- O grafo desenha os nomes dos grupos no centro de cada grupo; clique em ponto abre o detalhe; resultados de busca ficam destacados e o resto esmaece.

## 11. Testes

- **Backend (pytest, padrão do projeto):** login (global ok; agent recusado; revogado recusado; sessão cai após revogar), cookie com flags, toda rota sem sessão → 401, token de agente no header não abre o painel, `/mcp` continua exigindo Bearer, "ver como" não devolve nó invisível (reaproveitar o cenário da suíte de isolamento), CRUD de agentes (token uma vez, id duplicado, auto-trancamento bloqueado), `all_live` sem versões apagadas, kNN e nomes de grupo em dados pequenos fixos, auditoria em arquivo + rotação + último uso reconstruído no boot.
- **Frontend:** `tsc --noEmit` e `vite build` no build da imagem; um teste com Vitest do cliente da API (401 redireciona para o login).

## 12. Escolhas do Claude após a revisão do documento

Decisões tomadas sem perguntar ao usuário (podem ser corrigidas):

1. **Editar e apagar no "Ver como X":** desabilitados. Com "ver como" ativo, o detalhe mostra a faixa "Vendo como X" e esconde Editar/Apagar. `GET /memories/{id}?as=X` aplica `authz.check_readable` e devolve `not_found` para memória invisível a X (sem oráculo). Sem `as`, o admin global edita e apaga qualquer memória.
2. **Embeddings:** disponíveis sem recalcular — `cold_tier.load_epoch()` devolve átomos com `embedding` (verificado, 384 dimensões); hot tier em `hot_tier.atoms`.
3. **Processo único:** `all_live()` roda via `run()` com o `STORE_LIMITER` e só **copia** ids, metadata, textos e a matriz de embeddings. O cálculo do kNN e dos grupos roda em `anyio.to_thread.run_sync` **sem** o limiter, para não segurar as chamadas MCP durante o cálculo. Meta: snapshot < 200 ms com 10 mil memórias.
4. **Cache × "ver como":** o grafo é calculado por escopo (conjunto de projetos visíveis); a chave do cache inclui esse conjunto além de (quantidade, maior `updated_at`, `k`, `min_sim`). Grupos = componentes conexos das arestas do mesmo kNN com peso ≥ 0,6 (sem segundo kNN).
5. **Projetos:** seguem a regra do CLI — nascem ao criar ou editar um agente com projeto novo. Não há "excluir projeto" no v1; `GET /projects` lista todos os projetos do `agents.yaml` (inclusive com 0 memórias) mais `_shared`. Projeto órfão no arquivo é aceito.
6. **Escrita concorrente no `agents.yaml`:** as mutações do painel passam por um `threading.Lock` em memória. O CLI continua sem lock (uso raro, manual); a troca atômica do arquivo evita corrupção, no pior caso uma alteração simultânea se perde.

## 13. Deixado para o construtor

Estrutura interna dos componentes React, nomes de arquivos do `web/`, algoritmo exato de layout do grafo (forças), lista de stopwords, formato visual exato da tela de Atividade (seguir a mesma linguagem da tela de Agentes), mensagens de estado vazio.

## 14. Documentos a atualizar junto

PRD (painel deixa de ser não-objetivo; RFs do painel), TRD (rotas `/admin`, auditoria em arquivo, Dockerfile multi-estágio), README (como acessar o painel), novo ADR-0006 (painel React no mesmo processo, login por token global).
