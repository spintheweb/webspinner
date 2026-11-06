import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
function isNotFoundError(error) {
	return error?.code === "ENOENT";
}
function runCommand(command, args, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"]
		});
		child.stdin?.end(options.input);
		const stdout = [];
		const stderr = [];
		child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
		child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
		const timer = options.timeoutMs ? setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
		}, options.timeoutMs) : void 0;
		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolvePromise({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8")
			});
		});
	});
}
function getCookies(headers) {
	const cookies = {};
	for (const cookie of headers.get("cookie")?.split(";") ?? []) {
		const separator = cookie.indexOf("=");
		if (separator < 0) continue;
		const name = cookie.slice(0, separator).trim();
		const value = cookie.slice(separator + 1).trim();
		try {
			cookies[name] = decodeURIComponent(value);
		} catch {
			cookies[name] = value;
		}
	}
	return cookies;
}
function setCookie(headers, cookie) {
	const value = [
		`${cookie.name}=${encodeURIComponent(cookie.value)}`,
		"Path=/",
		cookie.httpOnly ? "HttpOnly" : "",
		cookie.secure ? "Secure" : "",
		cookie.sameSite ? `SameSite=${cookie.sameSite}` : ""
	].filter(Boolean).join("; ");
	headers.append("Set-Cookie", value);
}
async function serveFile(_request, requestedPath) {
	const root = resolve("public");
	const filePath = resolve(requestedPath);
	if (!isWithin(root, filePath)) {
		return new Response("Forbidden", { status: 403 });
	}
	try {
		const actualRoot = await realpath(root);
		const actualPath = await realpath(filePath);
		if (!isWithin(actualRoot, actualPath)) return new Response("Forbidden", { status: 403 });
		const body = await readFile(actualPath);
		return new Response(body, {
			headers: { "Content-Type": contentType(filePath) }
		});
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return new Response("Not Found", { status: 404 });
		}
		throw error;
	}
}
function isWithin(root, path) {
	const relativePath = relative(root, path);
	return !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}
function contentType(filePath) {
	switch (extname(filePath).toLowerCase()) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".js":
			return "application/javascript; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".gif":
			return "image/gif";
		case ".ico":
			return "image/x-icon";
		default:
			return "application/octet-stream";
	}
}
export {
	getCookies,
	isNotFoundError,
	runCommand,
	serveFile,
	setCookie
};
