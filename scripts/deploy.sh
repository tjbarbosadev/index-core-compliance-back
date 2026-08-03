#!/usr/bin/env bash
# Deploy OpCore admin API on dl3809 (Docker + Caddy network).
# Expects: repo at DEPLOY_DIR, .env present, docker available.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/projects/opcore/api}"
IMAGE="${IMAGE:-opcore-admin-api:latest}"
CONTAINER="${CONTAINER:-opcore-admin-api}"
NETWORK="${NETWORK:-caddy}"
CADDY_HOST="${CADDY_HOST:-api.admin.opcore.com.br}"
VOLUME="${VOLUME:-opcore_admin_storage}"
GIT_REF="${GIT_REF:-origin/main}"

cd "$DEPLOY_DIR"

echo "[deploy-api] fetching $GIT_REF"
git fetch origin
git reset --hard "$GIT_REF"

echo "[deploy-api] building $IMAGE"
docker build -t "$IMAGE" .

echo "[deploy-api] prisma migrate deploy"
docker run --rm --network "$NETWORK" --env-file .env \
  "$IMAGE" \
  npx prisma migrate deploy

echo "[deploy-api] recreating $CONTAINER"
docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --env-file .env \
  -e TZ=America/Sao_Paulo \
  -v "${VOLUME}:/app/storage" \
  -l "caddy=${CADDY_HOST}" \
  -l 'caddy.reverse_proxy={{upstreams 3001}}' \
  "$IMAGE"

echo "[deploy-api] health check"
sleep 3
docker run --rm --network "$NETWORK" curlimages/curl:8.5.0 \
  -fsS --retry 8 --retry-delay 2 "http://${CONTAINER}:3001/health"

echo "[deploy-api] prune dangling images"
docker image prune -f >/dev/null

echo "[deploy-api] done"
