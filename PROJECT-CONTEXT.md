# Project context

Shared baseline for the team and for AI sessions working in this repo. Keep it short and update it when the state changes.

## Project

- **Name and purpose:** Logto, an open-source identity provider (OIDC / OAuth) with an admin console, a management API, and a landing site.
- **Tech stack:** TypeScript monorepo managed with pnpm. Node.js 22 or 24 at runtime. Koa server, PostgreSQL, a React admin console, and a fork of `oidc-provider`.
- **Current phase:** Post-quantum (ML-DSA-65) OIDC signing keys are on `master`, behind `isDevFeaturesEnabled`. The landing chat and landing leads features are in progress.

## Key constraints

- **Dev features:** new features ship behind `isDevFeaturesEnabled`, with a comment naming the feature. A change that is behind the flag gets no changeset.
- **OpenAPI:** API behavior changes update the OpenAPI document in the same change, with `tags: ["Dev feature"]` or `x-logto-dev-feature: true` for in-development surfaces.
- **Lint suppressions:** every `eslint-disable` and `@ts-expect-error` needs a short reason. Never bypass commit hooks.
- **Localization:** changes under `packages/phrases` sync the other locales in the same change.
- **Shared checkout:** several sessions and people can work in this checkout at once.
  - Commit with explicit pathspecs (`git commit --only -- <paths>`) or from your own worktree.
  - Check `git diff --cached` before committing.
  - Don't commit generated files (for example `tsconfig.build.tsbuildinfo`) or stray files.
  - Don't push a local commit you didn't make without checking with its author.
- **Runtime:** production images build on Node 24. `engines` still declares `^22.14.0 || ^26.0.0`. This mismatch is open.

## What "done" looks like

- The ML-DSA gating has integration tests: a flag-off 422, flag-on advertisement, and seeded-key exclusion.
- The OpenAPI document covers the ML-DSA surface, with the right dev-feature markers.
- `Tenant.ts` meets the file-size limit, and its lint suppressions have reasons.
- The landing chat retry implementation is decided, and the other one is removed.
- Lint, typecheck, and the affected test suites pass on the branch being pushed.

## Open decisions

1. Node version for production: keep Node 24 and update `engines`, or move the images back to Node 22?
2. Landing chat retry: keep the loop from `#43`, or the recursive `askModel`?
3. Was the signing commit (`4e993c811`) meant to land directly on `master`? The tests and OpenAPI changes should go out as a follow-up.
