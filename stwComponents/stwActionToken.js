import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = randomBytes(32);

function sessionActionKey(sessionId) {
	if (typeof sessionId !== "string" || !sessionId) throw new TypeError("A session ID is required to sign an action");
	return createHmac("sha256", secret).update(`action-token\0${sessionId}`).digest();
}

function signAction(payload, sessionId) {
	const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", sessionActionKey(sessionId)).update(value).digest("base64url");
	return `${value}.${signature}`;
}

function verifyAction(token, sessionId) {
	if (typeof token !== "string") return null;
	const [value, signature, ...rest] = token.split(".");
	if (!value || !signature || rest.length) return null;
	let expected;
	try {
		expected = createHmac("sha256", sessionActionKey(sessionId)).update(value).digest();
	} catch {
		return null;
	}
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
