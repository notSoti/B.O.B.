import {
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
} from "discord-interactions";
import { errorPayload } from "../payloads.js";
import { hasManageGuild } from "../utils.js";
import { buildSettingsMenuPayload, buildSettingsModal } from "../commands/settings.js";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function responseWith(type, data) {
	return { response: { type, ...(data ? { data } : {}) } };
}

function parseComponents(components = [], values = {}) {
	for (const item of components) {
		const component = item.component;
		if (component?.custom_id) {
			if (Array.isArray(component.values)) {
				values[component.custom_id] = component.values;
			}
			else if (component.value !== undefined) {
				values[component.custom_id] = component.value;
			}
		}
		parseComponents(item.components, values);
	}
	return values;
}

function validChannels(values, max = 25) {
	return Array.isArray(values)
		&& values.length <= max
		&& values.every((channelId) => /^\d{17,20}$/.test(channelId))
		&& new Set(values).size === values.length;
}

export async function handleSettingsInteraction(interaction, database, discord) {
	const customId = interaction.data?.custom_id ?? "";
	const selectMatch = /^settings:select:(\d{17,20})$/.exec(customId);
	const modalMatch = /^settings:submit:(lockdown|automod|modlogs|issues):(\d{17,20}):(\d{17,20})$/.exec(customId);
	if (!selectMatch && !modalMatch) {
		return null;
	}

	const userId = getInvokerId(interaction);
	const ownerId = selectMatch?.[1] ?? modalMatch?.[3];
	if (!interaction.guild_id || !userId || ownerId !== userId) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("Only the person who opened this settings menu can use it."));
	}
	if (!hasManageGuild(interaction.member?.permissions)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("You need Manage Server permission to change these settings."));
	}

	if (selectMatch) {
		if (
			interaction.type !== InteractionType.MESSAGE_COMPONENT
			|| interaction.data.component_type !== MessageComponentTypes.STRING_SELECT
			|| interaction.data.values?.length !== 1
		) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This settings selection is invalid."));
		}

		const setting = interaction.data.values[0];
		if (!["lockdown", "automod", "modlogs", "issues"].includes(setting)) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("Unknown settings section."));
		}
		if (!hasManageGuild(interaction.app_permissions)) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("I need Manage Server permission to read these settings."));
		}

		const automodRules = setting === "automod" ? await discord.listAutoModerationRules(interaction.guild_id) : [];
		return {
			response: {
				type: InteractionResponseType.MODAL,
				data: await buildSettingsModal(setting, interaction.guild_id, userId, database, automodRules),
			},
			completion: discord.editOriginalResponse(buildSettingsMenuPayload(userId)),
		};
	}

	if (interaction.type !== InteractionType.MODAL_SUBMIT || modalMatch[2] !== interaction.guild_id) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This settings form is invalid."));
	}
	if (!hasManageGuild(interaction.app_permissions)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("I need Manage Server permission to save these settings."));
	}

	return {
		response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
		completion: (async () => {
			const setting = modalMatch[1];
			const values = parseComponents(interaction.data.components);
			if (setting === "lockdown") {
				const general = values.general_channels ?? [];
				const support = values.support_channels ?? [];
				if (!validChannels(general) || !validChannels(support)) {
					return discord.editOriginalResponse(errorPayload("The selected category channels are invalid."));
				}
				if (general.some((channelId) => support.includes(channelId))) {
					return discord.editOriginalResponse(errorPayload("A channel cannot belong to both General and Support."));
				}
				const guildChannels = await discord.listGuildChannels(interaction.guild_id);
				const eligibleChannelIds = new Set(guildChannels.filter((channel) => [0, 5, 15].includes(channel.type)).map(({ id }) => id));
				if ([...general, ...support].some((channelId) => !eligibleChannelIds.has(channelId))) {
					return discord.editOriginalResponse(errorPayload("Select only text, announcement, or forum channels from this server."));
				}
				await database.saveLockdownCategoryChannels(interaction.guild_id, { General: general, Support: support });
				return discord.editOriginalResponse(buildSettingsMenuPayload(userId, `Lockdown categories saved: ${general.length} General and ${support.length} Support channel(s).`));
			}

			if (setting === "automod") {
				const selectedRuleIds = values.automod_rules ?? [];
				const rules = await discord.listAutoModerationRules(interaction.guild_id);
				const configuredIds = new Set((await database.getAutomodRuleSelectionIds(interaction.guild_id)));
				const availableIds = new Set(rules.map(({ id }) => id));
				const validIds = new Set([...availableIds, ...configuredIds]);
				if (
					selectedRuleIds.length > 25
					|| new Set(selectedRuleIds).size !== selectedRuleIds.length
					|| selectedRuleIds.some((id) => !validIds.has(id))
				) {
					return discord.editOriginalResponse(errorPayload("The selected Automod rules are invalid. Reopen Settings and try again."));
				}
				const ruleNames = new Map(rules.map(({ id, name }) => [id, name]));
				const selectedRules = selectedRuleIds.map((id) => ({
					id,
					name: ruleNames.get(id) ?? `Unavailable rule ${id}`,
				}));
				await database.saveAutomodRuleSelections(interaction.guild_id, selectedRules);
				return discord.editOriginalResponse(buildSettingsMenuPayload(userId, `${selectedRuleIds.length} Automod rule(s) saved.`));
			}

			if (setting === "issues") {
				const channelIds = values.issue_channel ?? [];
				if (!validChannels(channelIds, 1) || channelIds.length !== 1) {
					return discord.editOriginalResponse(errorPayload("Select one valid issue channel."));
				}
				const channelId = channelIds[0];
				const channel = (await discord.listGuildChannels(interaction.guild_id)).find(({ id }) => id === channelId);
				if (!channel || ![0, 5].includes(channel.type)) {
					return discord.editOriginalResponse(errorPayload("Select a text or announcement channel from this server."));
				}
				if (!hasManageGuild(interaction.app_permissions)) {
					return discord.editOriginalResponse(errorPayload("I need Manage Server permission to configure issue posts."));
				}

				const existing = await database.getIssueChannelSettings(interaction.guild_id);
				let webhook;
				try {
					webhook = existing?.channel_id === channelId && existing.webhook_id && existing.webhook_token
						? { id: existing.webhook_id, token: existing.webhook_token }
						: await discord.createWebhook(channelId, "Dyno Status");
				}
				catch (error) {
					console.error("Could not create issue webhook:", error);
					return discord.editOriginalResponse(errorPayload("I couldn't create a webhook in that channel. Make sure I have Manage Webhooks there, then try again."));
				}
				if (!webhook.token) {
					return discord.editOriginalResponse(errorPayload("Discord did not return a webhook token. Check Manage Webhooks permission and try again."));
				}
				await database.saveIssueChannelSettings(interaction.guild_id, {
					channelId,
					webhookId: webhook.id,
					webhookToken: webhook.token,
				});
				return discord.editOriginalResponse(buildSettingsMenuPayload(userId, `Dyno Status posts will be sent to <#${channelId}>. The posting webhook is ready; you can change its avatar through Discord's settings.`));
			}

			const channelIds = values.modlogs_channel ?? [];
			if (!validChannels(channelIds, 1)) {
				return discord.editOriginalResponse(errorPayload("Select at most one valid modlogs channel."));
			}
			const channelId = channelIds[0] ?? null;
			if (channelId) {
				const channel = (await discord.listGuildChannels(interaction.guild_id)).find(({ id }) => id === channelId);
				if (!channel || ![0, 5].includes(channel.type)) {
					return discord.editOriginalResponse(errorPayload("Select a text or announcement channel from this server."));
				}
			}
			await database.saveGuildSettings(interaction.guild_id, { modlogsChannelId: channelId });
			return discord.editOriginalResponse(buildSettingsMenuPayload(userId, channelId ? "Modlogs channel saved." : "Modlogs disabled."));
		})(),
	};
}
