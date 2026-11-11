import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = randomBytes(32);

function signAction(payload) {
	const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", secret).update(value).digest("base64url");
	return `${value}.${signature}`;
}

function verifyAction(token) {
	if (typeof token !== "string") return null;
	const [value, signature, ...rest] = token.split(".");
	if (!value || !signature || rest.length) return null;
	const expected = createHmac("sha256", secret).update(value).digest();
	let actual;
	try {
		actual = Buffer.from(signature, "base64url");
	} catch {
		return null;
	}
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

export {
	signAction,
	verifyAction
};
