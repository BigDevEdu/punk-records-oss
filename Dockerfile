FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PR_HOST=0.0.0.0 \
    PR_STORAGE_DIR=/data \
    PR_AGENTS_FILE=/config/agents.yaml \
    HF_HOME=/models

WORKDIR /app
COPY pyproject.toml ./
COPY punk_records ./punk_records

# torch CPU antes do pip install: evita as wheels CUDA (vários GB).
# git só existe para o epochdb (dependência git) e sai na mesma camada.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir . \
 && apt-get purge -y --auto-remove git \
 && rm -rf /var/lib/apt/lists/*

# Modelo de embedding baixado no build (não no boot), legível pelo usuário não-root.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')" \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin punk \
 && mkdir -p /data \
 && chown -R 10001:10001 /data /models

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"

CMD ["punk-records", "serve"]
