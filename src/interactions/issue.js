import {
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { emoji } from "../emojis.js";
import { errorPayload, successPayload } from "../payloads.js";
import { hasManageGuild } from "../utils.js";
import {
	buildIssueMenuPayload,
	buildIssueSelectionPayload,
	buildNewIssueModal,
	buildIssueUpdateModal,
	buildIssueResolveModal,
	buildIssueManageModal,
	buildIssueRawPayload,
	buildIssueManageActionsPayload,
	buildIssueEditModal,
	buildIssueDeleteConfirmPayload,
} from "../commands/issue.js";

const ISSUE_ACTIONS = new Map([
	["new", "New Post"],
	["update", "Update Issue"],
	["publish", "Publish Issue"],
	["resolve", "Resolve Issue"],
	["manage", "Manage Issue"],
]);

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function errorResponse(message) {
	return {
		response: {
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: errorPayload(message),
		},
	};
}

function responseWith(type, data) {
	return { response: { type, ...(data ? { data } : {}) } };
}

function openModal(modal, menuPayload, discord) {
	return {
		response: { type: InteractionResponseType.MODAL, data: modal },
		completion: discord.editOriginalResponse(menuPayload),
	};
}

function parseModalComponents(components = [], values = {}) {
	for (const component of components) {
		const child = component.component;
		if (child?.custom_id) {
			if (Array.isArray(child.values)) {
				values[child.custom_id] = child.values;
			}
			else if (child.value !== undefined) {
				values[child.custom_id] = child.value;
			}
		}
		parseModalComponents(component.components, values);
	}
	return values;
}

const ISSUE_STATUSES = new Map([
	["investigating", "Investigating"],
	["planned", "Planned"],
	["scheduled", "Scheduled"],
	["identified", "Identified"],
	["monitoring", "Monitoring"],
	["resolved", "Resolved"],
]);

const ISSUE_COLORS = {
	major: COLORS.major,
	minor: COLORS.partial,
	announcement: COLORS.dyno,
};

const ISSUE_EMOJIS = {
	major: "status_major",
	minor: "status_partial",
	announcement: "status_dyno",
};

function issueTitleEmoji(issue) {
	return issue.status === "resolved" ? emoji("status_resolved") : emoji(ISSUE_EMOJIS[issue.type] ?? "status_dyno");
}

function issueUpdatePayload(issue) {
	const resolved = issue.status === "resolved";
	const updateLines = issue.updates.map(({ timestamp, message }) => `**<t:${timestamp}:R>** - ${message}`);
	const components = [
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `### ${issueTitleEmoji(issue)} ${issue.title}${resolved ? " - Resolved" : ""}` },
		{ type: MessageComponentTypes.SEPARATOR, spacing: 1, divider: false },
		...(updateLines.length ? [{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: [`**<t:${issue.createdAtTimestamp}:R>** - ${issue.message}`, ...updateLines].join("\n"),
		}] : [{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: `**<t:${issue.createdAtTimestamp}:R>** - ${issue.message}`,
		}]),
		{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `**Status**\n${ISSUE_STATUSES.get(issue.status)}` },
		...(resolved ? [] : [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "-# Updates will be edited into this message." }]),
	];
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{ type: MessageComponentTypes.CONTAINER, accent_color: resolved ? COLORS.resolved : ISSUE_COLORS[issue.type], components }],
		allowed_mentions: { parse: [] },
	};
}

function issuePostPayload({ type, title, status, message, threadEnabled, createdAt }) {
	const resolved = status === "resolved";
	const components = [
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `### ${resolved ? emoji("status_resolved") : emoji(ISSUE_EMOJIS[type] ?? "status_dyno")} ${title}${resolved ? " - Resolved" : ""}` },
		{ type: MessageComponentTypes.SEPARATOR, spacing: 1, divider: false },
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `**<t:${createdAt}:R>** - ${message}` },
		{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `**Status**\n${ISSUE_STATUSES.get(status)}` },
		...(resolved ? [] : [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "-# Updates will be edited into this message." }]),
	];
	const payloadComponents = [{
		type: MessageComponentTypes.CONTAINER,
		accent_color: ISSUE_COLORS[type],
		components,
	}];
	if (threadEnabled) {
		payloadComponents.push({
			type: MessageComponentTypes.ACTION_ROW,
			components: [{
				type: MessageComponentTypes.BUTTON,
				custom_id: "join_thread",
				label: "Join Updates Thread",
				style: 2,
			}],
		});
	}
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: payloadComponents,
		allowed_mentions: { parse: [] },
	};
}

