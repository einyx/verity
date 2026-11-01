#!/usr/bin/env python3
"""Provision only the dedicated key through the existing short-lived Vault seed role.

No credentials are printed, persisted locally, or passed in process arguments.
The KV CAS guard prevents overwriting an existing key on rerun.
"""

import json
import secrets
import select
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    if sys.argv[1:] != ["--provision"]:
        raise RuntimeError("explicit --provision required")
    kubectl = [
        "kubectl", "--context",
        "az-vel-app-data-demo-uaen-aks-1.mahi-tortoise.ts.net",
    ]
    jwt = subprocess.run(
        kubectl + ["-n", "foundation", "create", "token", "vault-seed-registry", "--duration=600s"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    forward = subprocess.Popen(
        kubectl + ["-n", "foundation", "port-forward", "--address=127.0.0.1", "service/vault", f"{port}:8200"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    token = None
    base = f"http://127.0.0.1:{port}/v1/"

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(path, body=None, authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["X-Vault-Token"] = token
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=data, headers=headers)
        with opener.open(req, timeout=10) as response:
            content = response.read()
            return json.loads(content) if content else {}

    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if forward.poll() is not None:
                raise RuntimeError("Vault tunnel unavailable")
            if select.select([forward.stdout], [], [], 0.1)[0]:
                line = forward.stdout.readline().strip()
                if line == f"Forwarding from 127.0.0.1:{port} -> 8200":
                    break
        else:
            raise RuntimeError("Vault tunnel timeout")
        result = request("auth/kubernetes/login", {"role": "vault-seed-registry", "jwt": jwt}, False)
        token = result["auth"]["client_token"]
        if not 0 < result["auth"]["lease_duration"] <= 300:
            raise RuntimeError("unexpected Vault lease duration")
        # The existing role may issue renewable tokens. This script never renews and requires
        # confirmed revocation; the initial TTL is not claimed as a hard lifetime cap.
        try:
            existing = request("secret/metadata/auth/disposable-email-validator")
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        else:
            print(json.dumps({"path": "secret/auth/disposable-email-validator", "created": False,
                              "version": existing["data"]["current_version"]}))
            return
        result = request("secret/data/auth/disposable-email-validator", {
            "options": {"cas": 0}, "data": {"key": secrets.token_hex(32)},
        })
        print(json.dumps({"path": "secret/auth/disposable-email-validator", "created": True,
                          "version": result["data"]["version"]}))
    finally:
        revoke_failed = False
        if token:
            try:
                request("auth/token/revoke-self", {})
            except Exception:
                print("Vault token revocation unconfirmed; operator recovery required", file=sys.stderr)
                revoke_failed = True
        forward.terminate()
        try:
            forward.wait(timeout=5)
        except subprocess.TimeoutExpired:
            forward.kill()
            forward.wait()
        if revoke_failed:
            raise RuntimeError("Vault token revocation failed") from None


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose HTTP bodies, subprocess output, token material, or traces.
        print("Dedicated validator key provisioning failed", file=sys.stderr)
        sys.exit(1)
