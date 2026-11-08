/*
 * tasks/release.js
 *
 * Builds the release artifacts for Webspinner, updates the package version when needed,
 * and optionally publishes the result to Docker and GitHub.
 *
 * What it does:
 *   - reads the current app version from package.json and keeps package-lock.json aligned
 *   - optionally bumps the patch version unless --no-bump or --dry-run is used
 *   - rebuilds the server installer from deployment/build-server.sh
 *   - copies deployment/docker.sh into the release folder when present
 *   - writes SHA256 checksums for generated installer files
 *   - optionally builds and pushes Docker images tagged as latest, vX.Y.Z, and sanitized semver
 *   - optionally creates or updates a git tag and pushes it
 *   - optionally creates or updates a GitHub release with release notes and attached assets
 *   - cleans up the generated release folder unless --keep-artifacts / --no-cleanup is used
 *
 * Usage:
 *   node tasks/release.js [options]
 *
 * Simplest usage (no options):
 *   node tasks/release.js
 *   This automatically bumps the patch version, builds the installer and checksums,
 *   then removes deployment/release. It does not publish to GitHub or Docker.
 *
 * Common options:
 *   --version vX.Y.Z     Set the release version explicitly (without the v prefix also works)
 *   --publish            Run Docker + Git + GitHub publishing steps
 *   --git                Push the tag and version bump to git
 *   --gh                 Create or update the GitHub release
 *   --docker             Build and push Docker images
 *   --docker-buildx      Use docker buildx with linux/amd64 and linux/arm64
 *   --skip-git-tag       Skip tag creation while still allowing other git operations
 *   --docker-repo <repo> Override the Docker repository (default: spintheweb/webspinner)
 *   --no-bump            Do not auto-bump the patch version
 *   --dry-run            Print the commands that would run without executing them
 *   --keep-artifacts     Keep the generated files in deployment/release instead of deleting them
 *   --no-cleanup         Alias for --keep-artifacts
 *
 * Examples:
 *   node tasks/release.js --version v0.3.6 --dry-run
 *   node tasks/release.js --publish --docker-repo myorg/webspinner
 *   node tasks/release.js --gh --git --version 0.3.6 --keep-artifacts
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runCommand } from "../stwComponents/stwNode.js";

// Lightweight path helpers
function norm(p) { return p.replaceAll("\\", "/").replace(/\/+/, "/"); }
function join(...parts) { return norm(parts.join("/")); }
function basename(p) { const n = norm(p); const i = n.lastIndexOf("/"); return i >= 0 ? n.slice(i + 1) : n; }
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.findIndex(a => a === `--${name}`); return i >= 0 ? args[i + 1] : def; }
function getFlag(name) { return args.includes(`--${name}`); }
const cwd = process.cwd();
const dryRun = getFlag("dry-run");
const keepArtifacts = getFlag("keep-artifacts") || getFlag("no-cleanup");
const outDir = join(cwd, "deployment", "release");
await mkdir(outDir, { recursive: true });

async function exists(path) {
	try {
		await stat(path);
		return true;
	}
	catch (error) {
		if (error.code === "ENOENT")
			return false;
		throw error;
	}
}

async function ensurePackageFiles() {
	const packagePath = join(cwd, "package.json");
	const lockPath = join(cwd, "package-lock.json");
	if (!(await exists(packagePath)))
		throw new Error(`Missing package.json at ${packagePath}`);
	if (!(await exists(lockPath)))
		throw new Error(`Missing package-lock.json at ${lockPath}`);
}

async function writePackageVersion(next) {
	await ensurePackageFiles();
	const packagePath = join(cwd, "package.json");
	const txt = await readFile(packagePath, "utf8");
	const json = JSON.parse(txt);
	json.version = next;
	await writeFile(packagePath, JSON.stringify(json, null, 2) + "\n");
	const lockPath = join(cwd, "package-lock.json");
	const lock = JSON.parse(await readFile(lockPath, "utf8"));
	lock.version = next;
	if (lock.packages?.[""])
		lock.packages[""].version = next;
	await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

async function readPackageVersion() {
	try {
		const txt = await readFile(join(cwd, "package.json"), "utf8");
		const json = JSON.parse(txt);
		const v = json?.version ?? "0.0.0";
		return typeof v === "string" ? v : "0.0.0";
	}
	catch {
		return "0.0.0";
	}
}

function ensureV(v) { return v.startsWith("v") ? v : `v${v}`; }

// Auto-bump patch unless overridden
async function bumpPatchInPackageJson() {
	try {
		const packagePath = join(cwd, "package.json");
		const txt = await readFile(packagePath, "utf8");
		const json = JSON.parse(txt);
		const cur = typeof json.version === "string" ? json.version : "0.0.0";
		const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/);
		if (!m)
			return null;
		const next = `${Number(m[1])}.${Number(m[2])}.${Number(m[3]) + 1}${m[4] ?? ""}`;
		json.version = next;
		await writePackageVersion(next);
		console.log(`Version bumped in package.json: ${cur} -> ${next}`);
		return next;
	}
	catch (e) {
		console.warn("Skipping version bump (error):", e instanceof Error ? e.message : String(e));
		return null;
	}
}

await ensurePackageFiles();

// Resolve final version and sync package metadata before tagging
const cliVersion = getArg("version");
let bumpedTo = null;
const currentVersion = await readPackageVersion();
if (cliVersion) {
	const vNoV = cliVersion.replace(/^v/, "");
	if (!dryRun && vNoV !== currentVersion) {
		await writePackageVersion(vNoV);
		console.log(`Version set in package.json: ${currentVersion} -> ${vNoV}`);
		bumpedTo = vNoV;
	}
} else if (!getFlag("no-bump") && !dryRun) {
	bumpedTo = await bumpPatchInPackageJson();
}

const version = ensureV(bumpedTo ?? (await readPackageVersion())); // re-read after bump
async function commandExists(cmd) {
	try {
		return (await runCommand(cmd, ["--version"])).code === 0;
	}
	catch {
		return false;
	}
}

async function run(cmd, args, opts) {
	const res = await runCommand(cmd, args, { cwd: opts?.cwd ?? cwd });
	return { code: res.code ?? 1, out: res.stdout.trim(), err: res.stderr.trim() };
}

// Bash runner (Git Bash, WSL, sh)
async function tryRunBashLine(line) {
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
			if (r.code === 0)
				return { ok: true, out: r.out, err: r.err };
		}
		catch { /* try next */ }
	}
	return { ok: false, out: "", err: "no bash/sh available" };
}