async function updateIssueFromModal(interaction, database, discord, messageId, userId) {
	const values = parseModalComponents(interaction.data.components);
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("That issue is no longer available."));
	}
	if (issue.status === "resolved") {
		return discord.editOriginalResponse(errorPayload("Resolved issues can't be updated."));
	}
	const selectedType = values.issue_type;
	const titleValue = String(values.issue_title ?? "").trim();
	const selectedStatus = Array.isArray(values.issue_status) ? values.issue_status[0] : values.issue_status;
	const updateMessage = String(values.update_message ?? "").trim();
	const nextTitle = titleValue && titleValue !== issue.title ? titleValue : issue.title;
	const nextStatus = selectedStatus && selectedStatus !== issue.status ? selectedStatus : issue.status;
	const nextType = selectedType && selectedType !== issue.type ? selectedType : issue.type;
	const changed = Boolean(
		nextType !== issue.type
		|| nextTitle !== issue.title
		|| nextStatus !== issue.status
		|| updateMessage,
	);
	if (!changed) {
		return discord.editOriginalResponse(errorPayload("Choose at least one change or add an update message."));
	}
	if (selectedType && !ISSUE_COLORS[selectedType]) {
		return discord.editOriginalResponse(errorPayload("Select a valid issue type."));
	}
	if (selectedStatus && !ISSUE_STATUSES.has(selectedStatus)) {
		return discord.editOriginalResponse(errorPayload("Select a valid issue status."));
	}
	if (
		titleValue.length > 100
		|| updateMessage.length > 750
	) {
		return discord.editOriginalResponse(errorPayload("One or more fields exceed their maximum length."));
	}

	const nextIssue = {
		...issue,
		type: nextType,
		title: nextTitle,
		status: nextStatus,
		message: issue.message,
		updates: issue.updates ?? [],
	};
	const timestamp = Math.floor(Date.now() / 1000);
	if (updateMessage) {
		nextIssue.updates.push({ timestamp, message: updateMessage });
	}
	nextIssue.createdAtTimestamp = issue.createdAtTimestamp;
	nextIssue.thread_id = issue.thread_id;

	const settings = await database.getIssueChannelSettings(interaction.guild_id);
	if (!settings || !settings.webhook_id || !settings.webhook_token || settings.channel_id !== issue.channel_id) {
		return discord.editOriginalResponse(errorPayload("The issue webhook configuration no longer matches this post. Check Issue Channel in `/settings`."));
	}
	const existingPost = await discord.getWebhookMessage(settings.webhook_id, settings.webhook_token, messageId);
	const joinButtonRow = existingPost.components?.find((component) =>
		component.type === MessageComponentTypes.ACTION_ROW
		&& component.components?.some((child) => child.custom_id === "join_thread"),
	);
	const updatedPayload = issueUpdatePayload(nextIssue);
	if (joinButtonRow) {
		updatedPayload.components.push(joinButtonRow);
	}
	await discord.editWebhookMessage(settings.webhook_id, settings.webhook_token, messageId, updatedPayload, { withComponents: true });
	await database.updateIssue(interaction.guild_id, messageId, {
		...nextIssue,
		thread_id: issue.thread_id,
		fullMessage: [
			`**<t:${nextIssue.createdAtTimestamp}:R>** - ${nextIssue.message}`,
			...nextIssue.updates.map(({ timestamp: updateTimestamp, message: updateText }) => `**<t:${updateTimestamp}:R>** - ${updateText}`),
		].join("\n"),
	});

	const changes = [
		selectedType && selectedType !== issue.type ? `Type → ${selectedType}` : null,
		titleValue && titleValue !== issue.title ? `Title → ${titleValue}` : null,
		selectedStatus && selectedStatus !== issue.status ? `Status → ${ISSUE_STATUSES.get(selectedStatus)}` : null,
		updateMessage ? "Progress update appended" : null,
	].filter(Boolean);

	const guildSettings = await database.getGuildSettings(interaction.guild_id);
	if (guildSettings.modlogs_channel_id) {
		try {
			await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
				color: ISSUE_COLORS[nextIssue.type],
				title: "Status Issue Updated",
				description: [
					`**Issue:** ${nextIssue.title}`,
					`**Changes:** ${changes.join(", ")}`,
					`**Updated by:** <@${userId}>`,
				].join("\n"),
				timestamp: new Date().toISOString(),
				footer: { text: `Issue message ID: ${messageId}` },
			});
		}
		catch (error) {
			console.error("Could not write issue update modlog:", error);
		}
	}

	return discord.editOriginalResponse(successPayload(`Updated **${nextIssue.title}** (${changes.join(", ")}).`));
}

