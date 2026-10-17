// tasks/release.ts - Build and publish a release
// deno run --allow-read --allow-write --allow-run tasks/release.ts [--version vX.Y.Z] [--publish] [--git] [--gh] [--docker] [--docker-buildx] [--skip-git-tag] [--docker-repo <repo>]

// Lightweight path helpers
function norm(p: string): string { return p.replaceAll("\\", "/").replace(/\/+/, "/"); }
function join(...parts: string[]): string { return norm(parts.join("/")); }
function basename(p: string): string { const n = norm(p); const i = n.lastIndexOf("/"); return i >= 0 ? n.slice(i + 1) : n; }
function getArg(name: string, def?: string): string | undefined { const i = Deno.args.findIndex(a => a === `--${name}`); return i >= 0 ? Deno.args[i + 1] : def; }
function getFlag(name: string): boolean { return Deno.args.includes(`--${name}`); }

const cwd = Deno.cwd();
const dryRun = getFlag("dry-run");

const outDir = join(cwd, "deployment", "release");
await Deno.mkdir(outDir, { recursive: true });

async function exists(path: string) { try { await Deno.stat(path); return true; } catch { return false; } }

async function writeDenoVersion(next: string): Promise<void> {
  const denoPath = join(cwd, "deno.json");
  const txt = await Deno.readTextFile(denoPath);
  const json = JSON.parse(txt);
  json.version = next;
  await Deno.writeTextFile(denoPath, JSON.stringify(json, null, 2) + "\n");
}

async function readPackageVersion(): Promise<string> {
  try {
    const txt = await Deno.readTextFile(join(cwd, "deno.json"));
    const json = JSON.parse(txt);
    const v = json?.version ?? "0.0.0";
    return typeof v === "string" ? v : "0.0.0";
  } catch { return "0.0.0"; }
}
function ensureV(v: string): string { return v.startsWith("v") ? v : `v${v}`; }

