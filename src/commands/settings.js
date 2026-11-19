import {
	InteractionResponseFlags,
	MessageComponentTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { emoji } from "../emojis.js";

const SETTINGS_OPTIONS = [
	{ label: "Lockdown Categories", value: "lockdown", description: "Choose General and Support channels" },
	{ label: "Automod Rules", value: "automod", description: "Choose which Automod rules this bot manages" },
	{ label: "Modlogs Channel", value: "modlogs", description: "Choose where moderation logs are sent" },
	{ label: "Issue Channel", value: "issues", description: "Choose the #dyno-status channel and its posting webhook" },
];

export default {
	name: "settings",
	description: "Configure this server's bot settings.",
	componentsV2: true,
	options: [],
	async execute(interaction) {
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		return buildSettingsMenuPayload(userId);
	},
};

export function buildSettingsMenuPayload(userId, notice) {
	const components = [
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("gears")} Server Settings` },
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Choose a setting to configure. Changes are saved when you submit the modal." },
		{
			type: MessageComponentTypes.ACTION_ROW,
			components: [{
				type: MessageComponentTypes.STRING_SELECT,
				custom_id: `settings:select:${userId}`,
				placeholder: "Choose a setting...",
				min_values: 1,
				max_values: 1,
				options: SETTINGS_OPTIONS,
			}],
		},
	];
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

export async function buildSettingsModal(setting, guildId, userId, database, automodRules = []) {
	if (setting === "issues") {
		const settings = await database.getIssueChannelSettings(guildId);
		return {
			custom_id: `settings:submit:issues:${guildId}:${userId}`,
			title: "Issue Channel",
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Choose the text or announcement channel used for `#dyno-status` posts. Saving creates or reuses the bot-owned webhook used to publish those posts. The bot needs Manage Webhooks in that channel." },
				{
					type: MessageComponentTypes.LABEL,
					label: "Issue Channel",
					component: {
						type: MessageComponentTypes.CHANNEL_SELECT,
						custom_id: "issue_channel",
						channel_types: [0, 5],
						min_values: 1,
						max_values: 1,
						required: true,
						...(settings ? { default_values: [{ id: settings.channel_id, type: "channel" }] } : {}),
					},
				},
			],
		};
	}
	if (setting === "lockdown") {
		const existing = await database.getLockdownCategoryChannels(guildId);
		const general = existing.filter(({ category }) => category === "General").map(({ channel_id: id }) => id);
		const support = existing.filter(({ category }) => category === "Support").map(({ channel_id: id }) => id);
		return {
			custom_id: `settings:submit:lockdown:${guildId}:${userId}`,
			title: "Lockdown Categories",
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Select text, announcement, and forum channels for each lockdown category. A channel can belong to only one category." },
				{
					type: MessageComponentTypes.LABEL,
					label: "General Channels",
					component: {
						type: MessageComponentTypes.CHANNEL_SELECT,
						custom_id: "general_channels",
						channel_types: [0, 5, 15],
						min_values: 0,
						max_values: 25,
						required: false,
						default_values: general.map((id) => ({ id, type: "channel" })),
					},
				},
				{
					type: MessageComponentTypes.LABEL,
					label: "Support Channels",
					component: {
						type: MessageComponentTypes.CHANNEL_SELECT,
						custom_id: "support_channels",
						channel_types: [0, 5, 15],
						min_values: 0,
						max_values: 25,
						required: false,
						default_values: support.map((id) => ({ id, type: "channel" })),
					},
				},
			],
		};
	}
	if (setting === "automod") {
		const selectedRules = await database.getSettingsAutomodRuleSelections(guildId);
		const selectedRuleIds = selectedRules.map(({ rule_id: id }) => id);
		const components = [{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: "Select the Discord Automod rules the `/automod` command should manage.",
		}];
		const availableOptions = automodRules.slice(0, 25).map(({ id, name }) => ({
			label: name.slice(0, 100),
			value: id,
			default: selectedRuleIds.includes(id),
		}));
		const unavailableSelectedOptions = selectedRules
			.filter(({ rule_id: id }) => !automodRules.some((rule) => rule.id === id))
			.slice(0, Math.max(0, 25 - availableOptions.length))
			.map(({ rule_id: id, rule_name: name }) => ({
				label: `${name} (unavailable)`.slice(0, 100),
				value: id,
				default: true,
			}));
		const ruleOptions = [...availableOptions, ...unavailableSelectedOptions];
		if (ruleOptions.length) {
			components.push({
				type: MessageComponentTypes.LABEL,
				label: "Managed Automod Rules",
				component: {
					type: MessageComponentTypes.STRING_SELECT,
					custom_id: "automod_rules",
					options: ruleOptions,
					min_values: 0,
					max_values: ruleOptions.length,
					required: false,
				},
			});
		}
		else {
			components.push({
				type: MessageComponentTypes.TEXT_DISPLAY,
				content: "This server has no Automod rules to select.",
			});
		}
		return {
			custom_id: `settings:submit:automod:${guildId}:${userId}`,
			title: "Automod Settings",
			components,
		};
	}
	const settings = await database.getGuildSettings(guildId);
	return {
		custom_id: `settings:submit:modlogs:${guildId}:${userId}`,
		title: "Modlogs Channel",
		components: [
			{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Choose the channel where moderation log messages will be sent. Clear the selection to disable modlogs." },
			{
				type: MessageComponentTypes.LABEL,
				label: "Modlogs Channel",
				component: {
					type: MessageComponentTypes.CHANNEL_SELECT,
					custom_id: "modlogs_channel",
					channel_types: [0, 5],
					min_values: 0,
					max_values: 1,
					required: false,
					default_values: settings.modlogs_channel_id
						? [{ id: settings.modlogs_channel_id, type: "channel" }]
						: [],
				},
			},
		],
	};
}