async function publishIssue(interaction, database, discord, messageId, userId) {
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("That issue is no longer available."));
	}
	if (issue.status === "resolved") {
		return discord.editOriginalResponse(errorPayload("Resolved issues can't be published."));
	}
	const settings = await database.getIssueChannelSettings(interaction.guild_id);
	if (!settings || settings.channel_id !== issue.channel_id) {
		return discord.editOriginalResponse(errorPayload("The issue webhook configuration no longer matches this post. Check Issue Channel in `/settings`."));
	}
	const destination = (await discord.listGuildChannels(interaction.guild_id))
		.find(({ id }) => id === issue.channel_id);
	if (!destination || destination.type !== 5) {
		return discord.editOriginalResponse(errorPayload("Publishing requires the issue channel to be an announcement channel. Update it in `/settings`."));
	}
	try {
		await discord.publishMessage(issue.channel_id, messageId);
	}
	catch (error) {
		console.error("Could not publish issue announcement:", error);
		return discord.editOriginalResponse(errorPayload("Could not publish that issue. It may already be published."));
	}

	const guildSettings = await database.getGuildSettings(interaction.guild_id);
	if (guildSettings.modlogs_channel_id) {
		try {
			await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
				color: ISSUE_COLORS[issue.type],
				title: "Status Issue Published",
				description: [
					`**Issue:** ${issue.title}`,
					`**Published by:** <@${userId}>`,
				].join("\n"),
				timestamp: new Date().toISOString(),
				footer: { text: `Issue message ID: ${messageId}` },
			});
		}
		catch (error) {
			console.error("Could not write issue publish modlog:", error);
		}
	}

	return discord.editOriginalResponse(successPayload(`Published **${issue.title}** to followers of <#${issue.channel_id}>.`));
}

async function resolveIssueFromModal(interaction, database, discord, messageId, userId) {
	const values = parseModalComponents(interaction.data.components);
	const resolveMessage = String(values.resolve_message ?? "").trim();
	if (!resolveMessage || resolveMessage.length > 750) {
		return discord.editOriginalResponse(errorPayload("Enter a resolution message of up to 750 characters."));
	}
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("That issue is no longer available."));
	}
	if (issue.status === "resolved") {
		return discord.editOriginalResponse(errorPayload("That issue is already resolved."));
	}
	const settings = await database.getIssueChannelSettings(interaction.guild_id);
	if (!settings || !settings.webhook_id || !settings.webhook_token || settings.channel_id !== issue.channel_id) {
		return discord.editOriginalResponse(errorPayload("The issue webhook configuration no longer matches this post. Check Issue Channel in `/settings`."));
	}

	const timestamp = Math.floor(Date.now() / 1000);
	const nextIssue = {
		...issue,
		status: "resolved",
		updates: [...(issue.updates ?? []), { timestamp, message: resolveMessage }],
		createdAtTimestamp: issue.createdAtTimestamp,
		thread_id: issue.thread_id,
	};

	const existingPost = await discord.getWebhookMessage(settings.webhook_id, settings.webhook_token, messageId);
	const joinButtonRow = existingPost.components?.find((component) =>
		component.type === MessageComponentTypes.ACTION_ROW
		&& component.components?.some((child) => child.custom_id === "join_thread"),
	);
	const updatedPayload = issueUpdatePayload(nextIssue);
	if (joinButtonRow) {
		updatedPayload.components.push({
			type: MessageComponentTypes.ACTION_ROW,
			components: joinButtonRow.components.map((child) => ({ ...child, disabled: true })),
		});
	}
	await discord.editWebhookMessage(settings.webhook_id, settings.webhook_token, messageId, updatedPayload, { withComponents: true });
	await database.updateIssue(interaction.guild_id, messageId, {
		...nextIssue,
		thread_id: issue.thread_id,
		fullMessage: [
			`**<t:${nextIssue.createdAtTimestamp}:R>** - ${nextIssue.message}`,
			...nextIssue.updates.map(({ timestamp: updateTimestamp, message: updateText }) => `**<t:${updateTimestamp}:R>** - ${updateText}`),
		].join("\n"),
	});

	if (issue.thread_id) {
		try {
			await discord.sendMessage(issue.thread_id, {
				content: `@everyone **${nextIssue.title}** has been resolved.\n\nSee the original post for details: https://discord.com/channels/${interaction.guild_id}/${issue.channel_id}/${messageId}`,
				allowed_mentions: { parse: ["everyone"] },
			});
		}
		catch (error) {
			console.error("Could not post resolution message to issue thread:", error);
		}
	}

	const guildSettings = await database.getGuildSettings(interaction.guild_id);
	if (guildSettings.modlogs_channel_id) {
		try {
			await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
				color: COLORS.resolved,
				title: "Status Issue Resolved",
				description: [
					`**Issue:** ${nextIssue.title}`,
					`**Resolved by:** <@${userId}>`,
				].join("\n"),
				timestamp: new Date().toISOString(),
				footer: { text: `Issue message ID: ${messageId}` },
			});
		}
		catch (error) {
			console.error("Could not write issue resolve modlog:", error);
		}
	}

	return discord.editOriginalResponse(successPayload(`Resolved **${nextIssue.title}**.`));
}

