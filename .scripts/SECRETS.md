# Repository secret and private-file checks

Install Gitleaks 8.27 or newer before committing (`brew install gitleaks` on macOS;
see the official Gitleaks installation instructions for other platforms).

The Husky pre-commit hook first runs `check-staged-secrets.sh`, then the existing
package lint/type checks. The guard rejects private paths anywhere in the Git
index, including already tracked files, then scans staged changes with Gitleaks.
It redacts findings and blocks on detections, scanner errors, or a missing tool.
It does not download tools, modify files, scan unstaged local credentials, or
rewrite history. Node is required as well as Gitleaks.

If a detection is a real credential, remove it from the staged content and revoke
or rotate it if it has already been exposed. Redaction of scanner output does not
remove a credential from Git. Treat fixture/example detections as findings to
review rather than disabling the hook. Inline `gitleaks:allow` comments and
repository `.gitleaksignore` files do not bypass the check. Both the local and CI
scan use the default upstream detectors from `.scripts/gitleaks-ci.toml` with no
repository-wide fixture allowlists or historical baseline.

Run `node --test .scripts/check-staged-secrets.test.js .scripts/check-private-files.test.js`
for regression tests, or run `pnpm test:scripts` for all root script tests.
Real-scanner tests are skipped when Gitleaks is missing; the missing-tool and
scanner-failure tests still run. Test keys are generated in temporary repositories,
not stored in this repository.

Ignore rules keep local environment variants, captures, reports, session exports,
and temporary probes out of ordinary `git add`. Environment templates remain
addable. Ignore rules do not untrack existing files or remove historical copies.

## Private-file policy

Keep agent session exports, local environment files, private keys, browser
authentication state/profiles, recordings, dumps, and assessment artifacts
outside the repository. The canonical denylist lives in `check-private-files.js`.
Agent configuration and instructions are private too, including Claude, Codex,
OpenCode, Cursor, other supported tool directories, `AGENTS.md`, `CLAUDE.md`,
`CODEX.md`, MCP configuration, and GitHub Copilot instructions/prompts/agents.
The former `.claude/commands/` exception is removed. Superpowers documentation,
agent plans/specs under `docs/`, and root `plans/`/`specs/` are excluded without
excluding ordinary product documentation, application source, or API schemas.
The root `PROJECT-CONTEXT.md`, `docs/ask-ai-management-plan.md`, and the
`docs/landing-cms-editor/` planning archive are also private and blocked by the
index guard.
Root `artifacts/`, `recordings/`, `playwright-report/`, and `test-results/` are
private; normal source assets and documentation are not globally excluded.
Environment templates (`.env.example`, `.env.sample`, `.env.template`) remain
allowed, but their contents still undergo secret scanning. Do not place real
credentials in templates or reuse public test keys for deployments.

Ignore rules only help with ordinary `git add`. The index guard also blocks
`git add -f` and detects existing tracked private files. Move a file outside Git
or remove it from tracking without deleting its local copy; do not weaken the
guard to admit private artifacts. A staged removal is allowed.

## CI enforcement

`repository-security.yml` runs **Incoming secrets and private files** for every
pull request and pushes to `master`. It uses read-only repository permissions,
no provider credentials, no persisted checkout credentials, SHA-pinned actions,
and a version-pinned, checksum-verified Gitleaks binary. No dependency install
or application build is needed. It does not use `pull_request_target`.

The shared incoming guard checks the complete trees of incoming commits for
private paths, and Gitleaks scans their added content. A secret or export added
and then removed before the final commit is still blocked. Existing fixture
matches in older history are not globally allowlisted or rescanned on every PR.
Missing heads, invalid commit IDs, and missing tools fail closed. After a force
push/history rewrite, an unavailable old base widens both checks to the head's
full reachable history instead of skipping the scan. The same full-history
check applies to an initial push with an all-zero base. This may surface older
fixture detections that require review; no broad baseline is automatically applied.

To reproduce locally, use full commit IDs:

```sh
sh .scripts/check-incoming-secrets.sh BASE_SHA HEAD_SHA
```

The workflow definition is not itself a branch-protection rule. In GitHub,
require **Incoming secrets and private files**, restrict direct pushes and
bypasses, and require trusted review for workflow/security-guard changes.
Enable GitHub secret scanning and push protection where supported. Those
repository settings are not enabled by adding these files. CI scans after
upload, so it cannot replace server-side push protection or credential rotation.

Keep temporary agent output outside the repository by default. Any public test
credentials must be disposable and never reused for production. Real exposed
credentials must be revoked/rotated at the issuer even after history cleanup.
Ad-hoc browser probes named `packages/console/verify-*.mjs` are private local
tools too; checked-in browser regression tests should use the existing test
directories rather than publishing local sign-in or device-verification scripts.
