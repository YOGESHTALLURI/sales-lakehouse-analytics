# syntax=docker/dockerfile:1

FROM python:3.12-slim AS base
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Dependencies resolve from pyproject alone, so this layer is only rebuilt when
# the manifest changes rather than on every source edit.
COPY etl/pyproject.toml ./pyproject.toml
RUN mkdir -p src/etl && touch src/etl/__init__.py \
 && pip install --no-cache-dir -e ".[dev]"

COPY etl/src ./src
COPY etl/tests ./tests

# The pipeline is a batch job with no HTTP surface: it runs to completion and
# exits, so there is no CMD worth defaulting to a server. Compose invokes it
# explicitly with `docker compose run --rm etl python -m etl.run_pipeline`.
CMD ["python", "-m", "etl.run_pipeline", "--help"]
