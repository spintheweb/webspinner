/*
 * Build the Webspinner Docker image locally without pushing it to a registry.
 *
 * Usage:
 *   npm run dockerize
 *   npm run dockerize -- --tag spintheweb/webspinner:dev
 *
 * The default image name matches docker-compose.yml. After building, start it with:
 *   docker compose up -d --no-build
 *
 * Options:
 *   --tag <image:tag>       Override the image name/tag
 *   --node-version <major>  Set the Node.js base image version (default: 26)
 *   --no-cache              Build without using Docker's build cache
 */
import { runCommand } from "../stwComponents/stwNode.js";

const args = process.argv.slice(2);
function getOption(name, fallback) {
	const index = args.findIndex((arg) => arg === `--${name}`);
	if (index < 0)
		return fallback;
	const value = args[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`Option --${name} requires a value`);
	return value;
}

const image = getOption(
	"tag",
	`ghcr.io/spintheweb/webspinner:${process.env.WEBSPINNER_IMAGE_TAG || "latest"}`,
);
const nodeVersion = getOption("node-version", process.env.NODE_VERSION || "26");
const noCache = args.includes("--no-cache");
const unknownArgs = args.filter((arg, index) => {
	if (arg === "--no-cache")
		return false;
	if (arg === "--tag" || arg === "--node-version")
		return false;
	if (index > 0 && (args[index - 1] === "--tag" || args[index - 1] === "--node-version"))
		return false;
	return arg.startsWith("--");
});
if (unknownArgs.length)
	throw new Error(`Unknown option(s): ${unknownArgs.join(", ")}`);

const docker = await runCommand("docker", ["info"], { cwd: process.cwd() });
if (docker.code !== 0)
	throw new Error(`Docker is unavailable or not running: ${docker.stderr.trim() || docker.stdout.trim()}`);

const buildArgs = [
	"build",
	"--file", "deployment/Dockerfile",
	"--tag", image,
	"--build-arg", `NODE_VERSION=${nodeVersion}`,
];
if (noCache)
	buildArgs.push("--no-cache");
buildArgs.push(".");

console.log(`Building ${image} locally (no registry push)...`);
const result = await runCommand("docker", buildArgs, { cwd: process.cwd() });
if (result.code !== 0)
	throw new Error(`Docker build failed: ${result.stderr.trim() || result.stdout.trim()}`);
if (result.stdout.trim())
	console.log(result.stdout.trim());

console.log(`Built ${image}. Start it with: docker compose up -d --no-build`);
