import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";

const DEFAULT_REPO = process.env["COCLAUDE_REPO"] ?? "OWNER/REPO";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
  html_url: string;
}

export async function runSelfUpdate(currentVersion: string): Promise<void> {
  const repo = DEFAULT_REPO;
  if (repo === "OWNER/REPO") {
    console.error(
      "error: COCLAUDE_REPO not configured. Set it to the GitHub repo (owner/name).",
    );
    process.exit(1);
  }

  // Refuse to self-update when running from source — there's no compiled
  // binary to replace.
  const exec = process.execPath;
  const looksLikeNode =
    /node$/i.test(exec) || /node\.exe$/i.test(exec) || exec.includes("/tsx/");
  if (looksLikeNode) {
    console.error(
      "error: self-update only works on installed binaries, not when running from source",
    );
    console.error("       run `git pull` to update your checkout instead");
    process.exit(1);
  }

  console.log(`Current version: v${currentVersion}`);
  console.log(`Checking GitHub for the latest release of ${repo}…`);

  const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  let release: ReleaseInfo;
  try {
    const res = await fetch(releaseUrl, {
      headers: { "User-Agent": "coclaude-self-update" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${releaseUrl}`);
    }
    release = (await res.json()) as ReleaseInfo;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  }

  const latestVersion = release.tag_name.replace(/^v/, "");
  if (latestVersion === currentVersion) {
    console.log("Already on the latest version.");
    return;
  }
  console.log(`Latest version:  v${latestVersion}`);

  const { os: osName, arch } = detectPlatform();
  const assetName =
    osName === "windows"
      ? `coclaude-${osName}-${arch}.exe`
      : `coclaude-${osName}-${arch}`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    console.error(`error: no release asset named ${assetName}`);
    console.error(`       see ${release.html_url}`);
    process.exit(1);
  }

  console.log(`Downloading ${asset.name}…`);
  const tmp = path.join(
    os.tmpdir(),
    `coclaude-update-${process.pid}-${Date.now()}`,
  );
  try {
    const res = await fetch(asset.browser_download_url, {
      redirect: "follow",
      headers: { "User-Agent": "coclaude-self-update" },
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} fetching ${asset.browser_download_url}`);
    }
    const fileStream = fs.createWriteStream(tmp);
    // Node's WebStream → NodeStream conversion
    const nodeReadable = (await import("node:stream")).Readable.fromWeb(
      res.body as unknown as import("stream/web").ReadableStream,
    );
    await pipeline(nodeReadable, fileStream);
    fs.chmodSync(tmp, 0o755);
  } catch (err) {
    try {
      fs.rmSync(tmp);
    } catch {
      // ignore
    }
    console.error(`error: download failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Atomic replace: rename the new file over the current executable. On
  // Windows this fails if the binary is running; we can't help that without
  // a shim, so for v1 we just report the path and let the user move it.
  try {
    fs.renameSync(tmp, exec);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EXDEV" || e.code === "EACCES" || e.code === "EPERM") {
      console.error(
        `error: cannot replace ${exec} in place (${e.code}). Move it manually:`,
      );
      console.error(`       mv ${tmp} ${exec}`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`✓ Updated to v${latestVersion}.`);
}

function detectPlatform(): { os: string; arch: string } {
  const osMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
  };
  const o = osMap[process.platform];
  const a = archMap[process.arch];
  if (!o || !a) {
    console.error(
      `error: unsupported platform ${process.platform}/${process.arch}`,
    );
    process.exit(1);
  }
  return { os: o, arch: a };
}