// Auto-bump patch unless overridden
async function bumpPatchInDenoJson(): Promise<string | null> {
  try {
    const denoPath = join(cwd, "deno.json");
    const txt = await Deno.readTextFile(denoPath);
    const json = JSON.parse(txt);
    const cur = typeof json.version === "string" ? json.version : "0.0.0";
    const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/);
    if (!m) return null;
    const next = `${Number(m[1])}.${Number(m[2])}.${Number(m[3]) + 1}${m[4] ?? ""}`;
    json.version = next;
    await Deno.writeTextFile(denoPath, JSON.stringify(json, null, 2) + "\n");
    console.log(`Version bumped in deno.json: ${cur} -> ${next}`);
    return next;
  } catch (e) {
    console.warn("Skipping version bump (error):", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Resolve final version and sync deno.json before tagging
const cliVersion = getArg("version");
let bumpedTo: string | null = null;
const currentVersion = await readPackageVersion();
if (cliVersion) {
  const vNoV = cliVersion.replace(/^v/, "");
  if (!dryRun && vNoV !== currentVersion) {
    await writeDenoVersion(vNoV);
    console.log(`Version set in deno.json: ${currentVersion} -> ${vNoV}`);
    bumpedTo = vNoV;
  }
} else if (!getFlag("no-bump") && !dryRun) {
  bumpedTo = await bumpPatchInDenoJson();
}
const version = ensureV(bumpedTo ?? (await readPackageVersion())); // re-read after bump

async function commandExists(cmd: string): Promise<boolean> {
  try { await new Deno.Command(cmd, { args: ["--version"], stdin: "null", stdout: "piped", stderr: "piped" }).output(); return true; }
  catch { return false; }
}
async function run(cmd: string, args: string[], opts?: { cwd?: string }): Promise<{ code: number; out: string; err: string }> {
  const p = new Deno.Command(cmd, { args, cwd: opts?.cwd ?? cwd, stdin: "null", stdout: "piped", stderr: "piped" });
  const res = await p.output();
  return { code: res.code, out: new TextDecoder().decode(res.stdout).trim(), err: new TextDecoder().decode(res.stderr).trim() };
}

// Bash runner (Git Bash, WSL, sh)
async function tryRunBashLine(line: string): Promise<{ ok: boolean; out: string; err: string }> {
  const candidates = [
    { cmd: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["-lc", line] },
    { cmd: "C:\\Program Files\\Git\\usr\\bin\\bash.exe", args: ["-lc", line] },
    { cmd: "bash", args: ["-lc", line] },
    { cmd: "wsl.exe", args: ["bash", "-lc", line] },
    { cmd: "sh", args: ["-c", line] },
  ];
  for (const c of candidates) {
    try {
      const r = await run(c.cmd, c.args);
      if (r.code === 0) return { ok: true, out: r.out, err: r.err };
    } catch { /* try next */ }
  }
  return { ok: false, out: "", err: "no bash/sh available" };
}

async function buildServerInstaller(): Promise<string | null> {
  await Deno.mkdir(outDir, { recursive: true }).catch(() => {});
  // Always rebuild
  const line = `./deployment/build-server.sh --non-interactive`;
  const res = await tryRunBashLine(line);
  if (!res.ok) { console.warn(`Server installer generation failed: ${res.err}`); return null; }

  // Locate artifact: prefer deployment/release/server.sh, else deployment/server.sh
  const preferred = join(outDir, "server.sh");
  if (await exists(preferred)) return preferred;

  const legacy = join(cwd, "deployment", "server.sh");
  if (await exists(legacy)) {
    const dst = join(outDir, "server.sh");
    await Deno.copyFile(legacy, dst);
    return dst;
  }
  console.warn("Server installer not found after build.");
  return null;
}

async function writeChecksumIfExists(path: string | null): Promise<void> {
  if (!path || !(await exists(path))) return;
  try {
    const data = await Deno.readFile(path);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    await Deno.writeTextFile(`${path}.sha256`, `${hex}  ${basename(path)}\n`);
    console.log(`Checksum written: ${path}.sha256`);
  } catch (e) {
    console.warn(`Checksum failed for ${path}:`, e instanceof Error ? e.message : String(e));
  }
}

// Rebuild server.sh and prepare docker.sh
console.log("Generating server installer (non-interactive)...");
const serverPath = await buildServerInstaller();
await writeChecksumIfExists(serverPath);

let dockerPath: string | null = null;
try {
  const src = join(cwd, "deployment", "docker.sh");
  const dst = join(outDir, "docker.sh");
  if (await exists(src)) {
    await Deno.copyFile(src, dst);
    dockerPath = dst;
    console.log(`Docker script prepared: ${dst}`);
  } else {
    console.warn("Docker script missing:", src);
  }
} catch (e) {
  console.warn(`Docker script copy failed:`, e instanceof Error ? e.message : String(e));
}
await writeChecksumIfExists(dockerPath);

// Docker
function sanitizeDockerTag(t: string): string { return t.replace(/^v/, "").replace(/[^a-zA-Z0-9_.-]/g, "-"); }
let dockerNotesSection = "";
async function dockerExists(): Promise<boolean> { try { const r = await run("docker", ["version", "--format", "{{.Client.Version}}"]); return r.code === 0; } catch { return false; } }
const dockerUseBuildx = getFlag("docker-buildx");
const dockerRepoArg = getArg("docker-repo");
async function publishDockerImage() {
  if (!(await dockerExists())) { console.warn("docker not found; skipping Docker image build/push"); return; }
  const repo = dockerRepoArg ?? "spintheweb/webspinner";
  const tagV = version;
  const tagSemver = sanitizeDockerTag(version);
  const tags = ["latest", tagV, tagSemver];
  const buildTagsArgs: string[] = [];
  for (const t of tags) buildTagsArgs.push("-t", `${repo}:${t}`);

  if (dockerUseBuildx) {
    const args = ["buildx", "build", "--platform", "linux/amd64,linux/arm64", ...buildTagsArgs, "--push", "."];
    if (!dryRun) { const r = await run("docker", args); if (r.code !== 0) console.warn("docker buildx build failed:", r.err || r.out); }
    else console.log(`[dry-run] docker ${args.join(" ")}`);
  } else {
    const args = ["build", ...buildTagsArgs, "."];
    if (!dryRun) { const r = await run("docker", args); if (r.code !== 0) console.warn("docker build failed:", r.err || r.out); }
    else console.log(`[dry-run] docker ${args.join(" ")}`);
    for (const t of tags) {
      if (!dryRun) { const p = await run("docker", ["push", `${repo}:${t}`]); if (p.code !== 0) console.warn(`docker push ${repo}:${t} failed:`, p.err || p.out); }
      else console.log(`[dry-run] docker push ${repo}:${t}`);
    }
  }
  dockerNotesSection = [
    "\nDocker images:",
    `- ${repo}:latest`,
    `- ${repo}:${tagV}`,
    `- ${repo}:${tagSemver}`,
    "\nPull examples:",
    `docker pull ${repo}:${tagV}`,
    `docker pull ${repo}:${tagSemver}`,
    `docker pull ${repo}:latest\n`,
  ].join("\n");
}

// Git/GitHub
const doGit = getFlag("git") || getFlag("publish");
const doGh = getFlag("gh") || getFlag("publish");
const skipGitTag = getFlag("skip-git-tag");
async function publishGitAndGithub() {
  const tag = version;
  if (doGit && !skipGitTag) {
    if (!(await commandExists("git"))) {
      console.warn("git not found; skipping git publish");
    } else {
      const chk = await run("git", ["rev-parse", "--is-inside-work-tree"]);
      if (chk.code !== 0 || chk.out !== "true") {
        console.warn("Not inside a git repository; skipping git publish");
      } else {
        if (bumpedTo) {
          console.log(`Committing version bump: ${bumpedTo}`);
          if (!dryRun) {
            await run("git", ["add", "deno.json"]);
            await run("git", ["commit", "-m", `chore(release): ${tag}`]);
          } else {
            console.log(`[dry-run] git add deno.json && git commit -m "chore(release): ${tag}"`);
          }
        }
        const hasTag = await run("git", ["tag", "-l", tag]);
        if (!hasTag.out.split(/\r?\n/).includes(tag)) {
          console.log(`Creating git tag ${tag}`);
          if (!dryRun) await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
          else console.log(`[dry-run] git tag -a ${tag} -m "Release ${tag}"`);
        } else {
          console.log(`Tag ${tag} already exists locally`);
        }
        if (!dryRun) { await run("git", ["push"]); await run("git", ["push", "origin", tag]); }
        else console.log(`[dry-run] git push && git push origin ${tag}`);
      }
    }
  }

  if (doGh) {
    if (!(await commandExists("gh"))) { console.warn("GitHub CLI (gh) not found; skipping GitHub release"); return; }

    const serverShPath = join(outDir, "server.sh");
    const serverShShaPath = `${serverShPath}.sha256`;
    const dockerShPath = join(outDir, "docker.sh");
    const dockerShShaPath = `${dockerShPath}.sha256`;
    const assets: string[] = [];
    if (await exists(serverShPath)) assets.push(serverShPath);
    if (await exists(serverShShaPath)) assets.push(serverShShaPath);
    if (await exists(dockerShPath)) assets.push(dockerShPath);
    if (await exists(dockerShShaPath)) assets.push(dockerShShaPath);

    const title = `Webspinner ${tag}`;
    const notes = [
      `Release ${tag}`,
      `\nIncluded assets:`,
      (await exists(serverShPath) ? `- ${basename(serverShPath)} (+ .sha256)` : null),
      (await exists(dockerShPath) ? `- ${basename(dockerShPath)} (+ .sha256)` : null),
      `\nHow to use on the destination server:`,
      `1) Linux server install:`,
      `   Download ${basename(serverShPath)} and run:`,
      `   \`\`\`sudo bash ${basename(serverShPath)}\`\`\``,
      `2) Docker setup:`,
      `   Download ${basename(dockerShPath)} and run:`,
      `   \`\`\`bash ${basename(dockerShPath)}\`\`\``,
      `   - Maps host 8080 -> container 8080`,
      `   - Persists data: ./webspinner-data -> /app/.data`,
      `   - Env: PORT, PORTAL_ROOT, WEBBASE, COMMON_WEBBASE`,
      `3) (Optional) Verify checksums via the .sha256 files\n`,
      dockerNotesSection || null,
    ].filter(Boolean).join("\n");

    const args = ["release", "create", tag, ...assets, "--title", title, "--notes", notes];
    if (!dryRun) {
      const r = await run("gh", args);
      if (r.code !== 0) {
        const msg = r.err || r.out;
        console.warn("gh release create failed:", msg);
        if (/already exists/i.test(msg)) {
          console.log("Release exists; uploading assets and updating notes...");
          const upload = await run("gh", ["release", "upload", tag, ...assets, "--clobber"]);
          if (upload.code !== 0) console.warn("gh release upload failed:", upload.err || upload.out);
          const edit = await run("gh", ["release", "edit", tag, "--title", title, "--notes", notes]);
          if (edit.code !== 0) console.warn("gh release edit failed:", edit.err || edit.out);
        }
      } else {
        console.log("GitHub release created for", tag);
      }
    } else {
      console.log(`[dry-run] gh ${args.join(" ")}`);
    }
  }
}

// Orchestration
const doDocker = getFlag("docker") || getFlag("publish") || dockerUseBuildx;

if (doDocker) await publishDockerImage();
if (doGit || doGh) await publishGitAndGithub();

// Cleanup local artifacts
if (!dryRun) {
  try { await Deno.remove(outDir, { recursive: true }); console.log("Cleaned release artifacts:", outDir); }
  catch (e) { console.warn("Cleanup failed for", outDir, "-", e instanceof Error ? e.message : String(e)); }
} else {
  console.log("[dry-run] Skipping cleanup of", outDir);
}
