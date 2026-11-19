const DISCORD_EPOCH = 1420070400000n;
const MANAGE_GUILD_PERMISSION = 32n;
const MANAGE_ROLES_PERMISSION = 268435456n;
const MODERATE_MEMBERS_PERMISSION = 1099511627776n;

/**
 * Checks whether a Discord permission bitfield contains Manage Server.
 * @param {string|number|bigint} permissions Discord permission bitfield.
 * @returns {boolean} Whether Manage Server is present.
 */
export function hasManageGuild(permissions) {
	return permissions !== undefined
		&& (BigInt(permissions) & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION;
}

/**
 * Checks whether a Discord permission bitfield contains Manage Roles.
 * @param {string|number|bigint} permissions Discord permission bitfield.
 * @returns {boolean} Whether Manage Roles is present.
 */
export function hasManageRoles(permissions) {
	return permissions !== undefined
		&& (BigInt(permissions) & MANAGE_ROLES_PERMISSION) === MANAGE_ROLES_PERMISSION;
}

/**
 * Checks whether a Discord permission bitfield contains Moderate Members.
 * @param {string|number|bigint} permissions Discord permission bitfield.
 * @returns {boolean} Whether Moderate Members is present.
 */
export function hasModerateMembers(permissions) {
	return permissions !== undefined
		&& (BigInt(permissions) & MODERATE_MEMBERS_PERMISSION) === MODERATE_MEMBERS_PERMISSION;
}

/**
 * Escapes Markdown punctuation in user-provided text.
 * @param {string} value Text to escape.
 * @returns {string} Markdown-safe text.
 */
export function escapeMarkdown(value) {
	return String(value).replace(/[\\`*_{}[\]()#+\-.!|>~]/g, "\\$&");
}

/**
 * Converts a Discord snowflake ID to a Unix timestamp in seconds.
 * @param {string} snowflake Discord snowflake ID.
 * @returns {number} Unix timestamp in seconds.
 */
export function snowflakeTimestamp(snowflake) {
	return Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
}

/**
 * Creates a Discord-rendered timestamp from a Date, millisecond timestamp, or Unix timestamp.
 * @param {Date|number|string} value Date or timestamp value.
 * @param {string} style Discord timestamp style, such as F or R.
 * @returns {string} Discord timestamp markup, or "Unknown" for an empty value.
 */
export function discordTimestamp(value, style = "F") {
	if (value === null || value === undefined || value === "") {
		return "Unknown";
	}

	const numericValue = value instanceof Date
		? value.getTime()
		: typeof value === "string" && !Number.isFinite(Number(value))
			? Date.parse(value)
			: Number(value);
	const unixSeconds = Math.floor(numericValue > 100000000000 ? numericValue / 1000 : numericValue);

	if (!Number.isFinite(unixSeconds)) {
		return "Unknown";
	}

	return `<t:${unixSeconds}:${style}>`;
}

