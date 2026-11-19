import {
	InteractionResponseFlags,
	MessageComponentTypes,
	SeparatorSpacingTypes,
} from "discord-interactions";
import { discordTimestamp, escapeMarkdown, snowflakeTimestamp } from "../utils.js";
import { COLORS } from "../constants.js";

const UserFlags = {
	VERIFIED_BOT: 1 << 16,
	BOT_HTTP_INTERACTIONS: 1 << 19,
	SPAMMER: 1 << 20,
};

export default {
	name: "whois",
	description: "Show information about a user.",
	componentsV2: true,
	options: [
		{
			name: "user",
			description: "User to look up.",
			type: 6,
			required: false,
		},
	],
	async execute(interaction, discord) {
		const selectedUserId = interaction.data.options?.find((option) => option.name === "user")?.value;
		const invokingUserId = interaction.member?.user?.id ?? interaction.user?.id;
		const userId = selectedUserId ?? invokingUserId;

		const user = await discord.getUser(userId);
		const member = interaction.guild_id
			? await discord.getGuildMember(interaction.guild_id, userId)
			: null;
		const username = escapeMarkdown(user.username);
		const discriminator = user.bot && user.discriminator && user.discriminator !== "0"
			? `#${user.discriminator}`
			: "";
		const displayName = user.global_name ? escapeMarkdown(user.global_name) : username;
		const profileLines = [
			`### ${username}${discriminator}`,
			`**Mention:** <@${user.id}>`,
			`**User ID:** \`${user.id}\``,
			`**Account created:** ${discordTimestamp(snowflakeTimestamp(user.id), "F")} (${discordTimestamp(snowflakeTimestamp(user.id), "R")})`,
		];
		const accountFlags = [
			[UserFlags.VERIFIED_BOT, "Verified bot"],
			[UserFlags.BOT_HTTP_INTERACTIONS, "HTTP interactions only"],
			[UserFlags.SPAMMER, "Flagged as spammer"],
		].filter(([flag]) => (((user.public_flags ?? 0) | (user.flags ?? 0)) & flag) !== 0)
			.map(([, label]) => label);

		profileLines.push(`**Account type:** ${user.bot ? "🤖 Bot account" : "👤 User account"}`);

		if (accountFlags.length) {
			profileLines.push(`**Account flags:** ${accountFlags.join(", ")}`);
		}
		const components = [
			{
				type: MessageComponentTypes.TEXT_DISPLAY,
				content: `## ${displayName}`,
			},
			{
				type: MessageComponentTypes.SEPARATOR,
				spacing: SeparatorSpacingTypes.LARGE,
			},
		];
		const profileSection = {
			type: MessageComponentTypes.SECTION,
			components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: profileLines.join("\n") }],
		};
		const avatarIndex = Number((BigInt(user.id) >> 22n) % 6n);
		const avatarUrl = user.avatar
			? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}`
			: `https://cdn.discordapp.com/embed/avatars/${avatarIndex}.png`;

		profileSection.accessory = {
			type: MessageComponentTypes.THUMBNAIL,
			media: { url: avatarUrl },
		};

		components.push(profileSection);

		if (user.banner) {
			const bannerExtension = user.banner.startsWith("a_") ? "gif" : "png";
			components.push(
				{ type: MessageComponentTypes.SEPARATOR, spacing: SeparatorSpacingTypes.LARGE },
				{
					type: MessageComponentTypes.MEDIA_GALLERY,
					items: [{
						media: {
							url: `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${bannerExtension}?size=1024`,
						},
					}],
				},
			);
		}

		if (member) {
			components.push(
				{ type: MessageComponentTypes.SEPARATOR, spacing: SeparatorSpacingTypes.LARGE },
				{
					type: MessageComponentTypes.TEXT_DISPLAY,
					content: [
						`**Joined server:** ${discordTimestamp(member.joined_at, "F")} (${discordTimestamp(member.joined_at, "R")})`,
						`**Nickname:** ${member.nick ? escapeMarkdown(member.nick) : "None"}`,
						`**Roles (${member.roles.length}):**\n${member.roles.length
							? [...member.roles].reverse().slice(0, 10).map((roleId) => `<@&${roleId}>`).join(",")
							: "None"}${member.roles.length > 10 ? `\n…and ${member.roles.length - 10} more` : ""}`,
					].join("\n"),
				},
			);
			if (member.communication_disabled_until) {
				components.push({
					type: MessageComponentTypes.TEXT_DISPLAY,
					content: `**Timeout until:** ${discordTimestamp(member.communication_disabled_until, "F")} (${discordTimestamp(member.communication_disabled_until, "R")})`,
				});
			}
		}
		else if (interaction.guild_id) {
			components.push(
				{ type: MessageComponentTypes.SEPARATOR, spacing: SeparatorSpacingTypes.LARGE },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "This user is not a member of this server." },
			);
		}

		return {
			flags: InteractionResponseFlags.IS_COMPONENTS_V2,
			components: [
				{
					type: MessageComponentTypes.CONTAINER,
					... { accent_color: COLORS.main },
					components,
				},
			],
			allowed_mentions: { parse: [] },
		};
	},
};