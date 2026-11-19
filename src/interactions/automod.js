import {
	InteractionResponseFlags,
	InteractionResponseType,
	MessageComponentTypes,
	ButtonStyleTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { hasManageGuild } from "../utils.js";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

export function handleAutomodInteraction(interaction, database, discord) {
	const customId = interaction.data?.custom_id ?? "";
	const match = /^automod:state:(\d{17,20}):(on|off)$/.exec(customId);

	if (!match) {
		return null;
	}

	const [, ownerId, state] = match;
	const userId = getInvokerId(interaction);

	if (!interaction.guild_id || !userId || ownerId !== userId) {
		return {
			response: {
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
					components: [{
						type: MessageComponentTypes.CONTAINER,
						accent_color: COLORS.error,
						components: [{
							type: MessageComponentTypes.TEXT_DISPLAY,
							content: "Only the person who opened this Automod menu can use it, and only in its server.",
						}],
					}],
				},
			},
		};
	}

	if (interaction.data.component_type !== MessageComponentTypes.BUTTON) {
		return {
			response: {
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
					components: [{
						type: MessageComponentTypes.CONTAINER,
						accent_color: COLORS.error,
						components: [{
							type: MessageComponentTypes.TEXT_DISPLAY,
							content: "This Automod control is invalid.",
						}],
					}],
				},
			},
		};
	}

	return {
		response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
		completion: (async () => {
			if (!hasManageGuild(interaction.app_permissions)) {
				return discord.createFollowupResponse({
					flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
					components: [{
						type: MessageComponentTypes.CONTAINER,
						accent_color: COLORS.error,
						components: [{
							type: MessageComponentTypes.TEXT_DISPLAY,
							content: "I need Manage Server permission to manage Automod rules.",
						}],
					}],
				});
			}

			const rules = await discord.listAutoModerationRules(interaction.guild_id);

			const selectedRuleIds = await database.getAutomodRuleSelectionIds(interaction.guild_id);
			const managedRules = rules.filter((rule) => selectedRuleIds.includes(rule.id));
			const results = [];

			for (const rule of managedRules) {
				if (rule.enabled === (state === "on")) {
					results.push(`- ${rule.name}: already ${state === "on" ? "enabled" : "disabled"}`);
					continue;
				}

				try {
					await discord.setAutoModerationRuleEnabled(interaction.guild_id, rule.id, state === "on");
					rule.enabled = state === "on";
					results.push(`- ${rule.name}: ${state === "on" ? "enabled" : "disabled"}`);
				}
				catch (error) {
					console.error(`Failed to update Automod rule ${rule.id}:`, error);
					results.push(`- ${rule.name}: update failed`);
				}
			}

			const allEnabled = managedRules.every((rule) => rule.enabled);
			const nextState = !allEnabled;
			const status = managedRules.map((rule) =>
				`${rule.enabled ? "🟢" : "⚪"} **${rule.name}** — ${rule.enabled ? "Enabled" : "Disabled"}`,
			).join("\n");

			return discord.editOriginalResponse({
				flags: InteractionResponseFlags.IS_COMPONENTS_V2,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: results.some((result) => result.includes("update failed")) ? COLORS.error : COLORS.success,
					components: [
						{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## Automod rules\n${status}` },
						{
							type: MessageComponentTypes.SECTION,
							components: [{
								type: MessageComponentTypes.TEXT_DISPLAY,
								content: `Set all ${managedRules.length} managed rules to ${nextState ? "enabled" : "disabled"}.`,
							}],
							accessory: {
								type: MessageComponentTypes.BUTTON,
								custom_id: `automod:state:${userId}:${nextState ? "on" : "off"}`,
								label: nextState ? "Enable all" : "Disable all",
								style: nextState ? ButtonStyleTypes.SUCCESS : ButtonStyleTypes.DANGER,
							},
						},
					],
				}],
			});

		})(),
	};
}
