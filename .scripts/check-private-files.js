import { spawnSync } from "node:child_process";

const git = (args) => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      "Unable to inspect Git paths; security check failed closed.",
    );
  return result.stdout;
};

const agentDirectories = new Set([
  ".claude",
  ".codex",
  ".agents",
  ".agent",
  ".opencode",
  ".cursor",
  ".continue",
  ".gemini",
  ".windsurf",
  ".roo",
  ".kilocode",
  ".clinerules",
  ".kiro",
  ".specify",
  ".superpowers",
  ".aider",
  ".openhands",
  ".openclaw",
  ".copilot",
  ".junie",
  ".trae",
  ".goose",
  ".pi",
  ".dsh",
  ".kimi",
  ".kimi-code",
  ".ecc",
]);
const agentFiles = new Set([
  "agents.md",
  "agents.override.md",
  "project-context.md",
  "claude.md",
  "claude.local.md",
  "codex.md",
  "gemini.md",
  ".cursorrules",
  ".cursorignore",
  ".clinerules",
  ".windsurfrules",
  ".goosehints",
  ".mcp.json",
  "opencode.json",
  "opencode.jsonc",
]);
const isAgentPath = (parts) =>
  parts.some((part) => agentDirectories.has(part)) ||
  agentFiles.has(parts.at(-1)) ||
  parts.at(-1).startsWith(".aider.") ||
  ["plans", "specs"].includes(parts[0]) ||
  parts.some(
    (part, index) =>
      (part === "docs" &&
        [
          "superpowers",
          "agents",
          "plans",
          "specs",
          "agent-plans",
          "agent-specs",
          "landing-cms-editor",
        ].includes(parts[index + 1])) ||
      (part === "docs" && parts[index + 1] === "ask-ai-management-plan.md") ||
      (part === ".github" &&
        [
          "copilot-instructions.md",
          "instructions",
          "prompts",
          "agents",
        ].includes(parts[index + 1])),
  );

const isPrivatePath = (name) => {
  const parts = name.toLowerCase().split("/");
  const base = parts.at(-1);
  const environmentTemplate = [
    ".env.example",
    ".env.sample",
    ".env.template",
  ].includes(base);
  return (
    isAgentPath(parts) ||
    (!environmentTemplate &&
      (base === ".env" || base.startsWith(".env.") || base.endsWith(".env"))) ||
    /^session[-_][\s\S]*\.(md|txt|json|jsonl|html)$/.test(base) ||
    parts.some((part) =>
      [
        ".cyberstrike",
        ".playwright-mcp",
        ".superpowers",
        ".auth",
        "browser-profile",
        "chrome-profile",
      ].includes(part),
    ) ||
    ["artifacts", "recordings", "playwright-report", "test-results"].includes(
      parts[0],
    ) ||
    /^\.tmp-/.test(base) ||
    /\.(pem|key|p12|pfx|keystore)$/.test(base) ||
    /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(base) ||
    /^(storage[-_.]?state|auth[-_.]?state)\.json$/.test(base) ||
    /^(dump|backup|db-backup)([-_.].*)?\.(sql|dump|rdb)(\.(gz|zip))?$/.test(
      base,
    ) ||
    base === "dump.rdb"
  );
};

const paths = (output) => output.split("\0").filter(Boolean);

try {
  const repository = git(["rev-parse", "--show-toplevel"]).trim();
  const repoGit = (args) => git(["-C", repository, ...args]);
  const args = process.argv.slice(2);
  const denied = new Set();
  if (args.length === 1 && args[0] === "--staged") {
    // Inspect the entire index, including already tracked files, not unstaged local data.
    for (const name of paths(repoGit(["ls-files", "--cached", "-z"]))) {
      if (isPrivatePath(name)) denied.add(name);
    }
  } else if (
    args.length === 3 &&
    args[0] === "--range" &&
    args.slice(1).every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha))
  ) {
    const [, base, head] = args;
    repoGit(["cat-file", "-e", `${head}^{commit}`]);
    if (!/^0+$/.test(base)) repoGit(["cat-file", "-e", `${base}^{commit}`]);
    const range = /^0+$/.test(base) ? head : `${base}..${head}`;
    for (const commit of repoGit(["rev-list", range])
      .trim()
      .split("\n")
      .filter(Boolean)) {
      // A private file added then deleted in the same PR still leaks through history.
      for (const name of paths(
        repoGit(["ls-tree", "-r", "--name-only", "-z", commit]),
      )) {
        if (isPrivatePath(name)) denied.add(name);
      }
    }
  } else {
    throw new Error(
      "Usage: check-private-files.js --staged | --range BASE_SHA HEAD_SHA",
    );
  }
  if (denied.size) {
    console.error(
      "Private files must stay outside Git (file contents are not printed):",
    );
    for (const name of [...denied].sort())
      console.error(`  ${JSON.stringify(name)}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
