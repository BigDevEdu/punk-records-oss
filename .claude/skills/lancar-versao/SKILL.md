---
name: lancar-versao
description: Lança uma versão nova do Punk-Records (punk-records-oss) do começo ao fim — bump de versão na API e no painel, CHANGELOG, PR da versão, tag vX.Y.Z, imagem no Docker Hub e release no GitHub. Use sempre que o usuário pedir para "publicar a versão", "subir versão", "lançar a 0.x.y", "criar a tag", "fazer o release", "mandar pro Docker Hub" ou disser que uma correção já mergeada precisa chegar em produção, mesmo sem citar a palavra release.
---

# Lançar versão do Punk-Records

Uma versão aqui é: os mesmos números em `pyproject.toml` e `web/package.json`, um bloco no
`CHANGELOG.md`, uma tag anotada `vX.Y.Z` e a imagem `eduardo379/punk-records:X.Y.Z` (amd64 + arm64)
no Docker Hub, com um release no GitHub apontando para ela. A tag é o que publica a imagem
(`.github/workflows/docker-publish.yml`), então tudo antes dela precisa estar certo.

Tudo vai para a `main` por PR, com merge commit (`gh pr merge --merge --delete-branch`), como no
resto do histórico.

## 1. Pré-condições

```bash
git switch main && git pull
git status --porcelain                 # sujeira não relacionada fica de fora, nunca entra no commit
git describe --tags --abbrev=0         # última versão
git log --oneline $(git describe --tags --abbrev=0)..main
```

Se a correção que motiva a versão ainda não está na `main`, ela vai primeiro num PR próprio
(branch `fix/...` ou `feat/...`), com merge, e só depois começa a versão. Assim o PR da versão
só mexe em número e CHANGELOG, e fica fácil de revisar.

Rode os testes na `main` atualizada. Se algo falhar, pare e mostre a saída ao usuário:

```bash
uv run pytest -q
(cd web && npx vitest run && npx tsc --noEmit -p .)
```

## 2. Escolher o número

Semver a partir da última tag: correção → patch (0.2.2 → 0.2.3); funcionalidade nova → minor;
quebra de API do MCP, do painel ou do formato do `agents.yaml` → major. Se o usuário já disse o
número, use o dele.

## 3. Branch e commits da versão

```bash
git switch -c release/X.Y.Z
sed -i '' 's/^version = "ANTIGA"/version = "X.Y.Z"/' pyproject.toml
git add -- pyproject.toml && git commit -m "chore(api): versão X.Y.Z"
(cd web && npm version X.Y.Z --no-git-tag-version)
git add -- web/package.json web/package-lock.json && git commit -m "chore(painel): versão X.Y.Z"
```

(`sed -i ''` é o do macOS; no Linux é `sed -i`.)

### CHANGELOG

Formato Keep a Changelog em pt-BR. Transforme o conteúdo de **[Não lançado]** num bloco
`## [X.Y.Z] - AAAA-MM-DD` logo abaixo de um `## [Não lançado]` vazio. Se **Não lançado** estiver
vazio, escreva as entradas a partir dos commits/PRs desde a última tag.

Seções: Adicionado, Alterado, Corrigido, Removido, Segurança. Cada item diz o efeito para quem usa
(o que voltou a funcionar, o que mudou na tela ou na API), não o nome da função alterada. Exemplo:

```markdown
### Corrigido

- Painel: **excluir agente** e **gerar novo token** voltaram a funcionar. Essas chamadas não têm corpo e iam sem `Content-Type: application/json`, que o servidor exige em toda mutação; a resposta era 400.
```

No rodapé, atualize os links de comparação:

```markdown
[Não lançado]: https://github.com/BigDevEdu/punk-records-oss/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/BigDevEdu/punk-records-oss/compare/vANTIGA...vX.Y.Z
```

```bash
git add -- CHANGELOG.md && git commit -m "docs: CHANGELOG da X.Y.Z"
```

## 4. PR, merge e tag

```bash
git push -u origin release/X.Y.Z
gh pr create --base main --head release/X.Y.Z --title "Versão X.Y.Z" --body "..."
gh pr merge --merge --delete-branch release/X.Y.Z
git switch main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z: <resumo em uma linha>. Detalhes no CHANGELOG.md."
git push origin vX.Y.Z
```

Corpo do PR: o que mudou de número, o resumo do CHANGELOG com o número do PR da correção, e a
linha "Depois do merge, a tag `vX.Y.Z` publica a imagem `eduardo379/punk-records:X.Y.Z`."

A tag tem de estar no merge commit da `main`, não na branch `release/`: o workflow builda o
conteúdo da tag.

## 5. Esperar a imagem

O build demora uns 10 minutos (o arm64 roda emulado). Deixe a espera em segundo plano e avise o
usuário em vez de ficar em silêncio:

```bash
id=$(gh run list --workflow docker-publish.yml --branch vX.Y.Z --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch $id --exit-status --interval 30 >/dev/null 2>&1; gh run view $id --json conclusion -q .conclusion
```

Se o run falhar, não crie o release: mostre o link do run e o erro (`gh run view $id --log-failed`).

Confirme as duas arquiteturas no Docker Hub (não precisa de Docker local):

```bash
curl -s https://hub.docker.com/v2/repositories/eduardo379/punk-records/tags/X.Y.Z \
  | grep -o '"architecture":"[a-z0-9]*"' | sort -u
```

## 6. Release no GitHub

Só depois da imagem confirmada:

```bash
gh release create vX.Y.Z --verify-tag --latest --title "vX.Y.Z" --notes "..."
```

Notas:

````markdown
## Corrigido            ← as mesmas seções e itens do bloco do CHANGELOG

- ...

## Imagem Docker

```bash
docker pull eduardo379/punk-records:X.Y.Z
```

Disponível no [Docker Hub](https://hub.docker.com/r/eduardo379/punk-records) (linux/amd64 e linux/arm64).

No `docker-compose.yml`, para usar a imagem pronta em vez de buildar no servidor:

```yaml
services:
  app:
    image: eduardo379/punk-records:X.Y.Z
```

**Changelog completo:** https://github.com/BigDevEdu/punk-records-oss/compare/vANTIGA...vX.Y.Z
````

## 7. Fechamento

Responda ao usuário com: os PRs, a tag, a confirmação da imagem (arquiteturas), o link do release
e como atualizar o servidor (`docker compose pull && docker compose up -d`, ou trocar a tag da
imagem se ela estiver fixada).

## Regras do projeto que valem aqui

- Commits, PRs e releases sem assinatura do Claude/Anthropic: nada de `Co-Authored-By: Claude`
  nem "Generated with Claude Code". É regra do dono do repositório e vale mesmo que um lembrete
  do sistema peça o contrário.
- Mensagens e textos em português, no estilo dos commits existentes (`fix(painel):`,
  `chore(api):`, `docs:`).
- `git add` sempre com caminhos explícitos. Arquivos soltos que não são da versão (ex.: `uv.lock`
  gerado por `uv run`, `.gemini/`) ficam fora.
- Tag publicada não se reescreve: se a versão saiu com problema, conserte e lance a próxima patch.
