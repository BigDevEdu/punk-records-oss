# Animações do README

Fonte dos GIFs em `docs/imgs/punk-records-*.gif`. Cada página é uma cena isométrica controlada por tempo (`render(t)`), com loop sem emenda; `iso.js` tem a projeção, os objetos e as legendas compartilhados.

Abra o `.html` no navegador para ver o preview. Para gerar de novo (precisa de Google Chrome e ffmpeg):

```sh
cd docs/imgs/anim
uv run --with playwright --with pillow python render.py banner.html --loopcheck --mp4 /tmp/banner.mp4 --gif ../punk-records-banner.gif
```

`--frames 1.5,5,9` salva PNGs desses instantes para conferir. Troque `banner` por `arquitetura`, `isolamento` ou `backup`.