async function buildServerInstaller() {
	await mkdir(outDir, { recursive: true });
	// Always rebuild
	const line = `./deployment/build-server.sh --non-interactive`;
	const res = await tryRunBashLine(line);
	if (!res.ok) {
		console.warn(`Server installer generation failed: ${res.err}`);
		return null;
	}
	// Locate artifact: prefer deployment/release/server.sh, else deployment/server.sh
	const preferred = join(outDir, "server.sh");
	if (await exists(preferred))
		return preferred;
	const legacy = join(cwd, "deployment", "server.sh");
	if (await exists(legacy)) {
		const dst = join(outDir, "server.sh");
		await copyFile(legacy, dst);
		return dst;
	}
	console.warn("Server installer not found after build.");
	return null;
}

async function writeChecksumIfExists(path) {
	if (!path || !(await exists(path)))
		return;
	try {
		const data = await readFile(path);
		const hex = createHash("sha256").update(data).digest("hex");
		await writeFile(`${path}.sha256`, `${hex}  ${basename(path)}\n`);
		console.log(`Checksum written: ${path}.sha256`);
	}
	catch (e) {
		console.warn(`Checksum failed for ${path}:`, e instanceof Error ? e.message : String(e));
	}
}

// Rebuild server.sh and prepare docker.sh
console.log("Generating server installer (non-interactive)...");
const serverPath = await buildServerInstaller();
await writeChecksumIfExists(serverPath);
let dockerPath = null;
try {
	const src = join(cwd, "deployment", "docker.sh");
	const dst = join(outDir, "docker.sh");
	if (await exists(src)) {
		await copyFile(src, dst);
		dockerPath = dst;
		console.log(`Docker script prepared: ${dst}`);
	} else {
		console.warn("Docker script missing:", src);
	}
}
catch (e) {
	console.warn(`Docker script copy failed:`, e instanceof Error ? e.message : String(e));
}
await writeChecksumIfExists(dockerPath);

