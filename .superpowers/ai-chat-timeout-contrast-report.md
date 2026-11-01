# Ask AI timeout / contrast implementation report

Status: DONE_WITH_CONCERNS (known unrelated Leads type-check baseline). Branch `alessio-fix-ai-chat-timeout-contrast`, base `b1277ffc2`. All work and build output stayed in this worktree.

## Changes and interfaces

- `packages/console/src/components/Topbar/AiChat/Conversation.tsx`: per-call `timeout: 180_000` on completions only. Ordinary client, confirm/cancel, credentials, retry policy, runtime abort signal handling and `finally` loading cleanup unchanged. No backend, schema, session persistence, editor, auth policy or account-linking changes.
- `Thread.tsx` + `index.module.scss`: scoped console transcript class pairs `--color-layer-2` with explicit `--color-text` for user bubbles. Shared by workspace and legacy console. Specificity exceeds the global public demo selector regardless of load order; public demo CSS unchanged.
- `Conversation.test.tsx`: real Ky request/timer behavior through the real Conversation adapter; runtime and auth boundaries mocked. Controlled fetch only, no network. 37s completion survives 20s and completes once; stalled completion stays loading through 179,999ms, rejects at 180,000ms and clears loading without retry; confirm and cancel still expire at 20s. Synthetic credential headers and request payload checked.
- `tests/browser/ai-chat-console.spec.ts` + `fixtures/ai-chat.tsx`: isolated localhost Vite harness imports real AiChat, Conversation, Thread, composer, workspace and production theme SCSS. Only environment/auth/API/setup boundaries replaced. Completions intercepted; all other API/write operations forbidden, external requests aborted. Four presentation/theme checks render synthetic replies and measure computed colors. Screenshots use reduced motion for stable capture.
- `.changeset/quiet-heroes-reply.md`: console patch changeset.

## RED / GREEN evidence

Before implementation, `pnpm exec jest src/components/Topbar/AiChat/Conversation.test.tsx --runInBand` produced 2 failed / 2 passed: actual `TimeoutError` after 20s and premature loading cleanup for both completion cases. Initial pnpm invocation unexpectedly attempted its automatic dependency verification/install, which failed because the supplied hoist directory is linked; no dependency, lockfile or configuration changes resulted. All subsequent commands invoke existing binaries directly, with no installers.

Browser RED: `node node_modules/@playwright/test/cli.js test tests/browser/ai-chat-console.spec.ts --workers=1 -g 'workspace dark' --timeout=25000` reproduced real dark bubble contrast **1.111933:1** after harness setup was corrected (refresh preamble, browser `process.env`, and alias matching). These harness-only setup failures did not involve production calls.

GREEN, run from `packages/console`:

| Command | Result |
| --- | --- |
| `node node_modules/jest/bin/jest.js src/components/Topbar/AiChat/Conversation.test.tsx --runInBand` | 4/4 passed; real 37s / 180s / 20s timers |
| `node node_modules/jest/bin/jest.js --maxWorkers=2 --silent` | 145 suites, 867 tests passed; `.superpowers/ai-chat-full-console.log` |
| `node node_modules/@playwright/test/cli.js test tests/browser/ai-chat-console.spec.ts --workers=1 --timeout=25000 --reporter=json` | 4/4 passed; `.superpowers/ai-chat-browser.json` |
| Scoped ESLint (exact invocation below) | Passed after focused test formatting corrections |
| `node ../../node_modules/.pnpm/stylelint@15.11.0_supports-color@10.2.2_typescript@5.9.3/node_modules/stylelint/bin/stylelint.mjs src/components/Topbar/AiChat/index.module.scss` | Passed; existing rule deprecation warnings only |
| `node node_modules/typescript/bin/tsc -p tsconfig.scripts.gen.json` then `node scripts-js/generate-jwt-customizer-type-definition.js` | Passed; generated JWT source ignored; temporary script outputs removed |
| `node node_modules/typescript/bin/tsc --noEmit` | 22 existing Leads errors only, zero errors elsewhere; `.superpowers/ai-chat-types.log` |
| `IS_CLOUD=1 node --max-old-space-size=4096 node_modules/vite/bin/vite.js build -c vite.landing-chat.config.ts` | Passed; `.superpowers/ai-chat-landing-build.log` |
| `IS_CLOUD=1 node --max-old-space-size=4096 node_modules/vite/bin/vite.js build` | Passed; own `packages/console/dist`, `.superpowers/ai-chat-cloud-build.log` |
| `git diff --check` | Passed |

Exact scoped ESLint command:

```sh
NODE_PATH="$(dirname "$(node -p "require.resolve('@silverhand/eslint-config/package.json')")")/../../:$(dirname "$(node -p "require.resolve('@silverhand/eslint-config-react/package.json')")")/../../" node node_modules/eslint/bin/eslint.js src/components/Topbar/AiChat/Conversation.tsx src/components/Topbar/AiChat/Conversation.test.tsx src/components/Topbar/AiChat/Thread.tsx tests/browser/ai-chat-console.spec.ts tests/browser/fixtures/ai-chat.tsx
```

`NODE_PATH` resolves already-present transitive lint dependencies in the linked installation; no config/dependency edits. Cloud build phases invoked directly to avoid pnpm installation behavior. Asset-stamping sync was not run because it rewrites public landing source outside this patch; Vite built/copied current local landing assets normally.

## Computed contrast and screenshots

| Presentation | Theme | Foreground | Background | Ratio |
| --- | --- | --- | --- | --- |
| Workspace | Light | rgb(27,25,25) | rgb(243,243,241) | 15.755167:1 |
| Workspace | Dark | rgb(250,249,247) | rgb(59,58,55) | 10.809512:1 |
| Legacy | Light | rgb(27,25,25) | rgb(243,243,241) | 15.755167:1 |
| Legacy | Dark | rgb(250,249,247) | rgb(59,58,55) | 10.809512:1 |

Screenshots (local ignored output, full-page, four variants):

- `packages/console/test-results/ai-chat-console-workspace--f8d1d--user-bubble-contrast-is-AA-chromium/workspace-light.png`
- `packages/console/test-results/ai-chat-console-workspace--14358--user-bubble-contrast-is-AA-chromium/workspace-dark.png`
- `packages/console/test-results/ai-chat-console-legacy-lig-12cf5--user-bubble-contrast-is-AA-chromium/legacy-light.png`
- `packages/console/test-results/ai-chat-console-legacy-dar-9b6fe--user-bubble-contrast-is-AA-chromium/legacy-dark.png`

## Limitations / safety

- Production 37s HTTP200 log evidence establishes a timeout mismatch, not definitive correlation with the user's exact screenshot request. No real provider was contacted to reproduce it.
- Adapter timing tests mock runtime wiring and auth/client creation, but preserve real Ky timeout implementation. Browser checks additionally exercise the real runtime through a controlled synthetic transport.
- Browser harness deliberately does not mount an editor or use authenticated production content. No save/publish, external messages, real model calls, retries, push or deployment. No Microsoft/account-linking policy change.
- Known baseline type errors remain in Leads, out of scope. Production build has existing bundle-size/compression warnings. Public demo CSS was not changed.