function managePermissionDenied(interaction) {
	return !interaction.guild_id || !hasManageGuild(interaction.member?.permissions);
}

async function manageIssueFromModal(interaction, database, discord, userId) {
	const values = parseModalComponents(interaction.data.components);
	const messageId = String(values.issue_id ?? "").trim();
	if (!/^\d{17,20}$/.test(messageId)) {
		return discord.editOriginalResponse(errorPayload("Enter a valid issue message ID."));
	}
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("No issue post exists with that message ID."));
	}
	return discord.editOriginalResponse(buildIssueManageActionsPayload(userId, messageId));
}

async function editIssueFromModal(interaction, database, discord, messageId, userId) {
	const values = parseModalComponents(interaction.data.components);
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("That issue no longer exists."));
	}
	const type = values.issue_type;
	const title = String(values.issue_title ?? "").trim();
	const status = Array.isArray(values.issue_status) ? values.issue_status[0] : values.issue_status;
	const fullMessage = String(values.issue_full_message ?? "").trim();
	if (!ISSUE_COLORS[type] || !ISSUE_STATUSES.has(status) || !title || title.length > 100 || !fullMessage) {
		return discord.editOriginalResponse(errorPayload("The edit form contains invalid values. Please reopen it and try again."));
	}

	const settings = await database.getIssueChannelSettings(interaction.guild_id);
	if (!settings || !settings.webhook_id || !settings.webhook_token || settings.channel_id !== issue.channel_id) {
		return discord.editOriginalResponse(errorPayload("The issue webhook configuration no longer matches this post. Check Issue Channel in `/settings`."));
	}

	const lines = fullMessage.split("\n");
	const timestampedLines = [];
	const plainLines = [];
	for (const line of lines) {
		const updateMatch = /^\*\*<t:(\d+):R>\*\* - (.+)/.exec(line);
		if (updateMatch) {
			timestampedLines.push({ timestamp: Number(updateMatch[1]), message: updateMatch[2] });
		}
		else {
			plainLines.push(line);
		}
	}
	const plainMessage = plainLines.join("\n").trim();
	if (!plainMessage && !timestampedLines.length) {
		return discord.editOriginalResponse(errorPayload("The full message cannot be empty."));
	}
	// With no plain text, the first timestamped line is the initial message.
	const [initialLine, ...updateLines] = plainMessage ? [null, ...timestampedLines] : timestampedLines;

	const nextIssue = {
		...issue,
		type,
		title,
		status,
		message: plainMessage || initialLine.message,
		updates: updateLines,
		createdAtTimestamp: plainMessage ? issue.createdAtTimestamp : initialLine.timestamp,
		thread_id: issue.thread_id,
	};

	const existingPost = await discord.getWebhookMessage(settings.webhook_id, settings.webhook_token, messageId);
	const joinButtonRow = existingPost.components?.find((component) =>
		component.type === MessageComponentTypes.ACTION_ROW
		&& component.components?.some((child) => child.custom_id === "join_thread"),
	);
	const updatedPayload = issueUpdatePayload(nextIssue);
	if (joinButtonRow) {
		updatedPayload.components.push(joinButtonRow);
	}
	await discord.editWebhookMessage(settings.webhook_id, settings.webhook_token, messageId, updatedPayload, { withComponents: true });
	await database.updateIssue(interaction.guild_id, messageId, {
		...nextIssue,
		thread_id: issue.thread_id,
		fullMessage: [
			`**<t:${nextIssue.createdAtTimestamp}:R>** - ${nextIssue.message}`,
			...nextIssue.updates.map(({ timestamp: updateTimestamp, message: updateText }) => `**<t:${updateTimestamp}:R>** - ${updateText}`),
		].join("\n"),
	});

	const guildSettings = await database.getGuildSettings(interaction.guild_id);
	if (guildSettings.modlogs_channel_id) {
		try {
			await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
				color: ISSUE_COLORS[type],
				title: "Status Issue Edited",
				description: [
					`**Issue:** ${title}`,
					`**Edited by:** <@${userId}>`,
				].join("\n"),
				timestamp: new Date().toISOString(),
				footer: { text: `Issue message ID: ${messageId}` },
			});
		}
		catch (error) {
			console.error("Could not write issue edit modlog:", error);
		}
	}

	return discord.editOriginalResponse(successPayload(`Edited **${title}**.`));
}

