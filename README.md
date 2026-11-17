# Punk Records

Servidor MCP de memória self-hosted para agentes (Claude Code, n8n). Expõe `/mcp` por HTTP com token Bearer, atrás de Caddy com HTTPS automático.

## Subir

Pré-requisitos: Docker com Compose, um domínio apontando para o host e as portas 80/443 liberadas.

```sh
echo "PR_DOMAIN=memory.seu-dominio.com" > .env
docker compose up -d --build
docker compose ps   # o app fica "healthy" depois que o servidor sobe
```

## Emitir token

Um token por agente. Ele aparece uma vez na saída; o arquivo guarda só o hash SHA-256. O comando roda como o mesmo usuário do app (uid 10001), para o `agents.yaml` ficar legível por ele:

```sh
mkdir -p config
docker compose run --rm -v ./config:/config app punk-records token new claude-code-laptop --role agent --projects punk-records
```

Se o diretório `config` for criado no host Linux, dê a posse ao uid 10001 antes: `sudo chown 10001 config`. Não precisa reiniciar o app: ele recarrega o `agents.yaml` sozinho.

Outros comandos: `token list`, `token revoke <id>` (mesmo `docker compose run`).

## Conectar clientes

Claude Code:

```sh
claude mcp add --transport http punk-records https://<PR_DOMAIN>/mcp --header "Authorization: Bearer <token>"
```

n8n: nó **MCP Client** → Connection type **Streamable HTTP** → URL `https://<PR_DOMAIN>/mcp` → autenticação por header `Authorization: Bearer <token>`.

**Não** defina `PR_HOST=127.0.0.1` atrás do Caddy: a proteção de DNS rebinding do SDK MCP responde 421 para o host público. O Dockerfile já usa `0.0.0.0`.

## Backup e restore

Ver TRD §9. Pare o app antes para copiar o volume `data`:

```sh
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD:/backup" --entrypoint tar app czf /backup/punk-records-$(date +%F).tgz -C /data .
docker compose start app
```

Restore (substitui o conteúdo do volume; o WAL é reaplicado no boot):

```sh
docker compose stop app
docker compose run --rm --no-deps --user root -v "$PWD:/backup" --entrypoint sh app -c 'rm -rf /data/* && tar xzf /backup/punk-records-AAAA-MM-DD.tgz -C /data'
docker compose start app
```

Logs de auditoria (uma linha JSON por chamada, sem texto de memória): `docker compose logs -f app`.
