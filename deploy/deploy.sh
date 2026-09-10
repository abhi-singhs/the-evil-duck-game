#!/usr/bin/env bash
# Creates or updates the Azure deployment for The evil duck. Safe to re-run.
#
#   ./deploy/deploy.sh            build a new image and roll it out
#   TAG=v3 ./deploy/deploy.sh     build and deploy with a specific tag
#
# Needs the Azure CLI, a logged-in account (`az login`), and the containerapp
# extension, which the script installs if it is missing.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=azure.env
source "$root/deploy/azure.env"

: "${RESOURCE_GROUP:?}" "${LOCATION:?}" "${REGISTRY:?}" "${ENVIRONMENT:?}" "${APP:?}"
DEPLOY_MODE=${DEPLOY_MODE:-provision}
case "$DEPLOY_MODE" in
  provision|update-only) ;;
  *) echo "DEPLOY_MODE must be provision or update-only" >&2; exit 1 ;;
esac
source_sha=$(git -C "$root" rev-parse HEAD)
if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "Commit source changes before building an image with revision metadata." >&2
  exit 1
fi
if [ "$DEPLOY_MODE" = update-only ]; then
  branch=$(git -C "$root" symbolic-ref --short HEAD)
  if ! remote_ref=$(git -C "$root" ls-remote --exit-code origin "refs/heads/$branch"); then
    echo "Cannot read the release branch on origin. Push it and confirm GitHub access before deploying." >&2
    exit 1
  fi
  remote_sha=$(printf '%s' "$remote_ref" | cut -f1)
  if [ "$remote_sha" != "$source_sha" ]; then
    echo "Push the current branch before deploying it." >&2
    exit 1
  fi
fi
TAG=${TAG:-${source_sha:0:12}-$(date -u +%Y%m%d%H%M%S)}
image="$REGISTRY.azurecr.io/$IMAGE:$TAG"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Target"
az account show --query name -o tsv
printf 'app %s, resource group %s, image %s, revision %s\n' "$APP" "$RESOURCE_GROUP" "$image" "$source_sha"

if [ "$DEPLOY_MODE" = update-only ]; then
  say "Require existing resources"
  az extension show --name containerapp --output none
  az acr show --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" --output none
  az containerapp env show --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --output none
  current=$(az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" --output json)
  printf '%s' "$current" | node --input-type=module -e '
    let raw = ""; for await (const chunk of process.stdin) raw += chunk;
    const app = JSON.parse(raw).properties;
    if (app.configuration.activeRevisionsMode !== "Single"
      || app.template.scale.minReplicas !== 1 || app.template.scale.maxReplicas !== 1) {
      console.error("The game requires single-revision routing and exactly one replica.");
      process.exit(1);
    }
  '
else
  say "Extension"
  if ! az extension show --name containerapp --output none 2>/dev/null; then
    az extension add --name containerapp --only-show-errors
  fi

  say "Resource group $RESOURCE_GROUP"
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

  say "Registry $REGISTRY"
  if ! az acr show --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
    az acr create --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" \
      --sku Basic --location "$LOCATION" --output none
  fi
fi

# Build in ACR, not locally. A docker build on an Apple Silicon machine produces
# an arm64 image and Container Apps will not start it.
say "Build $image"
az acr build --registry "$REGISTRY" --image "$IMAGE:$TAG" --platform linux/amd64 \
  --build-arg "SOURCE_REVISION=$source_sha" --file Dockerfile "$root"

if [ "$DEPLOY_MODE" = provision ] && ! az containerapp env show --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  say "Environment $ENVIRONMENT"
  az containerapp env create --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" --logs-destination none --output none
fi

if az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  say "Update $APP"
  az containerapp update --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --image "$image" --output none
else
  if [ "$DEPLOY_MODE" = update-only ]; then
    echo "The app disappeared. Update-only mode will not create it." >&2
    exit 1
  fi
  say "Create $APP"
  # First create pulls with the registry's admin user because the app has no
  # identity yet. Both are turned off again a few lines down.
  az acr update --name "$REGISTRY" --admin-enabled true --output none
  az containerapp create --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" --image "$image" \
    --registry-server "$REGISTRY.azurecr.io" \
    --registry-username "$REGISTRY" \
    --registry-password "$(az acr credential show --name "$REGISTRY" --query 'passwords[0].value' -o tsv)" \
    --target-port "$PORT" --ingress external --transport auto \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
    --cpu "$CPU" --memory "$MEMORY" --output none

  say "Managed identity pull"
  principal=$(az containerapp identity assign --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --system-assigned --query principalId -o tsv)
  az role assignment create --assignee-object-id "$principal" \
    --assignee-principal-type ServicePrincipal --role AcrPull \
    --scope "$(az acr show --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" --query id -o tsv)" \
    --output none
  sleep 20
  az containerapp registry set --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --server "$REGISTRY.azurecr.io" --identity system --output none
  az acr update --name "$REGISTRY" --admin-enabled false --output none
