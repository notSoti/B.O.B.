import {
	InteractionResponseFlags,
	MessageComponentTypes,
	SeparatorSpacingTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";

// Discord permission bit values, ordered by bit position.
const PERMISSION_BITS = [
	[1n << 0n, "Create Invite"],
	[1n << 1n, "Kick Members"],
	[1n << 2n, "Ban Members"],
	[1n << 3n, "Administrator"],
	[1n << 4n, "Manage Channels"],
	[1n << 5n, "Manage Server"],
	[1n << 6n, "Add Reactions"],
	[1n << 7n, "View Audit Log"],
	[1n << 8n, "Priority Speaker"],
	[1n << 9n, "Video"],
	[1n << 10n, "View Channels"],
	[1n << 11n, "Send Messages"],
	[1n << 12n, "Send TTS Messages"],
	[1n << 13n, "Manage Messages"],
	[1n << 14n, "Embed Links"],
	[1n << 15n, "Attach Files"],
	[1n << 16n, "Read Message History"],
	[1n << 17n, "Mention Everyone"],
	[1n << 18n, "Use External Emoji"],
	[1n << 19n, "View Guild Insights"],
	[1n << 20n, "Connect"],
	[1n << 21n, "Speak"],
	[1n << 22n, "Mute Members"],
	[1n << 23n, "Deafen Members"],
	[1n << 24n, "Move Members"],
	[1n << 25n, "Use Voice Activity"],
	[1n << 26n, "Change Nickname"],
	[1n << 27n, "Manage Nicknames"],
	[1n << 28n, "Manage Roles"],
	[1n << 29n, "Manage Webhooks"],
	[1n << 30n, "Manage Server Expressions"],
	[1n << 31n, "Use Application Commands"],
	[1n << 32n, "Request to Speak"],
	[1n << 33n, "Manage Events"],
	[1n << 34n, "Manage Threads"],
	[1n << 35n, "Create Public Threads"],
	[1n << 36n, "Create Private Threads"],
	[1n << 37n, "Use External Stickers"],
	[1n << 38n, "Send Messages in Threads"],
	[1n << 39n, "Use Embedded Activities"],
	[1n << 40n, "Moderate Members"],
	[1n << 41n, "View Creator Monetization Analytics"],
	[1n << 42n, "Use Soundboard"],
	[1n << 43n, "Create Server Expressions"],
	[1n << 44n, "Create Events"],
	[1n << 45n, "Use External Sounds"],
	[1n << 46n, "Send Voice Messages"],
	[1n << 48n, "Set Voice Channel Status"],
	[1n << 49n, "Send Polls"],
	[1n << 50n, "Use External Apps"],
	[1n << 51n, "Pin Messages"],
	[1n << 52n, "Bypass Slowmode"],
];

export default {
	name: "permissions",
	description: "Decode a permission bitfield into the permissions it holds.",
	componentsV2: true,
	options: [
		{
			name: "bitfield",
			description: "The permission bitfield integer to decode.",
			type: 4,
			required: true,
		},
	],
	async execute(interaction) {
		const option = interaction.data.options?.find(({ name }) => name === "bitfield");
		const bitfield = BigInt(option?.value ?? 0);

		const lines = [
			`## Permission Bitfield (${bitfield.toString()})`,
			{ type: MessageComponentTypes.SEPARATOR, spacing: SeparatorSpacingTypes.SMALL },
		];

		if (bitfield === 0n) {
			lines.push("No permissions set.");
		}
		else {
			const held = PERMISSION_BITS.filter(([bit]) => (bitfield & bit) === bit);
			lines.push(held.length
				? `**Holds ${held.length} permission${held.length === 1 ? "" : "s"}:**\n${held.map(([, name]) => `- ${name}`).join("\n")}`
				: "No known permissions match this bitfield.");
			if ((bitfield & (1n << 3n)) === (1n << 3n)) {
				lines.push("-# Administrator grants all permissions.");
			}
		}

		return {
			flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
			components: [{
				type: MessageComponentTypes.CONTAINER,
				accent_color: COLORS.main,
				components: lines.map((line) => (
					typeof line === "string" ? { type: MessageComponentTypes.TEXT_DISPLAY, content: line } : line
				)),
			}],
		};
	},
};
