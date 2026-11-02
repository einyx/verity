#!/bin/sh
set -eu
# Private production recipe; deliberately does not change OSS Dockerfile defaults.
# Caller supplies a private image tag, builder options and BuildKit secret. Never pushes.
image=${1:?Usage: build-cloud-image.sh PRIVATE_IMAGE [buildx options]}
shift
case "$image" in meshxcloudacr.azurecr.io/kubo/logto:*) ;; *) echo 'Private Logto registry required' >&2; exit 1 ;; esac
"${BUILDX:-docker-buildx}" build "$@" --file Dockerfile.acr \
  --tag "$image" --load --build-arg is_cloud=1 --build-arg dev_features_enabled=1 .
artifact=$(mktemp "${TMPDIR:-/tmp}/cloud-console.XXXXXX")
trap 'rm -f "$artifact"' EXIT HUP INT TERM
docker run --rm --network none --entrypoint node "$image" -e '
const fs=require("fs");const root="/etc/logto/packages/console/dist";
const entry=fs.readFileSync(root+"/index.html","utf8").match(/<script[^>]+src="([^"]+)"/)[1];
process.stdout.write(fs.readFileSync(root+entry.replace(/^\/console/,"")));
' > "$artifact"
node .scripts/verify-cloud-console.mjs "$artifact"
