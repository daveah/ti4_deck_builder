import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "webdav";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const localDistDir = path.resolve(projectRoot, process.env.WEBDAV_LOCAL_DIR || "dist");

function requireEnv(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeRemotePath(inputPath) {
  const cleaned = inputPath.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (cleaned === "/") {
    return "/";
  }
  return `/${cleaned.replace(/^\/|\/$/g, "")}`;
}

async function collectFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function ensureDirectory(client, remoteDir) {
  if (remoteDir === "/") {
    return;
  }

  const segments = remoteDir.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    if (!(await client.exists(current))) {
      await client.createDirectory(current);
    }
  }
}

async function emptyDirectory(client, remoteDir) {
  const contents = await client.getDirectoryContents(remoteDir);
  for (const entry of contents) {
    if (entry.filename === remoteDir) {
      continue;
    }
    await client.deleteFile(entry.filename);
  }
}

async function main() {
  const skipBuild = (process.env.WEBDAV_SKIP_BUILD || "").toLowerCase() === "true";
  const remoteUrl = requireEnv("WEBDAV_URL");
  const username = requireEnv("WEBDAV_USERNAME");
  const password = requireEnv("WEBDAV_PASSWORD");
  const remoteBaseDir = normalizeRemotePath(requireEnv("WEBDAV_REMOTE_PATH"));
  const cleanRemote = (process.env.WEBDAV_CLEAN_REMOTE || "").toLowerCase() === "true";

  if (!skipBuild) {
    console.log("Building application ...");
    const npmExecPath = process.env.npm_execpath;
    const buildCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const buildArgs = npmExecPath ? [npmExecPath, "run", "build"] : ["run", "build"];
    const buildResult = spawnSync(buildCommand, buildArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false
    });
    if (buildResult.status !== 0) {
      throw new Error(`Build failed; deployment aborted. Exit code: ${buildResult.status ?? "unknown"}`);
    }
  }

  const distStats = await stat(localDistDir).catch(() => null);
  if (!distStats || !distStats.isDirectory()) {
    throw new Error(`Local build directory not found: ${localDistDir}. Run "npm run build" first.`);
  }

  const client = createClient(remoteUrl, { username, password });
  await ensureDirectory(client, remoteBaseDir);

  if (cleanRemote) {
    console.log(`Cleaning remote directory ${remoteBaseDir} ...`);
    await emptyDirectory(client, remoteBaseDir);
  }

  const files = await collectFiles(localDistDir);
  console.log(`Uploading ${files.length} files from ${localDistDir} to ${remoteBaseDir} ...`);

  for (const filePath of files) {
    const relativePath = path.relative(localDistDir, filePath).split(path.sep).join("/");
    const remoteFilePath = normalizeRemotePath(path.posix.join(remoteBaseDir, relativePath));
    await ensureDirectory(client, normalizeRemotePath(path.posix.dirname(remoteFilePath)));
    await client.putFileContents(remoteFilePath, await readFile(filePath), { overwrite: true });
    console.log(`Uploaded ${relativePath}`);
  }

  console.log("WebDAV deployment complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
