#!/bin/sh
# Provision the raw data lake bucket. Idempotent by design: Compose runs this
# one-shot service on every `up`, and re-running it must never disturb objects
# that previous pipeline runs already wrote.
set -eu

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${LAKE_BUCKET:?LAKE_BUCKET is required}"

ALIAS="lake"

echo "==> registering MinIO alias for ${MINIO_ENDPOINT}"
mc alias set "${ALIAS}" "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null

echo "==> ensuring bucket ${LAKE_BUCKET} exists"
mc mb --ignore-existing "${ALIAS}/${LAKE_BUCKET}"

# Object versioning reinforces the append-only contract: even an accidental
# overwrite keeps the original raw extract retrievable.
echo "==> enabling object versioning on ${LAKE_BUCKET}"
mc version enable "${ALIAS}/${LAKE_BUCKET}"

echo "==> lake bucket ready"
mc ls "${ALIAS}/${LAKE_BUCKET}"