async function deleteIssue(interaction, database, discord, messageId, userId) {
	const issue = await database.getIssueByMessage(interaction.guild_id, messageId);
	if (!issue) {
		return discord.editOriginalResponse(errorPayload("That issue no longer exists."));
	}
	const settings = await database.getIssueChannelSettings(interaction.guild_id);
	if (!settings || !settings.webhook_id || !settings.webhook_token || settings.channel_id !== issue.channel_id) {
		return discord.editOriginalResponse(errorPayload("The issue webhook configuration no longer matches this post. Check Issue Channel in `/settings`."));
	}

	try {
		await discord.deleteWebhookMessage(settings.webhook_id, settings.webhook_token, messageId);
	}
	catch (error) {
		if (error.status !== 404) {
			throw error;
		}
	}
	if (issue.thread_id) {
		try {
			await discord.deleteChannel(issue.thread_id);
		}
		catch (error) {
			if (error.status !== 404) {
				throw error;
			}
		}
	}
	await database.deleteIssue(interaction.guild_id, messageId);

	const guildSettings = await database.getGuildSettings(interaction.guild_id);
	if (guildSettings.modlogs_channel_id) {
		try {
			await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
				color: COLORS.error,
				title: "Status Issue Deleted",
				description: [
					`**Issue:** ${issue.title}`,
					`**Deleted by:** <@${userId}>`,
				].join("\n"),
				timestamp: new Date().toISOString(),
				footer: { text: `Issue message ID: ${messageId}` },
			});
		}
		catch (error) {
			console.error("Could not write issue delete modlog:", error);
		}
	}

	return discord.editOriginalResponse(successPayload(`Deleted **${issue.title}**.`));
}

