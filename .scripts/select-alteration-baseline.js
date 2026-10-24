import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

// Both tag conventions occur in imported release histories. Never fall back to HEAD:
// that would turn migration compatibility into a comparison of a revision with itself.
try {
  const tag = execFileSync(
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
  const output = `tag=${tag}\nversion=${manifest.version}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  } else {
    process.stdout.write(output);
  }
} catch {
  console.error(
    "Unable to select a reachable release baseline with a valid Core package version; migration check failed closed.",
  );
  process.exitCode = 1;
}
