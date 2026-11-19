import {
	ButtonStyleTypes,
	InteractionResponseFlags,
	MessageComponentTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { emoji } from "../emojis.js";
import { hasManageGuild } from "../utils.js";

export default {
	name: "automod",
	description: "Toggle the backup Discord Automod rules.",
	componentsV2: true,
	options: [
		{
			name: "enabled",
			description: "Enable or disable all pre-selected Automod rules.",
			type: 5,
			required: false,
		},
	],
	async execute(interaction, discord, database) {
		const userId = interaction.member?.user?.id;
		const options = interaction.data.options ?? [];
		const enabledOption = options.find((option) => option.name === "enabled");
		const ephemeralFlags = InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL;
		const responseFlags = InteractionResponseFlags.IS_COMPONENTS_V2;

		if (!userId) {
			return {
				flags: ephemeralFlags,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: COLORS.error,
					components: [{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: "Could not determine the user for this Automod request.",
					}],
				}],
			};
		}

		const selectedRuleIds = await database.getAutomodRuleSelectionIds(interaction.guild_id);
		if (!selectedRuleIds.length) {
			return {
				flags: responseFlags,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: COLORS.main,
					components: [{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: "No Automod rules are selected. Configure them in `/settings`.",
					}],
				}],
			};
		}
		if (!hasManageGuild(interaction.app_permissions)) {
			return {
				flags: ephemeralFlags,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: COLORS.error,
					components: [{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: "I need Manage Server permission to manage Automod rules.",
					}],
				}],
			};
		}

		const rules = await discord.listAutoModerationRules(interaction.guild_id);
		const managedRules = rules.filter((rule) => selectedRuleIds.includes(rule.id));
		if (enabledOption && managedRules.length === 0) {
			return {
				flags: responseFlags,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: COLORS.main,
					components: [{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: "None of the managed Automod rules currently exist on this server.",
					}],
				}],
			};
		}
		const results = [];

		if (enabledOption) {
			for (const rule of managedRules) {
				if (rule.enabled === enabledOption.value) {
					results.push(`- ${rule.name}: already ${enabledOption.value ? "enabled" : "disabled"}`);
					continue;
				}

				try {
					await discord.setAutoModerationRuleEnabled(interaction.guild_id, rule.id, enabledOption.value);
					rule.enabled = enabledOption.value;
					results.push(`- ${rule.name}: ${enabledOption.value ? "enabled" : "disabled"}`);
				}
				catch (error) {
					console.error(`Failed to update Automod rule ${rule.id}:`, error);
					results.push(`- ${rule.name}: update failed`);
				}
			}
		}

		const allEnabled = managedRules.every((rule) => rule.enabled);
		const status = managedRules.map((rule) =>
			`${rule.enabled ? "🟢" : "⚪"} **${rule.name}**: ${rule.enabled ? "Enabled" : "Disabled"}`,
		).join("\n");
		const components = [{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: `## ${emoji("gears")} Automod rules\n${status}`,
		}];

		if (!enabledOption) {
			const toggleEnabled = !allEnabled;
			components.push({
				type: MessageComponentTypes.SECTION,
				components: [{
					type: MessageComponentTypes.TEXT_DISPLAY,
					content: `Set all ${managedRules.length} managed rules to ${toggleEnabled ? "enabled" : "disabled"}.`,
				}],
				accessory: {
					type: MessageComponentTypes.BUTTON,
					custom_id: `automod:state:${userId}:${toggleEnabled ? "on" : "off"}`,
					label: toggleEnabled ? "Enable all" : "Disable all",
					style: toggleEnabled ? ButtonStyleTypes.SUCCESS : ButtonStyleTypes.DANGER,
				},
			});
		}

		return {
			flags: InteractionResponseFlags.IS_COMPONENTS_V2,
			components: [{
				type: MessageComponentTypes.CONTAINER,
				accent_color: enabledOption
					? (results.some((result) => result.includes("update failed")) ? COLORS.error : COLORS.success)
					: COLORS.main,
				components,
			}],
		};
	},
};
