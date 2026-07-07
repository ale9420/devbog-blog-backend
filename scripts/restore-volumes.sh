#!/bin/sh
set -eu

BACKUP_ROOT="${BACKUP_DIR:-/backups/devbog}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-devbog-blog-backend}"

usage() {
  echo "Usage: $0 <backup-date>"
  echo ""
  echo "  backup-date  Format: YYYYMMDD-HHMMSS (e.g. 20250106-143000)"
  echo "               Use 'latest' to restore the most recent backup."
  echo ""
  echo "Environment variables:"
  echo "  BACKUP_DIR        Backup root directory (default: /backups/devbog)"
  echo "  COMPOSE_PROJECT   Docker Compose project name (default: devbog-blog-backend)"
  echo "  DATABASE_USERNAME  Postgres user (default: strapi)"
  echo "  DATABASE_NAME     Postgres database (default: strapi)"
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

INPUT="$1"

if [ "${INPUT}" = "latest" ]; then
  DB_FILE="$(ls -t "${BACKUP_ROOT}/db"/strapi-*.sql.gz 2>/dev/null | head -1)"
  UPLOADS_FILE="$(ls -t "${BACKUP_ROOT}/uploads"/uploads-*.tar.gz 2>/dev/null | head -1)"

  if [ -z "${DB_FILE}" ] && [ -z "${UPLOADS_FILE}" ]; then
    echo "ERROR: No backups found in ${BACKUP_ROOT}"
    exit 1
  fi

  DB_BACKUP="${DB_FILE}"
  UPLOADS_BACKUP="${UPLOADS_FILE}"
  echo "Restoring latest backup:"
else
  DATE="${INPUT}"
  DB_BACKUP="${BACKUP_ROOT}/db/strapi-${DATE}.sql.gz"
  UPLOADS_BACKUP="${BACKUP_ROOT}/uploads/uploads-${DATE}.tar.gz"

  if [ ! -f "${DB_BACKUP}" ] && [ ! -f "${UPLOADS_BACKUP}" ]; then
    echo "ERROR: No backup found for date ${DATE}"
    echo "Expected:"
    echo "  ${DB_BACKUP}"
    echo "  ${UPLOADS_BACKUP}"
    exit 1
  fi

  echo "Restoring backup for ${DATE}:"
fi

[ -f "${DB_BACKUP:-/dev/null}" ] && echo "  DB:       ${DB_BACKUP}" || echo "  DB:       (not found, skipping)"
[ -f "${UPLOADS_BACKUP:-/dev/null}" ] && echo "  Uploads:  ${UPLOADS_BACKUP}" || echo "  Uploads:  (not found, skipping)"
echo ""

read -r -p "This will OVERWRITE current data. Continue? [y/N] " confirm
if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

DB_CONTAINER="$(docker compose -p "${COMPOSE_PROJECT}" ps -q db 2>/dev/null || true)"

if [ -f "${DB_BACKUP:-/dev/null}" ] && [ -n "${DB_CONTAINER}" ]; then
  echo "Restoring database..."
  docker compose -p "${COMPOSE_PROJECT}" stop strapi 2>/dev/null || true

  docker exec "${DB_CONTAINER}" psql \
    -U "${DATABASE_USERNAME:-strapi}" \
    -d "${DATABASE_NAME:-strapi}" \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE_NAME:-strapi}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true

  docker exec "${DB_CONTAINER}" psql \
    -U "${DATABASE_USERNAME:-strapi}" \
    -d "${DATABASE_NAME:-strapi}" \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1

  gunzip -c "${DB_BACKUP}" | docker exec -i "${DB_CONTAINER}" psql \
    -U "${DATABASE_USERNAME:-strapi}" \
    -d "${DATABASE_NAME:-strapi}" >/dev/null 2>&1

  echo "Database restored."
elif [ -f "${DB_BACKUP:-/dev/null}" ]; then
  echo "WARNING: db container not found — skipping database restore"
fi

UPLOADS_VOLUME="${COMPOSE_PROJECT}_strapi-uploads"
if [ -f "${UPLOADS_BACKUP:-/dev/null}" ]; then
  if docker volume inspect "${UPLOADS_VOLUME}" >/dev/null 2>&1; then
    echo "Restoring uploads..."
    docker run --rm \
      -v "${UPLOADS_VOLUME}":/target \
      -v "${BACKUP_ROOT}/uploads":/backup:ro \
      alpine sh -c "rm -rf /target/* && tar xzf /backup/uploads-$(basename "${UPLOADS_BACKUP}" | sed 's/uploads-//;s/.tar.gz//').tar.gz -C /target"
    echo "Uploads restored."
  else
    echo "WARNING: volume ${UPLOADS_VOLUME} not found — skipping uploads restore"
  fi
fi

if [ -n "${DB_CONTAINER}" ]; then
  echo "Restarting Strapi..."
  docker compose -p "${COMPOSE_PROJECT}" up -d strapi
fi

echo ""
echo "=== Restore complete ==="
