#!/bin/sh
# Block until the requested Compose services are actually ready.
#
#   ./scripts/wait-for-services.sh                  # postgres minio api
#   ./scripts/wait-for-services.sh postgres minio   # skip the API
#
# `docker compose up -d` returning does not mean a service can serve traffic.
# Migrations, seeds and pipeline runs need this distinction, and so does CI.
set -eu

TIMEOUT="${WAIT_TIMEOUT_SECONDS:-120}"
INTERVAL="${WAIT_INTERVAL_SECONDS:-2}"

MINIO_URL="${MINIO_HEALTH_URL:-http://localhost:${MINIO_API_HOST_PORT:-9000}/minio/health/live}"
API_URL="${API_HEALTH_URL:-http://localhost:${API_HOST_PORT:-4000}/health}"

SERVICES="${*:-postgres minio api}"

wait_for() {
  name="$1"
  shift

  printf '==> waiting for %s ' "$name"
  elapsed=0

  while ! "$@" >/dev/null 2>&1; do
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      printf 'TIMED OUT after %ss\n' "$TIMEOUT"
      printf '    last check: %s\n' "$*"
      return 1
    fi
    printf '.'
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done

  printf ' ready\n'
}

check_postgres() {
  # Credentials are read inside the container so they never appear in host
  # process arguments.
  docker compose exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

check_minio() {
  curl -sf "$MINIO_URL"
}

check_api() {
  # /health returns 503 until PostgreSQL is reachable, so -f is the whole test.
  curl -sf "$API_URL"
}

for service in $SERVICES; do
  case "$service" in
    postgres) wait_for postgres check_postgres ;;
    minio)    wait_for minio check_minio ;;
    api)      wait_for api check_api ;;
    *)
      printf 'unknown service: %s\n' "$service" >&2
      printf 'expected one or more of: postgres minio api\n' >&2
      exit 2
      ;;
  esac
done

printf '==> all requested services are ready\n'
