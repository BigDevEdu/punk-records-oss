# ADR-0006 — Painel React no mesmo processo

- **Status:** Aceito
- **Data:** 2026-11-17

## Contexto

O operador quer entender a memória sem terminal (ver o grafo, pesquisar, abrir cada memória) e administrar agentes e permissões (criar, revogar, gerar token, excluir). Essas telas precisam ler e alterar o `MemoryStore`, o `agents.yaml` e a auditoria, que hoje só são acessados pelo próprio processo do servidor. Pelo [ADR-0005](0005-processo-unico-dono-do-storage.md), só esse processo pode abrir o `storage_dir`.

## Decisão

- O painel é uma SPA React + Vite + TypeScript (`web/`), servida pelo mesmo processo do MCP em `/admin`, com a API JSON em `/admin/api`.
- Mesmo domínio e mesmo processo: nenhum serviço novo abre o storage.
- Login com um **token de agente de papel `global`** (o mesmo emitido pelo CLI). O servidor troca o token por um cookie de sessão `HttpOnly; Secure; SameSite=Strict`, válido por 12 h e guardado em memória. A sessão guarda o hash do token usado no login e cada requisição reconsulta o `agents.yaml`: revogar o agente ou trocar o token encerra as sessões dele na hora.
- Build em Dockerfile multi-estágio: um estágio Node gera `web/dist`, copiado para a imagem Python. Node não vai para a imagem final.

## Consequências

- (+) Um único processo dono do storage, como o ADR-0005 exige; nenhuma nova superfície de credencial.
- (+) Reaproveita a autorização e a auditoria já existentes; o painel não tem caminho próprio até os dados.
- (+) Interface mais fácil de crescer do que HTML estático.
- (−) O build da imagem depende de Node e npm; o pipeline de build fica mais longo.
- (−) Um bug grave no painel pode afetar o MCP, pois dividem o processo.
- (−) Sessões em memória: reiniciar o servidor desloga o operador. Aceito, porque é um operador só.
- (−) Login só por token: quem tem um token global tem acesso total ao painel. Mitigado por o token ser emitido só pelo operador (CLI no container).

## Alternativas consideradas

- **Página estática (HTML + JS, `force-graph` via CDN), sem build:** menos peças e sem Node. Recomendada na análise, mas não escolhida pelo operador, que preferiu a SPA React pela riqueza de interface e pelo crescimento futuro.
- **Serviço separado para o painel:** descartado. Exigiria um segundo processo com acesso ao storage, o que o ADR-0005 proíbe; ou uma API intermediária, que só adiciona um salto.
