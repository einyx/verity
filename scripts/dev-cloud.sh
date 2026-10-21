#!/usr/bin/env bash
# Runs the cloud dev server with port-forwards to the kind cluster on mini.local.
# - local 16443 -> the kind API server (kubify-scale-test)
# - local 19090 -> the kubo-portal service in kubo-system, so stack requests reach the portal
# Tunnels that are already listening are reused. Only the tunnels this script opens are closed
# when the dev server exits.
set -euo pipefail

KIND_API="192.168.190.237:8443"
API_PORT="16443"
PORTAL_PORT="19090"
MINI="alessio@mini.local"

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
