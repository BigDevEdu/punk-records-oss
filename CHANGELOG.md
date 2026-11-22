# Changelog

Todas as mudanças relevantes do Punk-Records ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [versionamento semântico](https://semver.org/lang/pt-BR/). Cada versão tem uma tag `vX.Y.Z` no git, e a imagem correspondente é publicada no Docker Hub como `eduardo379/punk-records:X.Y.Z`.

Como manter este arquivo: anote cada mudança em **Não lançado**, na seção certa (Adicionado, Alterado, Corrigido, Removido, Segurança). Ao lançar uma versão, renomeie esse bloco para a versão e a data, e crie um **Não lançado** vazio no topo.

## [Não lançado]

### Adicionado

- Painel: tela **Backup**, com backup das memórias e do `agents.yaml` no **Google Drive**. O admin cola o Client ID e o Client Secret de um OAuth Client do Google, conecta a conta e o servidor cria a pasta "Punk-Records Backups". Dá para fazer backup na hora, ligar uma **rotina** (6 h, 12 h, diária ou semanal) com retenção dos N mais recentes e **restaurar** qualquer backup sem parar o servidor; o estado anterior fica em `/data/.pre-restore`.
- Variáveis `PR_PUBLIC_URL` e `PR_BACKUP_FILE`.

## [0.3.0] - 2026-11-20

### Adicionado

- Painel, Cérebro: vista **Grafo 3D**, que se gira com o mouse. Clicar numa memória faz a câmera voar até ela, e a busca apaga o que não bateu. O three.js só é baixado quando alguém escolhe o 3D, então as outras telas não ficam mais pesadas.
- Painel: **favicon** e **logo redesenhado**, legível em tamanho pequeno, nos temas claro e escuro.
- Painel: **micro animações** na troca de tela, no painel lateral, nos avisos e no login. Respeitam o "reduzir movimento" do sistema.

### Alterado

- Painel: o visual inteiro passou para o design system **Astryx**, com tema próprio (cinzas neutros e links em azul). Menu lateral, tabelas, formulários, seletores e avisos agora são componentes do Astryx, com navegação por teclado e leitor de tela.
- Painel: **revogar acesso**, **excluir agente** e **apagar memória** confirmam num diálogo, em vez de uma caixa dentro do painel.
- Painel, Cérebro: o grafo **se reenquadra** quando o painel lateral abre ou fecha, sem ficar cortado na borda. A barra de status ficou numa linha só.
- Painel: no celular, a tabela de agentes rola na horizontal em vez de quebrar os nomes.
- Painel: React 18 → 19.

## [0.2.3] - 2026-11-19

### Corrigido

- `GET /admin/api/projects` não dá mais 500 quando existe memória sem `metadata.project`. O erro (`TypeError` no `sorted`) impedia o painel inteiro de abrir.

## [0.2.2] - 2026-11-19

### Corrigido

- Painel: **excluir agente**, **gerar novo token** e **apagar memória** voltaram a funcionar. Essas chamadas não têm corpo e iam sem `Content-Type: application/json`, que o servidor exige em toda mutação; a resposta era 400.
- Painel: **Sair** agora encerra a sessão no servidor. Antes falhava calado pelo mesmo motivo e a sessão continuava válida.

## [0.2.1] - 2026-11-18

### Corrigido

- A imagem do Docker Hub agora é publicada também para **ARM64** (`linux/arm64`), além de amd64. Antes, o pull falhava em servidores ARM com `no matching manifest for linux/arm64/v8`.

## [0.2.0] - 2026-11-18

### Adicionado

- **Excluir projeto movendo as memórias** (`DELETE /admin/api/projects/{nome}` com `{"move_to": "destino"}`). As memórias passam para o projeto de destino; os agentes que tinham acesso ao projeto excluído passam a ter acesso ao destino. O `_shared` não pode ser excluído. A operação fica na auditoria como `admin.project.delete`.
- Painel: página **Projetos**, com a cor de cada projeto e a exclusão. A confirmação mostra para onde vão as memórias e quais agentes ganham acesso.
- Painel: página **Aparência**, com tema sistema, escuro ou claro. As preferências ficam no navegador.
- Painel: cada projeto da barra lateral filtra o Cérebro (`?projeto=nome`).
- Painel: visualização em **lista** no Cérebro (`?view=lista`), acessível por teclado e leitor de tela; é a visualização padrão no celular.
- Painel: na Atividade, filtro **Só erros**, agrupamento por dia, coluna **Tempo** de cada chamada e indicador "Ao vivo".
- Painel: confirmação antes de **revogar** um agente.
- Painel: `npm run dev:mock` sobe o painel com um backend falso (`web/mock.ts`), sem precisar do servidor Python.

### Alterado

- Painel refeito no design system **Grafite**: cores, raios e sombras como tokens, tema claro, fonte Inter self-hosted, ícones Lucide, badges de status, tabelas em lista agrupada e painéis laterais como card.
- Barra lateral organizada por significado: telas de trabalho no topo, projetos como filtros com uma engrenagem para gerenciar, conta, Aparência e Sair no rodapé.
- Ids internos viraram rótulos legíveis: "Admin de projeto" em vez de `project_admin`, "Buscou" em vez de `memory_query`, e assim por diante.
- Controles sem aparência nativa do navegador: dropdown próprio com busca e teclado, caixas de seleção e slider no visual do Grafite.
- O Cérebro enquadra o grafo sozinho, mostra os nomes dos grupos de forma legível e centraliza a memória selecionada.
- Animações no estilo Apple: molas sem passar do alvo, indicador deslizante nos controles segmentados e superfícies de vidro. Respeitam "reduzir movimento" e "reduzir transparência".
- O rodapé do Cérebro mostra "Atualizado há X" como botão de atualizar, em vez de um contador que sugeria atualização automática.

### Conhecido

- Ao mover memórias de projeto, a data de edição delas passa a ser a da exclusão.
- A cor padrão de um projeto depende da posição dele na lista. Ao excluir um projeto, o painel fixa a cor dos demais, mas só no navegador de quem fez a exclusão.

## [0.1.0-beta.1] - 2026-11-18

Primeira versão pública.

### Adicionado

- Servidor MCP por HTTP com uma memória compartilhada entre agentes, sobre o EpochDB (`memory_remember`, `memory_query`, `memory_multi_hop`, `memory_adaptive_query`, `memory_update`, `memory_delete`, `memory_entity_graph`, `memory_timeline`, `memory_sql`, `memory_compact`, `memory_whoami`).
- Autenticação por token Bearer e autorização por agente e projeto, com os papéis `agent`, `project_admin` e `global`; o projeto `_shared` é visível para todos.
- CLI para emitir, listar e revogar tokens, configurada pelo `agents.yaml`.
- Auditoria de cada chamada em arquivo, com último uso por agente.
- Painel de administração em `/admin`: login com token global, Cérebro (grafo por similaridade, busca, "ver como" outro agente, detalhe e edição de memória), Agentes e Atividade.
- Deploy com Docker Compose e Caddy, e publicação da imagem no Docker Hub pelo CI.
- Documentação: PRD, TRD, ADRs e README com arquitetura e passo a passo para conectar clientes.

### Segurança

- Suíte de testes de isolamento entre agentes e projetos.
- Consultas SQL isoladas de arquivos; tooltip do grafo escapado contra XSS.

[Não lançado]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/BigDevEdu/punk-records-oss/compare/v0.1.0-beta.1...v0.2.0
[0.1.0-beta.1]: https://github.com/BigDevEdu/punk-records-oss/releases/tag/v0.1.0-beta.1
