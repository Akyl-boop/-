# syntax=docker/dockerfile:1.7
FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# postgresql-client → pg_dump / pg_restore for backups; tini → proper signal handling
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client curl tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cached layer — only invalidated when pyproject.toml changes)
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
 && pip install -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /app/storage/media /app/storage/backups \
 && chmod +x /app/docker-entrypoint.sh \
 && chown -R app:app /app
USER app

EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["api"]
