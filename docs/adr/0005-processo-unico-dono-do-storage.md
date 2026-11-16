# ADR-0005 — Um único processo dono do storage

- **Status:** Aceito
- **Data:** 2026-11-16

## Contexto

O EpochDB só protege concorrência **dentro** de um processo (`_internal_lock`). Não há lock de arquivo, checagem de PID ou aviso se dois processos abrirem o mesmo `storage_dir`. O índice quente vive em RAM e o WAL é anexado por processo — dois escritores corromperiam ou divergiriam silenciosamente.

## Decisão

- Exatamente **um processo** abre o `storage_dir`: o servidor Punk-Records, com **1 worker** (uvicorn sem `--workers > 1`).
- No boot, o servidor obtém um **lock exclusivo de arquivo** (`fcntl.flock` em `<storage_dir>/.punk-records.lock`); se falhar, aborta com erro claro.
- Concorrência entre agentes é atendida pelo event loop (async) + `_internal_lock` do EpochDB; chamadas bloqueantes vão para thread pool.
- Ferramentas offline (backup, `compact`, scripts de migração) só rodam com o servidor parado ou via tool `global` no próprio servidor.

## Consequências

- (+) Elimina a classe de bugs de corrupção por múltiplos escritores.
- (−) Escala vertical apenas; sem réplica. Aceito para v1 (não-objetivo: HA).
- (−) Restart = breve indisponibilidade; agentes devem tolerar erro de conexão.

## Alternativas consideradas

- **Múltiplos workers com o `api.server` do EpochDB como backend:** adiciona um salto HTTP e ainda é um processo dono — sem ganho.
- **`epochdb-server` (cluster/sharding):** projeto separado, fora do escopo v1.
