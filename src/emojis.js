const DISCORD_API_BASE = "https://discord.com/api/v10";

// Application emoji lookups, cached for the lifetime of the Worker isolate.
// Populated once per isolate by ensureApplicationEmojis; emoji IDs are stable,
// so a fresh deploy (new isolate) naturally picks up portal changes.
const emojiCache = new Map();

let pendingLoad = null;

/**
 * Stores the application's emojis in the cache.
 * @param {object[]} emojis Application emoji objects.
 */
export function setApplicationEmojis(emojis) {
	for (const { name, id, animated } of emojis ?? []) {
		if (name && id) {
			emojiCache.set(name, `<${animated ? "a" : ""}:${name}:${id}>`);
		}
	}
}

/**
 * Loads the application's emojis into the cache once per isolate.
 * @param {object} env Cloudflare Worker bindings with the Discord application ID and bot token.
 * @returns {Promise<void>} Resolves when the cache is populated or the load failed.
 */
export function ensureApplicationEmojis(env) {
	if (emojiCache.size > 0) {
		return Promise.resolve();
	}
	pendingLoad ??= fetch(`${DISCORD_API_BASE}/applications/${env.DISCORD_APPLICATION_ID}/emojis`, {
		headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
	})
		.then(async (response) => {
			if (response.ok) {
				setApplicationEmojis((await response.json()).items);
			}
			else {
				console.error("Could not load application emojis:", response.status);
			}
		})
		.catch((error) => console.error("Could not load application emojis:", error))
		.finally(() => {
			pendingLoad = null;
		});
	return pendingLoad;
}

/**
 * Returns the markup for an application emoji by name, or a fallback when unknown.
 * @param {string} name Emoji name, matching the name uploaded in the Developer Portal.
 * @param {string} [fallback] Value to use when the emoji is not available.
 * @returns {string} Emoji markup such as `<:name:id>`, or the fallback.
 */
export function emoji(name, fallback = "") {
	return emojiCache.get(name) ?? fallback;
}

export { emojiCache as applicationEmojiCache };
