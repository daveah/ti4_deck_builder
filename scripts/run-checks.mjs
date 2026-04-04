import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const section = process.argv[2] ?? "all";

if (!["all", "python", "ts"].includes(section)) {
  console.error(`Unknown section '${section}'. Use 'all', 'python', or 'ts'.`);
  process.exit(1);
}

const excludedDirs = new Set([
  ".git",
  "dist",
  "node_modules",
  "__pycache__",
  ".venv",
]);

function walkFiles(startDir, extension, collected = []) {
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) {
        walkFiles(entryPath, extension, collected);
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      collected.push(path.relative(rootDir, entryPath));
    }
  }
  return collected;
}

function runCommand(label, command, args) {
  console.log(`\n== ${label} ==`);
  const isWindowsPackageCommand =
    process.platform === "win32" && (command === "npm" || command === "npx");
  const cmdQuote = (value) => {
    if (!/[\s"]/u.test(value)) return value;
    return `"${value.replace(/"/gu, '""')}"`;
  };
  const result = isWindowsPackageCommand
    ? spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `${command}.cmd ${args.map(cmdQuote).join(" ")}`],
        {
          cwd: rootDir,
          stdio: "inherit",
        },
      )
    : spawnSync(command, args, {
        cwd: rootDir,
        stdio: "inherit",
      });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const pythonFiles = walkFiles(rootDir, ".py");
const tsFiles = walkFiles(path.join(rootDir, "src"), ".ts").concat(
  walkFiles(path.join(rootDir, "tests"), ".ts"),
);
function runPythonChecks() {
  runCommand("Python: black", "uv", [
    "run",
    "--with",
    "black",
    "black",
    "--check",
    ...pythonFiles,
  ]);
  runCommand("Python: isort", "uv", [
    "run",
    "--with",
    "isort",
    "isort",
    "--check-only",
    ...pythonFiles,
  ]);
  runCommand("Python: mypy", "uv", [
    "run",
    "--with",
    "mypy",
    "mypy",
    ...pythonFiles,
  ]);
  runCommand("Python: ruff", "uv", [
    "run",
    "--with",
    "ruff",
    "ruff",
    "check",
    ...pythonFiles,
  ]);
  runCommand("Python: pylint", "uv", [
    "run",
    "--with",
    "pylint",
    "pylint",
    ...pythonFiles,
  ]);
  runCommand("Python: pytest", "uv", ["run", "--with", "pytest", "pytest"]);
  runCommand("Python: coverage", "uv", [
    "run",
    "--with",
    "coverage",
    "--with",
    "pytest",
    "coverage",
    "run",
    "-m",
    "pytest",
  ]);
  runCommand("Python: coverage report", "uv", [
    "run",
    "--with",
    "coverage",
    "coverage",
    "report",
  ]);
}

function runTypeScriptChecks() {
  runCommand("TypeScript: prettier", "npm", [
    "exec",
    "--",
    "prettier",
    "--check",
    ".",
  ]);
  runCommand("TypeScript: lint", "npx", ["--yes", "oxlint@latest", ...tsFiles]);
  runCommand("TypeScript: typecheck", "npx", ["tsc", "--noEmit"]);
  runCommand("TypeScript: tests", "npm", ["test"]);
  runCommand("TypeScript: coverage", "npx", ["vitest", "run", "--coverage"]);
}

if (section === "all" || section === "python") {
  runPythonChecks();
}

if (section === "all" || section === "ts") {
  runTypeScriptChecks();
}
