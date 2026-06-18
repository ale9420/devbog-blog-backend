#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

echo "==> Building admin panel..."
npm run build

echo "==> Creating uploads directory on VPS..."
ssh "$REMOTE_HOST" "mkdir -p '${UPLOAD_PATH:-/var/www/devbog-blog-backend/uploads}'"

echo "==> Syncing files to VPS..."
rsync -avz \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.tmp/' \
  --exclude='uploads/' \
  --exclude='package-lock.json' \
  --exclude='.strapi-updater.json' \
  --exclude='coverage/' \
  --exclude='.strapi/' \
  ./ "$REMOTE_HOST:$REMOTE_DEPLOY_PATH"

echo "==> Deploy complete!"
echo "==> Next: SSH to VPS and run: pm2 restart strapi-app"
