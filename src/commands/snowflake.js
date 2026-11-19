import {
	InteractionResponseFlags,
	MessageComponentTypes,
	SeparatorSpacingTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { errorPayload } from "../payloads.js";
import { discordTimestamp, snowflakeTimestamp } from "../utils.js";

export default {
	name: "snowflake",
	description: "Show the creation time of a Discord snowflake ID.",
	componentsV2: true,
	options: [
		{
			name: "id",
			description: "The snowflake ID to decode.",
			type: 3,
			required: true,
		},
	],
	async execute(interaction) {
		const option = interaction.data.options?.find(({ name }) => name === "id");
		const id = String(option?.value ?? "").trim();

		if (!/^\d{1,25}$/.test(id)) {
			return errorPayload("That doesn't look like a snowflake ID. IDs are numeric, up to 25 digits.");
		}

		const createdAtMs = snowflakeTimestamp(id);
		const unixSeconds = Math.floor(createdAtMs / 1000);

		return {
			flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
			components: [{
				type: MessageComponentTypes.CONTAINER,
				accent_color: COLORS.main,
				components: [
					{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## Snowflake \`${id}\`` },
					{ type: MessageComponentTypes.SEPARATOR, spacing: SeparatorSpacingTypes.SMALL },
					{ type: MessageComponentTypes.TEXT_DISPLAY, content: `**Created:** ${discordTimestamp(createdAtMs, "F")} (\`${unixSeconds}\`)` },
				],
			}],
		};
	},
};
