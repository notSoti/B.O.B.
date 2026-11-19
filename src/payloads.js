import { InteractionResponseFlags, MessageComponentTypes } from "discord-interactions";
import { COLORS } from "./constants.js";
import { emoji } from "./emojis.js";

/**
 * Builds an ephemeral Components V2 success payload.
 * @param {string} message Success message.
 * @param {object} [options] Payload options.
 * @param {boolean} [options.ephemeral] Whether the payload is ephemeral. Defaults to true.
 * @returns {object} Discord message payload.
 */
export function successPayload(message, { ephemeral = true } = {}) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | (ephemeral ? InteractionResponseFlags.EPHEMERAL : 0),
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.success,
			components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: `${emoji("success")} ${message}` }],
		}],
	};
}

/**
 * Builds an ephemeral Components V2 error payload.
 * @param {string} message Error message.
 * @param {object} [options] Payload options.
 * @param {boolean} [options.ephemeral] Whether the payload is ephemeral. Defaults to true.
 * @returns {object} Discord message payload.
 */
export function errorPayload(message, { ephemeral = true } = {}) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | (ephemeral ? InteractionResponseFlags.EPHEMERAL : 0),
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.error,
			components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: `${emoji("error")} ${message}` }],
		}],
	};
}
