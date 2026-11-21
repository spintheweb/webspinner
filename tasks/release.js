/**
 * @fileoverview Builds and optionally publishes Webspinner release artifacts.
 *
 * Reads and updates package versions, builds server installers and SHA256
 * checksums, and optionally builds/pushes Docker images, git tags, and
 * GitHub releases.
 *
 * Usage:
 *   node tasks/release.js [options]
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module tasks/release
 * @note Copilot-assisted
 * @license Apache-2.0
 * Common options:
 *   --version vX.Y.Z     Set the release version explicitly (without the v prefix also works)
 *   --publish            Run Docker + Git + GitHub publishing steps
 *   --git                Push the tag and version bump to git
 *   --gh                 Create the GitHub release for the matching pushed tag
 *   --docker             Build and push Docker images
 *   --docker-buildx      Use docker buildx with linux/amd64 and linux/arm64
 *   --skip-git-tag       Skip tag creation while still allowing other git operations
 *   --docker-repo <repo> Override the Docker repository (default: spintheweb/webspinner)
 *   --no-bump            Do not auto-bump the patch version
 *   --dry-run            Print the commands that would run without executing them
 *   --output-dir <path>  Write the installer and checksum to this directory
 *   --keep-artifacts     Retain generated files (the default)
 *
 * Examples:
 *   node tasks/release.js --version v0.3.6 --dry-run
 *   node tasks/release.js --publish --docker-repo myorg/webspinner
 *   node tasks/release.js --gh --git --version 0.3.6 --keep-artifacts
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
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
const outDir = resolve(getArg("output-dir", join(cwd, "deployment", "release")));
const doGit = getFlag("git") || getFlag("publish");
const doGh = getFlag("gh") || getFlag("publish");

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
	const json = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
	if (typeof json.version !== "string") throw new TypeError("package.json must contain a version");
	return json.version;
}

function ensureV(v) { return v.startsWith("v") ? v : `v${v}`; }

await ensurePackageFiles();

if (doGit || doGh) {
	const status = await runCommand("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd });
	if (status.code !== 0) throw new Error(`git status failed: ${status.stderr}`);
	if (status.stdout.trim()) throw new Error("Publishing requires a clean working tree");
}

const cliVersion = getArg("version");
let bumpedTo = null;
const currentVersion = await readPackageVersion();
const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(currentVersion);
if (!match) throw new TypeError(`Invalid package version: ${currentVersion}`);
const nextVersion = cliVersion ? cliVersion.replace(/^v/, "") : getFlag("no-bump") ? currentVersion :
	`${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4]}`;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
	throw new TypeError(`Invalid release version: ${nextVersion}`);
}
if (!dryRun && nextVersion !== currentVersion) {
	await writePackageVersion(nextVersion);
	console.log(`Version set in package.json: ${currentVersion} -> ${nextVersion}`);
	bumpedTo = nextVersion;
}

const version = ensureV(nextVersion);
async function commandExists(cmd) {
	try {
		return (await runCommand(cmd, ["--version"])).code === 0;
	}
	catch {
		return false;
	}
}

async function run(cmd, args, opts) {
	const res = await runCommand(cmd, args, { cwd: opts?.cwd ?? cwd, env: opts?.env });
	return { code: res.code ?? 1, out: res.stdout.trim(), err: res.stderr.trim() };
}

// Bash runner (Git Bash, WSL, sh)
async function tryRunBashLine(line) {
	const candidates = [
		{ cmd: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["-c", line] },
		{ cmd: "C:\\Program Files\\Git\\usr\\bin\\bash.exe", args: ["-c", line] },
		{ cmd: "bash", args: ["-c", line] },
		{ cmd: "sh", args: ["-c", line] },
	];
	for (const c of candidates) {
		try {
			const r = await run(c.cmd, c.args, { env: { ...process.env, STW_RELEASE_DIR: outDir } });
			if (r.code !== 0) throw new Error(`Installer build failed: ${r.err || r.out}`);
			return r;
		}
		catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	throw new Error("No bash/sh executable available");
}

async function buildServerInstaller() {
	await mkdir(outDir, { recursive: true });
	if (await exists(join(outDir, "server.sh")) || await exists(join(outDir, "server.sh.sha256"))) {
		throw new Error(`Release artifacts already exist in ${outDir}; choose another output directory`);
	}
	const line = `bash ./deployment/build-server.sh --non-interactive`;
	await tryRunBashLine(line);
	const preferred = join(outDir, "server.sh");
	if (await exists(preferred))
		return preferred;
	throw new Error("Server installer not found after build");
}

async function writeChecksumIfExists(path) {
	if (!path || !(await exists(path)))
		return;
	const data = await readFile(path);
	const hex = createHash("sha256").update(data).digest("hex");
	await writeFile(`${path}.sha256`, `${hex}  ${basename(path)}\n`);
	console.log(`Checksum written: ${path}.sha256`);
}

if (dryRun) {
	console.log(`[dry-run] Build installer ${join(outDir, "server.sh")}`);
} else {
	console.log("Generating server installer (non-interactive)...");
	const serverPath = await buildServerInstaller();
	await writeChecksumIfExists(serverPath);
}

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
				const add = await run("git", ["add", "package.json", "package-lock.json"]);
				if (add.code !== 0) throw new Error(`git add failed: ${add.err || add.out}`);
				const commit = await run("git", ["commit", "-m", `chore(release): ${tag}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`]);
				if (commit.code !== 0) throw new Error(`git commit failed: ${commit.err || commit.out}`);
			} else {
				console.log(`[dry-run] git add package.json package-lock.json && git commit -m "chore(release): ${tag}"`);
			}
		}
		const hasTag = await run("git", ["tag", "-l", tag]);
		if (!hasTag.out.split(/\r?\n/).includes(tag)) {
			console.log(`Creating git tag ${tag}`);
			if (!dryRun) {
				const result = await run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
				if (result.code !== 0) throw new Error(`git tag failed: ${result.err || result.out}`);
			}
			else
				console.log(`[dry-run] git tag -a ${tag} -m "Release ${tag}"`);
		} else {
			const target = await run("git", ["rev-list", "-n", "1", tag]);
			const head = await run("git", ["rev-parse", "HEAD"]);
			if (target.code !== 0 || head.code !== 0 || target.out !== head.out) {
				throw new Error(`Existing tag ${tag} does not point to HEAD`);
			}
		}
		if (!dryRun) {
			const push = await run("git", ["push"]);
			if (push.code !== 0) throw new Error(`git push failed: ${push.err || push.out}`);
			const pushTag = await run("git", ["push", "origin", tag]);
			if (pushTag.code !== 0) throw new Error(`git push tag failed: ${pushTag.err || pushTag.out}`);
		} else
			console.log(`[dry-run] git push && git push origin ${tag}`);
	}
	if (doGh) {
		if (!(await commandExists("gh")))
			throw new Error("GitHub release requested but gh is not installed or not on PATH");
		if (!dryRun) {
			const head = await run("git", ["rev-parse", "HEAD"]);
			const target = await run("git", ["rev-list", "-n", "1", `refs/tags/${tag}`]);
			const localTag = await run("git", ["rev-parse", `refs/tags/${tag}`]);
			const remoteTag = await run("git", ["ls-remote", "--refs", "origin", `refs/tags/${tag}`]);
			if (head.code !== 0 || target.code !== 0 || localTag.code !== 0 || remoteTag.code !== 0 ||
				target.out !== head.out || remoteTag.out.split(/\s+/)[0] !== localTag.out) {
				throw new Error(`Tag ${tag} must point to HEAD and match the pushed origin tag`);
			}
		}
		const serverShPath = join(outDir, "server.sh");
		const serverShShaPath = `${serverShPath}.sha256`;
		if (!dryRun && (!(await exists(serverShPath)) || !(await exists(serverShShaPath)))) {
			throw new Error("Server installer and checksum are required for a release");
		}
		const assets = [serverShPath, serverShShaPath];
		const title = `Release ${tag} (Server Installer)`;
		const notes = `### Overview

Self-extracting installer for Linux systems. Includes the runtime, automated dependency installation, and configuration.

### Components

- Spin the Web framework and public directory
- Node.js runtime
- nginx reverse proxy and Let's Encrypt SSL/TLS
- PostgreSQL database and connector
- systemd service

### Installation

\`\`\`bash
sudo ./server.sh
\`\`\`

### Upgrade

Run the installer on an existing installation to upgrade. Configuration, user data, certificates, and webbase are preserved by default.

### Requirements

- Linux (Ubuntu, Debian, RHEL, CentOS, Fedora, Arch)
- Root privileges
- Ports 80/443 accessible
- DNS configured

### Verification

\`\`\`bash
sha256sum -c server.sh.sha256
\`\`\`

### Service Management

\`\`\`bash
systemctl status webspinner
systemctl restart webspinner
journalctl -u webspinner -f
\`\`\`

For documentation, see the [project wiki](https://github.com/spintheweb/webspinner/wiki).${dockerNotesSection}`;
		const args = ["release", "create", tag, ...assets, "--title", title, "--notes", notes];
		if (!dryRun) {
			const r = await run("gh", args);
			if (r.code !== 0) throw new Error(`gh release create failed: ${r.err || r.out}`);
			console.log("GitHub release created for", tag);
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
console.log(`- Artifacts: ${outDir}`);