export async function handleIssueInteraction(interaction, database, discord) {
	const match = /^issue_select_menu:(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const modalMatch = /^issue:new:(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const updateSelectMatch = /^issue_update_select:(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const publishSelectMatch = /^issue_publish_select:(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const resolveSelectMatch = /^issue_resolve_select:(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const updateModalMatch = /^issue:update:(\d{17,20}):(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const resolveModalMatch = /^issue:resolve:(\d{17,20}):(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const manageModalMatch = /^issue:manage:(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const manageActionMatch = /^issue:manage-(view|edit|delete):(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const manageEditModalMatch = /^issue:manage-edit-submit:(\d{17,20}):(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const manageDeleteConfirmMatch = /^issue:manage-delete-confirm:(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const manageCancelMatch = /^issue:manage-cancel:(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	const joinThread = interaction.data?.custom_id === "join_thread";
	const backMatch = /^issue:back:(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
	if (!match && !modalMatch && !updateSelectMatch && !publishSelectMatch && !resolveSelectMatch && !updateModalMatch && !resolveModalMatch && !manageModalMatch && !manageActionMatch && !manageEditModalMatch && !manageDeleteConfirmMatch && !manageCancelMatch && !joinThread && !backMatch) {
		return null;
	}

	const ownerId = match?.[1] ?? modalMatch?.[2] ?? updateSelectMatch?.[1] ?? publishSelectMatch?.[1] ?? resolveSelectMatch?.[1] ?? updateModalMatch?.[2] ?? resolveModalMatch?.[2] ?? manageModalMatch?.[2] ?? manageActionMatch?.[2] ?? manageEditModalMatch?.[2] ?? manageDeleteConfirmMatch?.[2] ?? manageCancelMatch?.[2] ?? backMatch?.[1];
	const userId = getInvokerId(interaction);
	if (joinThread) {
		if (interaction.type !== InteractionType.MESSAGE_COMPONENT || interaction.data.component_type !== MessageComponentTypes.BUTTON) {
			return errorResponse("This Join Updates Thread button is invalid.");
		}
		if (!interaction.guild_id || !interaction.message?.id || !userId) {
			return errorResponse("This issue thread button is not valid in this server.");
		}
		if (interaction.data.disabled) {
			return errorResponse("The issue updates thread is still being prepared. Please try again shortly.");
		}
		return {
			response: {
				type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
				data: { flags: InteractionResponseFlags.EPHEMERAL },
			},
			completion: async () => {
				const guildId = interaction.guild_id;
				let threadId;
				try {
					const issue = await database.getIssueByMessage(guildId, interaction.message.id);
					if (!issue?.thread_id) {
						return discord.editOriginalResponse(errorPayload("This issue updates thread is no longer available."));
					}
					threadId = issue.thread_id;
					await discord.addThreadMember(threadId, userId);
					return discord.editOriginalResponse({
						flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
						components: [{
							type: MessageComponentTypes.CONTAINER,
							accent_color: COLORS.success,
							components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: `You have joined the updates thread for **${issue.title}**: <#${threadId}>` }],
						}],
					});
				}
				catch (error) {
					console.error("Could not join issue updates thread:", { guildId, threadId, error });
					return discord.editOriginalResponse({
						flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
						components: [{
							type: MessageComponentTypes.CONTAINER,
							accent_color: COLORS.error,
							components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Couldn't join the updates thread. Please try again or join the thread manually." }],
						}],
					});
				}
			},
		};
	}
	if (updateSelectMatch || publishSelectMatch || resolveSelectMatch || backMatch) {
		if (interaction.type !== InteractionType.MESSAGE_COMPONENT) {
			return errorResponse("This issue menu selection is invalid.");
		}
		if (backMatch) {
			if (interaction.data.component_type !== MessageComponentTypes.BUTTON) {
				return errorResponse("This issue menu control is invalid.");
			}
			return responseWith(InteractionResponseType.UPDATE_MESSAGE, buildIssueMenuPayload(userId));
		}
		if (
			interaction.data.component_type !== MessageComponentTypes.STRING_SELECT
			|| interaction.data.values?.length !== 1
		) {
			return errorResponse("This issue selection is invalid.");
		}
		const selectedMessageId = interaction.data.values[0];
		const recentIssues = await database.getRecentIssues(interaction.guild_id);
		if (updateSelectMatch) {
			return openModal(
				buildIssueUpdateModal(interaction.guild_id, userId, selectedMessageId),
				buildIssueSelectionPayload(userId, recentIssues, "update"),
				discord,
			);
		}
		if (resolveSelectMatch) {
			return openModal(
				buildIssueResolveModal(interaction.guild_id, userId, selectedMessageId),
				buildIssueSelectionPayload(userId, recentIssues, "resolve"),
				discord,
			);
		}
		return {
			response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
			completion: async () => {
				try {
					return await publishIssue(interaction, database, discord, selectedMessageId, userId);
				}
				catch (error) {
					console.error("Could not publish issue:", error);
					return discord.editOriginalResponse(errorPayload("Could not publish the issue. Please try again."));
				}
			},
		};
	}
	if (updateModalMatch && interaction.type !== InteractionType.MODAL_SUBMIT) {
		return errorResponse("This issue update form is invalid.");
	}
	if (resolveModalMatch && interaction.type !== InteractionType.MODAL_SUBMIT) {
		return errorResponse("This issue resolve form is invalid.");
	}
	if (resolveModalMatch) {
		if (resolveModalMatch[1] !== interaction.guild_id || !userId || resolveModalMatch[2] !== userId) {
			return errorResponse("Only the person who opened this resolve form can submit it in its server.");
		}
		return {
			response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
			completion: async () => {
				try {
					return await resolveIssueFromModal(interaction, database, discord, resolveModalMatch[3], userId);
				}
				catch (error) {
					console.error("Could not resolve issue:", error);
					return discord.editOriginalResponse(errorPayload("Could not resolve the issue. Please try again."));
				}
			},
		};
	}
	if (updateModalMatch) {
		if (updateModalMatch[1] !== interaction.guild_id || !userId || updateModalMatch[2] !== userId) {
			return errorResponse("Only the person who opened this update form can submit it in its server.");
		}
		return {
			response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
			completion: async () => {
				try {
					return await updateIssueFromModal(interaction, database, discord, updateModalMatch[3], userId);
				}
				catch (error) {
					console.error("Could not update issue:", error);
					return discord.editOriginalResponse(errorPayload("Could not update the issue. Please try again."));
				}
			},
		};
	}
	if (manageModalMatch || manageActionMatch || manageEditModalMatch || manageDeleteConfirmMatch || manageCancelMatch) {
		if (managePermissionDenied(interaction)) {
			return errorResponse("You need Manage Server permission to manage issue posts.");
		}
		if (manageModalMatch) {
			if (interaction.type !== InteractionType.MODAL_SUBMIT || manageModalMatch[1] !== interaction.guild_id || !userId || manageModalMatch[2] !== userId) {
				return errorResponse("This manage form is invalid.");
			}
			return {
				response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
				completion: async () => {
					try {
						return await manageIssueFromModal(interaction, database, discord, userId);
					}
					catch (error) {
						console.error("Could not look up issue:", error);
						return discord.editOriginalResponse(errorPayload("Could not look up that issue. Please try again."));
					}
				},
			};
		}
		if (!manageEditModalMatch && interaction.type !== InteractionType.MESSAGE_COMPONENT) {
			return errorResponse("This issue management control is invalid.");
		}
		// manageActionMatch: [1]=action, [2]=userId, [3]=messageId
		// manageDeleteConfirmMatch/manageCancelMatch: [1]=userId, [2]=messageId
		const manageOwnerMatches = manageActionMatch?.[2] === userId
			|| manageDeleteConfirmMatch?.[1] === userId
			|| manageCancelMatch?.[1] === userId;
		if (!manageEditModalMatch && (!userId || !manageOwnerMatches)) {
			return errorResponse("This issue management control is invalid.");
		}
		const manageMessageId = manageActionMatch?.[3] ?? manageDeleteConfirmMatch?.[2] ?? manageEditModalMatch?.[3];
		if (manageActionMatch?.[1] === "view") {
			return {
				response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: InteractionResponseFlags.EPHEMERAL } },
				completion: async () => {
					try {
						const issue = await database.getIssueByMessage(interaction.guild_id, manageMessageId);
						if (!issue) {
							return discord.createFollowupResponse(errorPayload("That issue no longer exists."));
						}
						return discord.createFollowupResponse(buildIssueRawPayload(issue));
					}
					catch (error) {
						console.error("Could not view issue:", error);
						return discord.createFollowupResponse(errorPayload("Could not view that issue. Please try again."));
					}
				},
			};
		}
		if (manageActionMatch?.[1] === "edit") {
			try {
				const issue = await database.getIssueByMessage(interaction.guild_id, manageMessageId);
				if (!issue) {
					return errorResponse("That issue no longer exists.");
				}
				return openModal(
					buildIssueEditModal(interaction.guild_id, userId, issue),
					buildIssueManageActionsPayload(userId, manageMessageId),
					discord,
				);
			}
			catch (error) {
				console.error("Could not open issue edit form:", error);
				return errorResponse("Could not open the edit form. Please try again.");
			}
		}
		if (manageActionMatch?.[1] === "delete") {
			return {
				response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
				completion: async () => {
					try {
						const issue = await database.getIssueByMessage(interaction.guild_id, manageMessageId);
						if (!issue) {
							return discord.editOriginalResponse(errorPayload("That issue no longer exists."));
						}
						return discord.editOriginalResponse(buildIssueDeleteConfirmPayload(userId, issue));
					}
					catch (error) {
						console.error("Could not open issue delete confirmation:", error);
						return discord.editOriginalResponse(errorPayload("Could not open the delete confirmation. Please try again."));
					}
				},
			};
		}
		if (manageEditModalMatch) {
			if (manageEditModalMatch[1] !== interaction.guild_id || manageEditModalMatch[2] !== userId) {
				return errorResponse("Only the person who opened this edit form can submit it in its server.");
			}
			return {
				response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
				completion: async () => {
					try {
						return await editIssueFromModal(interaction, database, discord, manageEditModalMatch[3], userId);
					}
					catch (error) {
						console.error("Could not edit issue:", error);
						return discord.editOriginalResponse(errorPayload("Could not edit the issue. Please try again."));
					}
				},
			};
		}
		if (manageCancelMatch) {
			if (manageCancelMatch[1] !== userId) {
				return errorResponse("This issue management control is invalid.");
			}
			return responseWith(InteractionResponseType.UPDATE_MESSAGE, buildIssueManageActionsPayload(userId, manageCancelMatch[2]));
		}
		if (manageDeleteConfirmMatch[1] !== userId) {
			return errorResponse("Only the person who opened this delete confirmation can confirm it in its server.");
		}
		return {
			response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
			completion: async () => {
				try {
					return await deleteIssue(interaction, database, discord, manageMessageId, userId);
				}
				catch (error) {
					console.error("Could not delete issue:", error);
					return discord.editOriginalResponse(errorPayload("Could not delete the issue. Please try again."));
				}
			},
		};
	}
	if (!interaction.guild_id || !userId || userId !== ownerId) {
		return errorResponse("Only the person who opened this issue menu can use it, and only in its server.");
	}
	if (match && (
		interaction.type !== InteractionType.MESSAGE_COMPONENT
		|| interaction.data.component_type !== MessageComponentTypes.STRING_SELECT
		|| interaction.data.values?.length !== 1
	)) {
		return errorResponse("This issue menu selection is invalid.");
	}

	if (match) {
		const actionKey = interaction.data.values[0];
		const action = ISSUE_ACTIONS.get(actionKey);
		if (!action) {
			return errorResponse("That issue menu selection is invalid.");
		}
		if (actionKey === "new") {
			return openModal(
				buildNewIssueModal(interaction.guild_id, userId),
				buildIssueMenuPayload(userId),
				discord,
			);
		}
		if (actionKey === "update" || actionKey === "publish" || actionKey === "resolve") {
			return {
				response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
				completion: async () => discord.editOriginalResponse(buildIssueSelectionPayload(userId, await database.getRecentIssues(interaction.guild_id), actionKey)),
			};
		}
		if (actionKey === "manage") {
			if (managePermissionDenied(interaction)) {
				return errorResponse("You need Manage Server permission to manage issue posts.");
			}
			return openModal(
				buildIssueManageModal(interaction.guild_id, userId),
				buildIssueMenuPayload(userId),
				discord,
			);
		}
		return responseWith(InteractionResponseType.UPDATE_MESSAGE, buildIssueMenuPayload(userId, `${action} workflow is coming soon.`));
	}

	if (interaction.type !== InteractionType.MODAL_SUBMIT || modalMatch[1] !== interaction.guild_id) {
		return errorResponse("This issue form is invalid.");
	}
	return {
		response: {
			type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
		},
		completion: async () => {
			try {
				const editError = (message) => discord.editOriginalResponse(errorPayload(message));
				const values = parseModalComponents(interaction.data.components);
				const issueChannelSettings = await database.getIssueChannelSettings(interaction.guild_id);
				if (!issueChannelSettings) {
					return editError("Issue publishing is not configured yet. Set an Issue Channel in `/settings`.");
				}
				if (!issueChannelSettings.webhook_id || !issueChannelSettings.webhook_token) {
					return editError("Issue publishing is not configured correctly. Set the Issue Channel again in `/settings`.");
				}
				const type = values.issue_type;
				const title = String(values.issue_title ?? "").trim();
				const status = Array.isArray(values.issue_status) ? values.issue_status[0] : values.issue_status;
				const message = String(values.issue_message ?? "").trim();
				const options = values.issue_options ?? [];
				if (!ISSUE_COLORS[type] || !ISSUE_STATUSES.has(status) || !title || title.length > 100 || !message || message.length > 3800 || !Array.isArray(options) || options.some((option) => !["updates_thread", "publish_immediately"].includes(option))) {
					return editError("The issue form contains invalid values. Please reopen it and try again.");
				}

				const threadEnabled = options.includes("updates_thread");
				const publishImmediately = options.includes("publish_immediately");
				const createdAt = Math.floor(Date.now() / 1000);
				try {
					const destination = (await discord.listGuildChannels(interaction.guild_id))
						.find(({ id }) => id === issueChannelSettings.channel_id);
					if (!destination || ![0, 5].includes(destination.type)) {
						return editError("The configured issue channel is no longer a text or announcement channel. Update it in `/settings`.");
					}
					if (publishImmediately && destination.type !== 5) {
						return editError("Publish Immediately requires the issue channel to be an announcement channel. Update it in `/settings` or uncheck Publish Immediately.");
					}
					const webhookPayload = () => issuePostPayload({
						type,
						title,
						status,
						message,
						threadEnabled,
						createdAt,
					});
					const post = await discord.executeWebhook(issueChannelSettings.webhook_id, issueChannelSettings.webhook_token, webhookPayload(), { withComponents: true });

					await database.saveIssue(interaction.guild_id, {
						messageId: post.id,
						channelId: issueChannelSettings.channel_id,
						type,
						title,
						status,
						message,
						createdAtTimestamp: createdAt,
						threadId: null,
						createdBy: userId,
					});

					let threadId = null;
					let buttonsWarning = false;
					if (threadEnabled) {
						try {
							const thread = await discord.startThreadFromMessage(issueChannelSettings.channel_id, post.id, `${title}`.slice(0, 100));
							threadId = thread.id;
							await discord.updateThread(threadId, { locked: true });
							await database.saveIssue(interaction.guild_id, {
								messageId: post.id,
								channelId: issueChannelSettings.channel_id,
								type,
								title,
								status,
								message,
								createdAtTimestamp: createdAt,
								threadId,
								createdBy: userId,
							});
						}
						catch (error) {
							buttonsWarning = true;
							console.error("Could not create issue updates thread or attach its join button:", error);
						}
					}

					let published = false;
					if (publishImmediately) {
						try {
							await discord.publishMessage(issueChannelSettings.channel_id, post.id);
							published = true;
						}
						catch (error) {
							console.error("Could not publish issue announcement:", error);
						}
					}

					const guildSettings = await database.getGuildSettings(interaction.guild_id);
					if (guildSettings.modlogs_channel_id) {
						const resultLines = [
							`**Issue:** ${title}`,
							`**Type:** ${type[0].toUpperCase()}${type.slice(1)}`,
							`**Status:** ${ISSUE_STATUSES.get(status)}`,
							`**Created by:** <@${userId}>`,
							`**Updates thread:** ${threadId ? `<#${threadId}>` : threadEnabled ? "Failed to create" : "Not requested"}`,
							`**Published:** ${publishImmediately ? published ? "Yes" : "Failed" : "No"}`,
							...(buttonsWarning ? ["**Warning:** The Join Updates Thread button could not be attached."] : []),
						].join("\n");
						try {
							await discord.createModlogMessage(guildSettings.modlogs_channel_id, {
								color: ISSUE_COLORS[type],
								title: "New Status Issue",
								description: resultLines,
								timestamp: new Date().toISOString(),
								footer: { text: `Issue message ID: ${post.id}` },
							});
						}
						catch (error) {
							console.error("Could not write new issue modlog:", error);
						}
					}
					return discord.editOriginalResponse(successPayload(`Posted **${title}** to <#${issueChannelSettings.channel_id}>.`));
				}
				catch (error) {
					console.error("Could not create issue post:", error);
					return editError("Could not post the issue. Check the issue channel webhook configuration and try again.");
				}
			}
			catch (error) {
				console.error("Issue modal submission failed:", error);
				return discord.editOriginalResponse(errorPayload("Could not create the issue. Please try again."));
			}
		},
	};
}