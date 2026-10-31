# Optional private cloud package

The replacement cloud implementation lives in private
[`einyx/cloud`](https://github.com/einyx/cloud). Public installs and builds do not
require it. Its existing license notices are preserved; private visibility does
not revoke previously granted licenses or remove public Git history.

## Docker

Both `Dockerfile` and `Dockerfile.acr` include the private package by default,
pinned to the full commit in `.scripts/cloud-plugin-revision`. Supply a GitHub
token with read access to `einyx/cloud` through a BuildKit secret:

```sh
# Export GH_TOKEN securely in your shell or CI secret environment first.
docker build --secret id=cloud_github_token,env=GH_TOKEN -t identity .
```

Without repository access, the default build fails. For an OSS-only image:

```sh
docker build --build-arg include_cloud=0 -t identity-oss .
```

Never pass the token as a build argument or embed it in a Git URL. Checkout uses
an ephemeral secret mount and exports the pinned tree without Git metadata.
The private tree is excluded from Docker's local build context, so a developer's
local checkout cannot accidentally enable the OSS image or replace the pin.

Package presence enables the integration; there is no extra runtime activation
flag. Existing billing/database/Stripe configuration is still required. Without
the package, private billing and periodic-usage middleware are not mounted.
Production never falls back to simulated billing. An installed but broken plugin
is an error, not an OSS fallback.

## Local development

From the public workspace root, with `packages/cloud` absent:

```sh
gh repo clone einyx/cloud packages/cloud
git -C packages/cloud checkout "$(cat .scripts/cloud-plugin-revision)"
```

Add `"@meshx/cloud": "workspace:^"` to `packages/core/package.json` locally, then
run `pnpm install --no-frozen-lockfile` and `pnpm prepack`. This local manifest and
lockfile wiring must not be committed to the public repository. The private
checkout is ignored. Its `@logto/schemas` dependency is provided by this workspace;
it is not currently a standalone installable service repository.

Run `pnpm --filter @meshx/cloud test` for cloud tests. Public development needs no
checkout or manifest changes. Update the revision pin deliberately after testing
host/plugin compatibility; Docker never fetches a floating branch.