fi

say "Wait for the new revision"
ready=false
for attempt in $(seq 1 60); do
  current=$(az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" --output json)
  if printf '%s' "$current" | EXPECTED_IMAGE="$image" node --input-type=module -e '
    let raw = ""; for await (const chunk of process.stdin) raw += chunk;
    const app = JSON.parse(raw).properties;
    process.exit(typeof app.latestRevisionName === "string" && app.latestRevisionName.length > 0
      && app.latestReadyRevisionName === app.latestRevisionName
      && app.template.containers[0].image === process.env.EXPECTED_IMAGE
      && app.provisioningState === "Succeeded" ? 0 : 1);
  '; then
    ready=true
    break
  fi
  sleep 5
done
[ "$ready" = true ] || { echo "The new image did not become ready." >&2; exit 1; }

fqdn=$(az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

say "Verify"
health=$(curl -fsS --max-time 15 "https://$fqdn/healthz")
[ "$health" = ok ] || { echo "Unexpected health response: $health" >&2; exit 1; }
index=$(curl -fsS --max-time 15 -o /dev/null -w '%{http_code}' "https://$fqdn/")
[ "$index" = 200 ] || { echo "Unexpected index status: $index" >&2; exit 1; }
revision=$(curl -fsS --max-time 15 "https://$fqdn/version" | node --input-type=module -e '
  let raw = ""; for await (const chunk of process.stdin) raw += chunk;
  console.log(JSON.parse(raw).revision);
')
[ "$revision" = "$source_sha" ] || { echo "Wrong deployed revision: $revision" >&2; exit 1; }
# Safari refuses to play the music unless the server answers byte ranges.
audio=$(curl -fsS --max-time 15 -r 0-99 -o /dev/null -w '%{http_code}' "https://$fqdn/audio/chibi-ninja.mp3")
[ "$audio" = 206 ] || { echo "Unexpected audio range status: $audio" >&2; exit 1; }
# Co-op lives or dies on the upgrade handshake, so check it rather than assume the ingress passes it.
# Force HTTP/1.1: curl negotiates HTTP/2 over TLS by default, and an h2 request cannot carry an
# HTTP/1.1 Upgrade, so it would report the plain GET response and look like a broken deployment.
# A successful upgrade then holds the connection open, hence the timeout and the tolerated exit code.
set +e
socket=$(curl -s -o /dev/null --http1.1 --max-time 6 -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$fqdn/ws")
socket_exit=$?
set -e
[ "$socket_exit" = 0 ] || [ "$socket_exit" = 28 ] || { echo "WebSocket request failed: $socket_exit" >&2; exit 1; }
[ "$socket" = "101" ] || { echo "the game endpoint did not upgrade" >&2; exit 1; }

printf 'health ok, index %s, audio %s, websocket %s, source %s\n' "$index" "$audio" "$socket" "$revision"
az acr repository show --name "$REGISTRY" --image "$IMAGE:$TAG" --query digest --output tsv
say "Live at https://$fqdn"
