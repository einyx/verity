#!/usr/bin/env bash
# Runs the cloud dev server with port-forwards through an operator-configured SSH host.
# Set DEV_CLOUD_SSH_HOST to your SSH alias and DEV_CLOUD_KIND_API to the reachable kind API host:port.
# when the dev server exits.
set -euo pipefail
: "${DEV_CLOUD_SSH_HOST:?Set DEV_CLOUD_SSH_HOST to your SSH host alias}"
: "${DEV_CLOUD_KIND_API:?Set DEV_CLOUD_KIND_API to the kind API host:port}"
MINI="${DEV_CLOUD_SSH_HOST}"
KIND_API="${DEV_CLOUD_KIND_API}"

API_PORT="16443"
PORTAL_PORT="19090"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

opened=()

if ! listening "${API_PORT}"; then
  ssh -f -N -o ExitOnForwardFailure=yes -L "${API_PORT}:${KIND_API}" "${MINI}"
  opened+=("ssh -f -N -o ExitOnForwardFailure=yes -L ${API_PORT}:${KIND_API}")
fi

# The portal is a ClusterIP service, so kubectl on mini forwards it. Reuse a forward that is
# already running on mini; otherwise start one, which stays up until it is closed.
if ! ssh "${MINI}" "lsof -nP -iTCP:${PORTAL_PORT} -sTCP:LISTEN >/dev/null 2>&1"; then
  ssh -f -o ExitOnForwardFailure=yes -L "${PORTAL_PORT}:localhost:${PORTAL_PORT}" "${MINI}" \
    "kubectl port-forward -n kubo-system svc/kubo-portal ${PORTAL_PORT}:9090 --address 127.0.0.1" >/dev/null
fi

# Tunnel from this machine to the forward on mini.
if ! listening "${PORTAL_PORT}"; then
  ssh -f -N -o ExitOnForwardFailure=yes -L "${PORTAL_PORT}:localhost:${PORTAL_PORT}" "${MINI}"
  opened+=("ssh -f -N -o ExitOnForwardFailure=yes -L ${PORTAL_PORT}:localhost:${PORTAL_PORT}")
fi

close_tunnels() {
  for cmd in ${opened[@]+"${opened[@]}"}; do
    pkill -f "${cmd}" 2>/dev/null || true
  done
}
trap close_tunnels EXIT

# The Kubo portal tunnel for landing demo requests (KUBO_PORTAL_URL=http://127.0.0.1:19091).
./scripts/dev-kubo-portal.sh

KUBO_PORTAL_URL="http://localhost:${PORTAL_PORT}" pnpm dev
