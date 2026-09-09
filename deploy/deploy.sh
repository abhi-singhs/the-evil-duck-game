#!/usr/bin/env bash
# Creates or updates the Azure deployment for The evil duck. Safe to re-run.
#
#   ./deploy/deploy.sh            build a new image and roll it out
#   TAG=v3 ./deploy/deploy.sh     deploy a specific tag
#
# Needs the Azure CLI, a logged-in account (`az login`), and the containerapp
# extension, which the script installs if it is missing.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=azure.env
source "$root/deploy/azure.env"

: "${RESOURCE_GROUP:?}" "${LOCATION:?}" "${REGISTRY:?}" "${ENVIRONMENT:?}" "${APP:?}"
TAG=${TAG:-$(git -C "$root" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}
image="$REGISTRY.azurecr.io/$IMAGE:$TAG"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Subscription"
az account show --query "{name:name, user:user.name}" -o tsv

say "Extension"
az extension add --name containerapp --upgrade --only-show-errors

say "Resource group $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

say "Registry $REGISTRY"
if ! az acr show --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az acr create --name "$REGISTRY" --resource-group "$RESOURCE_GROUP" \
    --sku Basic --location "$LOCATION" --output none
fi

# Build in ACR, not locally. A docker build on an Apple Silicon machine produces
# an arm64 image and Container Apps will not start it.
say "Build $image"
az acr build --registry "$REGISTRY" --image "$IMAGE:$TAG" --platform linux/amd64 --file Dockerfile "$root"

say "Environment $ENVIRONMENT"
if ! az containerapp env show --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp env create --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" --logs-destination none --output none
fi

if az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  say "Update $APP"
  az containerapp update --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --image "$image" --output none
else
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

fqdn=$(az containerapp show --name "$APP" --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

say "Verify"
curl -fsS -o /dev/null -w 'health %{http_code} in %{time_total}s\n' "https://$fqdn/healthz"
curl -fsS -o /dev/null -w 'index  %{http_code} in %{time_total}s\n' "https://$fqdn/"
# Safari refuses to play the music unless the server answers byte ranges.
curl -fsS -r 0-99 -o /dev/null -w 'audio  %{http_code} (expect 206)\n' "https://$fqdn/audio/chibi-ninja.mp3"

say "Live at https://$fqdn"
