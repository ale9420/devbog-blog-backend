#!/bin/sh
set -eu

BACKUP_ROOT="${BACKUP_DIR:-/backups/devbog}"
DATE="$(date +%Y%m%d-%H%M%S)"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-devbog-blog-backend}"

BACKUP_DIR_DB="${BACKUP_ROOT}/db"
BACKUP_DIR_UPLOADS="${BACKUP_ROOT}/uploads"

mkdir -p "${BACKUP_DIR_DB}" "${BACKUP_DIR_UPLOADS}"

echo "=== DevBog Backup — ${DATE} ==="

DB_CONTAINER="$(docker compose -p "${COMPOSE_PROJECT}" ps -q db 2>/dev/null || true)"
if [ -n "${DB_CONTAINER}" ]; then
  DB_BACKUP="${BACKUP_DIR_DB}/strapi-${DATE}.sql.gz"
  echo "Backing up database → ${DB_BACKUP}"
  docker exec "${DB_CONTAINER}" pg_dump \
    -U "${DATABASE_USERNAME:-strapi}" \
    -d "${DATABASE_NAME:-strapi}" \
    --no-owner --no-privileges \
    | gzip > "${DB_BACKUP}"
  echo "Database backup complete ($(du -h "${DB_BACKUP}" | cut -f1))"
else
  echo "WARNING: db container not found — skipping database backup"
fi

UPLOADS_VOLUME="${COMPOSE_PROJECT}_strapi-uploads"
UPLOADS_BACKUP="${BACKUP_DIR_UPLOADS}/uploads-${DATE}.tar.gz"
if docker volume inspect "${UPLOADS_VOLUME}" >/dev/null 2>&1; then
  echo "Backing up uploads → ${UPLOADS_BACKUP}"
  docker run --rm \
    -v "${UPLOADS_VOLUME}":/source:ro \
    -v "${BACKUP_DIR_UPLOADS}":/backup \
    alpine tar czf "/backup/uploads-${DATE}.tar.gz" -C /source .
  echo "Uploads backup complete ($(du -h "${UPLOADS_BACKUP}" | cut -f1))"
else
  echo "WARNING: volume ${UPLOADS_VOLUME} not found — skipping uploads backup"
fi

echo ""
echo "Cleaning backups older than ${RETENTION_DAYS:-14} days..."
find "${BACKUP_DIR_DB}" -name "*.sql.gz" -mtime "+${RETENTION_DAYS:-14}" -delete 2>/dev/null || true
find "${BACKUP_DIR_UPLOADS}" -name "*.tar.gz" -mtime "+${RETENTION_DAYS:-14}" -delete 2>/dev/null || true

echo ""
echo "=== Backup complete ==="
echo "  DB:       ${BACKUP_DIR_DB}/"
echo "  Uploads:  ${BACKUP_DIR_UPLOADS}/"
ls -lh "${BACKUP_DIR_DB}/" "${BACKUP_DIR_UPLOADS}/" 2>/dev/null || true