// Docker
function sanitizeDockerTag(t) { return t.replace(/^v/, "").replace(/[^a-zA-Z0-9_.-]/g, "-"); }
let dockerNotesSection = "";
async function dockerExists() {
	try {
		const r = await run("docker", ["version", "--format", "{{.Client.Version}}"]);
		return r.code === 0;
	}
	catch {
		return false;
	}
}

const dockerUseBuildx = getFlag("docker-buildx");
const dockerRepoArg = getArg("docker-repo");
async function publishDockerImage() {
	const dockerRequired = getFlag("docker") || getFlag("publish") || dockerUseBuildx;
	if (!(await dockerExists())) {
		if (dockerRequired)
			throw new Error("Docker requested but docker is not installed or not on PATH");
		console.warn("docker not found; skipping Docker image build/push");
		return;
	}
	const repo = dockerRepoArg ?? "spintheweb/webspinner";
	const tagV = version;
	const tagSemver = sanitizeDockerTag(version);
	const tags = ["latest", tagV, tagSemver];
	const buildTagsArgs = [];
	for (const t of tags)
		buildTagsArgs.push("-t", `${repo}:${t}`);
	if (dockerUseBuildx) {
		const args = ["buildx", "build", "--platform", "linux/amd64,linux/arm64", ...buildTagsArgs, "--push", "."];
		if (!dryRun) {
			const r = await run("docker", args);
			if (r.code !== 0)
				throw new Error(`docker buildx build failed: ${r.err || r.out}`);
		} else
			console.log(`[dry-run] docker ${args.join(" ")}`);
	} else {
		const args = ["build", ...buildTagsArgs, "."];
		if (!dryRun) {
			const r = await run("docker", args);
			if (r.code !== 0)
				throw new Error(`docker build failed: ${r.err || r.out}`);
		} else
			console.log(`[dry-run] docker ${args.join(" ")}`);
		for (const t of tags) {
			if (!dryRun) {
				const p = await run("docker", ["push", `${repo}:${t}`]);
				if (p.code !== 0)
					throw new Error(`docker push ${repo}:${t} failed: ${p.err || p.out}`);
			} else
				console.log(`[dry-run] docker push ${repo}:${t}`);
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
		if (!(await commandExists("git")))
			throw new Error("git requested but git is not installed or not on PATH");
		const chk = await run("git", ["rev-parse", "--is-inside-work-tree"]);
		if (chk.code !== 0 || chk.out !== "true")
			throw new Error("git requested but the current directory is not a git worktree");
		if (bumpedTo) {
			console.log(`Committing version bump: ${bumpedTo}`);
			if (!dryRun) {
				await run("git", ["add", "package.json", "package-lock.json"]);
				await run("git", ["commit", "-m", `chore(release): ${tag}`]);
			} else {
				console.log(`[dry-run] git add package.json package-lock.json && git commit -m "chore(release): ${tag}"`);
			}
		}
		const hasTag = await run("git", ["tag", "-l", tag]);
		if (!hasTag.out.split(/\r?\n/).includes(tag)) {
			console.log(`Creating git tag ${tag}`);
			if (!dryRun)
				await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
			else
				console.log(`[dry-run] git tag -a ${tag} -m "Release ${tag}"`);
		} else {
			console.log(`Tag ${tag} already exists locally`);
		}
		if (!dryRun) {
			await run("git", ["push"]);
			await run("git", ["push", "origin", tag]);
		} else
			console.log(`[dry-run] git push && git push origin ${tag}`);
	}
	if (doGh) {
		if (!(await commandExists("gh")))
			throw new Error("GitHub release requested but gh is not installed or not on PATH");
		const serverShPath = join(outDir, "server.sh");
		const serverShShaPath = `${serverShPath}.sha256`;
		const dockerShPath = join(outDir, "docker.sh");
		const dockerShShaPath = `${dockerShPath}.sha256`;
		const assets = [];
		if (await exists(serverShPath))
			assets.push(serverShPath);
		if (await exists(serverShShaPath))
			assets.push(serverShShaPath);
		if (await exists(dockerShPath))
			assets.push(dockerShPath);
		if (await exists(dockerShShaPath))
			assets.push(dockerShShaPath);
		const title = `Webspinner ${tag}`;
		const releaseNotes = [`Release ${tag}`, "\nIncluded assets:"];
		if (await exists(serverShPath))
			releaseNotes.push(`- ${basename(serverShPath)} (+ .sha256)`);
		if (await exists(dockerShPath))
			releaseNotes.push(`- ${basename(dockerShPath)} (+ .sha256)`);
		if (await exists(serverShPath) || await exists(dockerShPath)) {
			releaseNotes.push("\nHow to use on the destination server:");
			if (await exists(serverShPath)) {
				releaseNotes.push("1) Linux server install:");
				releaseNotes.push(`   Download ${basename(serverShPath)} and run:`);
				releaseNotes.push(`   \`\`\`sudo bash ${basename(serverShPath)}\`\`\``);
			}
			if (await exists(dockerShPath)) {
				releaseNotes.push("2) Docker setup:");
				releaseNotes.push(`   Download ${basename(dockerShPath)} and run:`);
				releaseNotes.push(`   \`\`\`bash ${basename(dockerShPath)}\`\`\``);
				releaseNotes.push("   - Maps host 8080 -> container 8080");
				releaseNotes.push("   - Persists data: ./webspinner-data -> /app/.data");
				releaseNotes.push("   - Env: PORT, PORTAL_ROOT, WEBBASE, COMMON_WEBBASE");
			}
			releaseNotes.push("3) (Optional) Verify checksums via the .sha256 files\n");
		}
		if (dockerNotesSection)
			releaseNotes.push(dockerNotesSection);
		const notes = releaseNotes.filter(Boolean).join("\n");
		const args = ["release", "create", tag, ...assets, "--title", title, "--notes", notes];
		if (!dryRun) {
			const r = await run("gh", args);
			if (r.code !== 0) {
				const msg = r.err || r.out;
				console.warn("gh release create failed:", msg);
				if (/already exists/i.test(msg)) {
					console.log("Release exists; uploading assets and updating notes...");
					const upload = await run("gh", ["release", "upload", tag, ...assets, "--clobber"]);
					if (upload.code !== 0)
						throw new Error(`gh release upload failed: ${upload.err || upload.out}`);
					const edit = await run("gh", ["release", "edit", tag, "--title", title, "--notes", notes]);
					if (edit.code !== 0)
						throw new Error(`gh release edit failed: ${edit.err || edit.out}`);
				} else {
					throw new Error(`gh release create failed: ${msg}`);
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
if (doDocker)
	await publishDockerImage();
if (doGit || doGh)
	await publishGitAndGithub();

console.log("\nRelease summary:");
console.log(`- Version: ${version}`);
if (doDocker)
	console.log(`- Docker: ${dockerRepoArg ?? "spintheweb/webspinner"}`);
if (doGit)
	console.log(`- Git: tag ${version}`);
if (doGh)
	console.log(`- GitHub: release ${version}`);
if (keepArtifacts)
	console.log(`- Artifacts retained in ${outDir}`);

// Cleanup local artifacts
if (!dryRun && !keepArtifacts) {
	try {
		await rm(outDir, { recursive: true });
		console.log("Cleaned release artifacts:", outDir);
	}
	catch (e) {
		console.warn("Cleanup failed for", outDir, "-", e instanceof Error ? e.message : String(e));
	}
} else {
	console.log("[dry-run] Skipping cleanup of", outDir);
}
