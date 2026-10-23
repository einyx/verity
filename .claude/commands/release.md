---
description: Bump, tag, and publish a release with MeshX artwork and changelog
argument-hint: [version, e.g. 1.46.0; defaults to the version the changesets imply]
---

Release `$ARGUMENTS`, or the next version implied by the pending changesets when no argument is given.

This repo versions with changesets. `.scripts/version.js` runs `changeset version`, updates every package, and refreshes the lockfile. The command has two modes, chosen by the state of the repo.

## Choose the mode

- Read the target version: the argument, or the bump implied by `.changeset/*.md`. A `minor` on `@logto/core` means a minor release.
- If `v<version>` does not exist and `.changeset/` has pending entries, run **Bump mode**.
- Otherwise run **Publish mode**.

## Bump mode (version PR)

1. Preflight: `git branch --show-current` is `master`, `git status --porcelain --untracked-files=no` is empty, and `git fetch origin` shows `HEAD` equal to `origin/master`.
2. Create the branch `<github-user>-release-v<version-with-dashes>`, for example `einyx-release-v1-46-0`. The name is lowercase kebab-case with no `/`.
3. Install if `node_modules` is missing: `pnpm install --frozen-lockfile` with pnpm 10. If the local pnpm shim is broken, use `npx -y pnpm@10`.
4. Run `node .scripts/version.js`. Check that `packages/core/package.json` now shows the target version and that `packages/core/CHANGELOG.md` has a section for it.
5. Commit with `release: version packages`. Do not add co-author lines. Do not skip hooks.
6. Push the branch and open a PR with `gh pr create` titled `release: version packages`. Stop here and tell the user to merge it. Do not tag before the PR is merged.

## Publish mode (tag and GitHub release)

1. Preflight: on `master`, clean tracked files, and `HEAD` equal to `origin/master`. Run `git fetch origin --tags` first. A tag must point at a published commit.
2. Run `node scripts/release/prepare.mjs $ARGUMENTS` from the repo root. Leave out the argument if it is empty. The script prints JSON with `tag`, `previous`, `tagExists`, `notes`, and `artwork`. If it fails, report the error and stop.
3. Read the `notes` file and view the `artwork` PNG. Check the version and notes.
4. Show the user the tag, whether it exists locally and on `origin`, the target commit, a short summary of the notes, and the artwork path. Ask with AskUserQuestion before any push or GitHub write. Offer "Publish" (recommended) and "Cancel".
5. Tag. Run `git ls-remote --tags origin refs/tags/<tag>`. If the tag exists remotely, never move it; confirm it points at the expected commit. If it does not exist, create it with `git tag -a <tag> -m "<tag>"` when it is missing locally, then run `git push origin <tag>`. Pushing a tag also starts `.github/workflows/release.yml`, including the `dockerize` job. Mention that in the report.
6. GitHub release. Check for an existing release with `gh release view <tag> --json url`. If it exists, run `gh release edit <tag> --title "MeshX <tag>" --notes-file <notes>` and then `gh release upload <tag> <artwork> --clobber`. If not, run `gh release create <tag> --verify-tag --title "MeshX <tag>" --notes-file <notes> <artwork>`. The `create-github-release` job in `release.yml` may also run on tag push. If it creates the release first, the `create` call fails. In that case, run the edit and upload steps.
7. Report the release URL and assets from `gh release view <tag> --json url,assets`. Mention that `.release/` is gitignored.
