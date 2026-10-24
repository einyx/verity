#!/usr/bin/env bash
# Opens a tunnel from this machine to the Kubo portal through an operator-configured SSH host.
# Set DEV_CLOUD_SSH_HOST to the SSH alias that can reach the kind cluster.
set -euo pipefail
: "${DEV_CLOUD_SSH_HOST:?Set DEV_CLOUD_SSH_HOST to your SSH host alias}"
MINI="${DEV_CLOUD_SSH_HOST}"

PORT="19091"
PORTAL_PORT="19091"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if listening "${PORT}"; then
  exit 0
fi

# The portal is a ClusterIP service, so kubectl on mini forwards it. The forward uses the kind kubeconfig
# only, never mini's default context.
ssh -o BatchMode=yes "${MINI}" "pkill -f 'port-forward svc/kubo-portal ${PORTAL_PORT}:9090' 2>/dev/null; nohup env KUBECONFIG=\$HOME/.kubo-kind/kubeconfig kubectl -n kubo-system port-forward svc/kubo-portal ${PORTAL_PORT}:9090 --address 127.0.0.1 >/tmp/kubo-portal-forward.log 2>&1 &"
sleep 3

ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -L "${PORT}:localhost:${PORTAL_PORT}" "${MINI}"
echo "Kubo portal tunnel open on 127.0.0.1:${PORT}"
