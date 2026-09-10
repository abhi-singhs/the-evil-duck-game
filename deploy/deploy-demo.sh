#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "Usage: ./deploy/deploy-demo.sh" >&2
  exit 1
fi

if [ "${APP:-ca-evil-duck-demo}" != ca-evil-duck-demo ] \
  || [ "${IMAGE:-evil-duck-demo}" != evil-duck-demo ] \
  || [ "${RESOURCE_GROUP:-rg-abhising-tad-demo}" != rg-abhising-tad-demo ] \
  || [ "${REGISTRY:-acrevilduck109048529}" != acrevilduck109048529 ] \
  || [ "${ENVIRONMENT:-cae-evil-duck}" != cae-evil-duck ] \
  || [ "${DEPLOY_MODE:-update-only}" != update-only ]; then
  echo "The demo command only updates the approved demo app and image repository." >&2
  exit 1
fi

export APP=ca-evil-duck-demo IMAGE=evil-duck-demo
export RESOURCE_GROUP=rg-abhising-tad-demo REGISTRY=acrevilduck109048529 ENVIRONMENT=cae-evil-duck
export DEPLOY_MODE=update-only
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh"
