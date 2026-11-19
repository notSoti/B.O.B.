import {
	InteractionResponseFlags,
	MessageComponentTypes,
	TextStyleTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { successPayload } from "../payloads.js";

export const PREPARED_OUTAGE_MESSAGE = "**Outage**\n\nWe are aware of our services being offline or experiencing issues, please be patient while we investigate.\n\nKeep an eye on <#535189342898094081> for further updates.\nYou can also monitor the real-time status of Dyno at https://dyno.gg/status\n\n***This channel will remain closed until we're back to 100%***";

const LOCKDOWN_OPTIONS = [
	{
		label: "Start Lockdown",
		value: "lock_start",
		description: "Choose categories and optionally send the prepared outage message",
	},
	{
		label: "End Lockdown",
		value: "lock_end",
		description: "Unlock selected categories or all categories",
	},
	{
		label: "Modify Embeds",
		value: "lock_embeds",
		description: "Add, edit, or delete lockdown embeds",
	},
];

const EMBED_OPTIONS = [
	{ label: "Add Embed", value: "add", description: "Create a lockdown embed" },
	{ label: "Edit Embed", value: "edit", description: "Edit a recent lockdown embed" },
	{ label: "Delete Embed", value: "delete", description: "Delete a recent lockdown embed" },
	{ label: "Back to Lockdown Menu", value: "back", description: "Return to the main menu" },
];

export default {
	name: "lockdown",
	description: "Open the lockdown interaction menu.",
	componentsV2: true,
	options: [],
	async execute(interaction) {
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		return buildLockdownMenuPayload(userId);
	},
};

export function buildLockdownMenuPayload(userId, notice) {
	const components = [
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: "## Lockdown Interaction Menu" },
		{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: "### __Options__\n- Start Lockdown: Choose one or more categories to lock. The next step can include a prepared outage announcement, prefilled so you can review or edit it; clear it to lock without sending an announcement.\n- End Lockdown: Unlock one or more categories, or end the lockdown everywhere.\n- Modify Embeds: Add, edit, or delete lockdown embeds.\n- Configure lockdown categories in `/settings`.",
		},
	];
	components.push({
		type: MessageComponentTypes.ACTION_ROW,
		components: [{
			type: MessageComponentTypes.STRING_SELECT,
			custom_id: `lock_select_menu:${userId}`,
			placeholder: "Select lockdown action...",
			min_values: 1,
			max_values: 1,
			required: false,
			options: LOCKDOWN_OPTIONS,
		}],
	});
	if (notice) {
		components.push(
			{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
			{ type: MessageComponentTypes.TEXT_DISPLAY, content: notice },
		);
	}
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: notice ? COLORS.success : COLORS.main,
			components,
		}],
	};
}

export function buildEmbedMenuPayload(userId) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "## Modify Lockdown Embeds" },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Choose an embed action. Categories and details are configured in the next step." },
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [{
						type: MessageComponentTypes.STRING_SELECT,
						custom_id: `lock_embed_menu:${userId}`,
						placeholder: "Choose embed action...",
						min_values: 1,
						max_values: 1,
						options: EMBED_OPTIONS,
					}],
				},
			],
		}],
	};
}

function categoryCheckbox(customId = "categories") {
	const categoryOptions = [
		{ label: "General", value: "General" },
		{ label: "Support", value: "Support" },
	];
	return {
		type: MessageComponentTypes.LABEL,
		label: "Categories",
		description: "Choose one or both categories.",
		component: {
			type: 22,
			custom_id: customId,
			options: categoryOptions,
			min_values: 1,
			max_values: 2,
		},
	};
}

export function buildLockdownActionModal(action, guildId, userId) {
	const isStart = action === "start";
	const components = [
		{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: isStart
				? "Choose which categories to lock. The lockdown message is prefilled; edit it or clear it to skip sending an announcement."
				: "Choose which categories to unlock.",
		},
		categoryCheckbox(),
	];
	if (isStart) {
		components.push({
			type: MessageComponentTypes.LABEL,
			label: "Lockdown Message",
			description: "Edit the prepared message or remove it entirely to send no announcement.",
			component: {
				type: MessageComponentTypes.INPUT_TEXT,
				custom_id: "reason",
				style: TextStyleTypes.PARAGRAPH,
				value: PREPARED_OUTAGE_MESSAGE,
				max_length: 2000,
				required: false,
			},
		});
	}
	return {
		custom_id: `lockdown:action:${action}:${guildId}:${userId}`,
		title: isStart ? "Start Lockdown" : "End Lockdown",
		components,
	};
}

export function buildEmbedActionModal(action, guildId, userId) {
	const components = [
		{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: "Choose the category or categories for this embed action. This step only collects the requested details for now.",
		},
		categoryCheckbox(),
	];

	if (action === "add") {
		components.push({
			type: MessageComponentTypes.LABEL,
			label: "Embed Description",
			component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: "description", style: TextStyleTypes.PARAGRAPH, max_length: 4000, required: true },
		});
	}
	else if (action === "edit") {
		components.push({
			type: MessageComponentTypes.LABEL,
			label: "Replacement Description",
			description: "Replaces only the description; the title and color will be preserved.",
			component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: "description", style: TextStyleTypes.PARAGRAPH, max_length: 4000, required: true },
		});
	}

	return {
		custom_id: `lockdown:embed:${action}:${guildId}:${userId}`,
		title: `${action[0].toUpperCase()}${action.slice(1)} Lockdown Embed`,
		components,
	};
}

export function buildLockdownSuccessPayload(message) {
	return successPayload(`## Lockdown\n${message}`, { ephemeral: false });
}

export function buildLockdownModalResponse(modal) {
	return modal;
}
