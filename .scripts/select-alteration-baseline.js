import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// Both tag conventions occur in imported release histories. Never fall back to HEAD:
// that would turn migration compatibility into a comparison of a revision with itself.
try {
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let tag;
  let pinnedCommit;
  try {
    tag = execFileSync(
      "git",
      [
        "describe",
        "--tags",
        "--abbrev=0",
        "--match",
        "@logto/core@*",
        "--match",
        "v*",
        "HEAD",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    // Sanitized histories have no reachable release tags. An explicit immutable upstream
    // baseline still tests real migrations without attaching superseded history to master.
    const pin = JSON.parse(
      readFileSync(".scripts/alteration-baseline.json", "utf8"),
    );
    if (
      typeof pin.tag !== "string" ||
      !/^(?:v|@logto\/core@)[0-9][0-9A-Za-z.+-]*$/.test(pin.tag) ||
      typeof pin.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(pin.commit) ||
      git("rev-parse", `refs/tags/${pin.tag}^{commit}`) !== pin.commit ||
      git("rev-parse", "HEAD") === pin.commit
    ) {
      throw new Error(
        "Migration baseline tag does not match its immutable pin",
      );
    }
    tag = pin.tag;
    pinnedCommit = pin.commit;
  }
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semver.test(tag.replace(/^(?:@logto\/core@|v)/, ""))) {
    throw new Error("Release tag is not a version tag");
  }
  const manifest = JSON.parse(
    execFileSync("git", ["show", `${tag}:packages/core/package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (typeof manifest.version !== "string" || !semver.test(manifest.version)) {
    throw new Error("Release Core manifest has no valid schema version");
  }
  const output = `tag=${tag}\nversion=${manifest.version}\n${pinnedCommit ? `ref=${pinnedCommit}\n` : ""}`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  } else {
    process.stdout.write(output);
  }
} catch {
  console.error(
    "Unable to select a reachable or explicitly pinned release baseline with a valid Core package version; migration check failed closed.",
  );
  process.exitCode = 1;
}
