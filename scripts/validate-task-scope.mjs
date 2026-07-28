import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const manifestPath = valueFor("--manifest", process.env.TASK_MANIFEST);
const baseRef = valueFor("--base", process.env.TASK_BASE_REF || "origin/main");
const headRef = valueFor("--head", process.env.TASK_HEAD_REF || "HEAD");
const includeWorktree = args.includes("--worktree");

if (!manifestPath || !existsSync(manifestPath)) {
  console.error("Task manifest is required. Pass --manifest <file>.");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const required = ["taskId", "module", "baseCommit", "paths", "sharedPaths", "status"];
const missing = required.filter((key) => manifest[key] === undefined);
if (missing.length) {
  console.error(`Invalid task manifest. Missing: ${missing.join(", ")}`);
  process.exit(2);
}
if (manifest.status !== "active") {
  console.error(`Task ${manifest.taskId} is not active.`);
  process.exit(2);
}

const normalize = (input) =>
  input.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
const roots = [...manifest.paths, ...manifest.sharedPaths].map(normalize);
if (roots.some((root) => !root || root === "." || root === "..")) {
  console.error("Task paths must be explicit repository paths.");
  process.exit(2);
}

const diffFiles = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    includeWorktree ? baseRef : `${baseRef}...${headRef}`,
  ],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .map(normalize)
  .filter(Boolean);
const untrackedFiles = includeWorktree
  ? execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map(normalize)
      .filter(Boolean)
  : [];
const changed = [...new Set([...diffFiles, ...untrackedFiles])].filter(
  (file) => file !== normalize(manifestPath),
);

const allowed = (file) =>
  roots.some((root) => file === root || file.startsWith(`${root}/`));
const violations = changed.filter((file) => !allowed(file));
if (violations.length) {
  console.error(`Task ${manifest.taskId} changed files outside its claim:`);
  violations.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log(`Task scope valid: ${manifest.taskId}; ${changed.length} changed file(s).`);
