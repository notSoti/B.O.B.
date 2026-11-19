import ms from "ms";
import { COLORS } from "../constants.js";
import { errorPayload, successPayload } from "../payloads.js";
import { discordTimestamp, escapeMarkdown, hasModerateMembers } from "../utils.js";

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export default {
	name: "mute",
	description: "Timeout a member and optionally send them a direct message.",
	componentsV2: true,
	options: [
		{
			name: "target",
			description: "Member to timeout.",
			type: 6,
			required: true,
		},
		{
			name: "duration",
			description: "Timeout duration, for example 10m, 2 hours, or 7 days (maximum 28 days).",
			type: 3,
			required: true,
		},
		{
			name: "reason",
			description: "Reason for the timeout.",
			type: 3,
			required: false,
		},
		{
			name: "dm_target",
			description: "Send the member a direct message about the timeout. Defaults to true.",
			type: 5,
			required: false,
		},
	],
	async execute(interaction, discord, database) {
		const options = interaction.data.options ?? [];
		const targetId = options.find((option) => option.name === "target")?.value;
		const durationInput = options.find((option) => option.name === "duration")?.value;
		const reasonInput = options.find((option) => option.name === "reason")?.value;
		const dmOption = options.find((option) => option.name === "dm_target");
		const shouldDm = dmOption ? dmOption.value : true;
		const reason = typeof reasonInput === "string" && reasonInput.trim()
			? reasonInput.trim().slice(0, 512)
			: "No reason provided.";
		const parsedDuration = typeof durationInput === "string" ? ms(durationInput) : null;
		const durationMs = parsedDuration > 0 && parsedDuration <= MAX_TIMEOUT_MS ? parsedDuration : null;

		if (!targetId || !durationMs) {
			return errorPayload("Provide a valid duration such as `10m`, `2h`, or `7d` (maximum 28 days).");
		}
		if (targetId === interaction.member?.user?.id) {
			return errorPayload("You cannot timeout yourself.");
		}
		if (!hasModerateMembers(interaction.app_permissions)) {
			return errorPayload("I need the Moderate Members permission to timeout members.");
		}

		const guildId = interaction.guild_id;
		const actorId = interaction.member?.user?.id;
		const guild = await discord.getGuild(guildId);
		const roles = await discord.listGuildRoles(guildId);
		const rolePositions = new Map(roles.map(({ id, position }) => [id, position]));
		const actorMember = interaction.member;
		const targetMember = await discord.getGuildMember(guildId, targetId);
		if (!targetMember) {
			return errorPayload("That member is not in this server.");
		}
		if (targetMember.user.bot) {
			return errorPayload("Bots cannot be timed out.");
		}
		if (targetId === guild.owner_id) {
			return errorPayload("The server owner cannot be timed out.");
		}
		const actorHighestRole = Math.max(0, ...(actorMember?.roles ?? []).map((roleId) => rolePositions.get(roleId) ?? 0));
		const targetHighestRole = Math.max(0, ...(targetMember.roles ?? []).map((roleId) => rolePositions.get(roleId) ?? 0));
		if (targetId === actorId || targetHighestRole > actorHighestRole) {
			return errorPayload("You cannot timeout yourself or a member with an equal or higher role.");
		}
		if (targetMember.communication_disabled_until && Date.parse(targetMember.communication_disabled_until) > Date.now()) {
			return errorPayload("That member is already timed out.");
		}

		const timeoutUntil = new Date(Date.now() + durationMs).toISOString();
		await discord.setMemberTimeout(guildId, targetId, timeoutUntil);

		let dmStatus = "Not requested";
		if (shouldDm) {
			try {
				const dmChannel = await discord.createDM(targetId);
				await discord.sendMessage(dmChannel.id, {
					embeds: [{
						color: COLORS.error,
						description: `You were muted in **${escapeMarkdown(interaction.guild?.name ?? "this server")}** until ${discordTimestamp(timeoutUntil, "F")}.\n\n**Reason:** ${reason}`,
					}],
					allowed_mentions: { parse: [] },
				});
				dmStatus = "Sent";
			}
			catch (error) {
				console.error(`Could not DM muted member ${targetId}:`, error);
				dmStatus = "Failed";
			}
		}

		const settings = await database.getGuildSettings(guildId);
		if (settings.modlogs_channel_id) {
			try {
				await discord.createModlogMessage(settings.modlogs_channel_id, {
					color: COLORS.dyno,
					title: "Mute",
					fields: [
						{ name: "Member", value: `<@${targetId}>`, inline: true },
						{ name: "Moderator", value: `<@${actorId}>`, inline: true },
						{ name: "Duration", value: `${durationInput} (expires ${discordTimestamp(timeoutUntil, "R")})`, inline: true },
						{ name: "DM", value: dmStatus, inline: true },
						{ name: "Reason", value: reason },
					],
					timestamp: new Date().toISOString(),
					footer: { text: `ID: ${targetId}` },
				});
			}
			catch (error) {
				console.error("Failed to send mute modlog:", error);
			}
		}

		return successPayload(`***<@${targetId}> has been muted.***`);
	},
};
