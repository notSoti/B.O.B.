import {
	InteractionResponseFlags,
	MessageComponentTypes,
	TextStyleTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { emoji } from "../emojis.js";

const ISSUE_OPTIONS = [
	{ label: "New Post", value: "new", description: "Post a new status post" },
	{ label: "Update Issue", value: "update", description: "Post a progress update to an existing post" },
	{ label: "Publish Issue", value: "publish", description: "Crosspost a status post to channel followers" },
	{ label: "Resolve Issue", value: "resolve", description: "Resolve a post and post its final update" },
	{ label: "Manage Issue", value: "manage", description: "Review and manage existing posts" },
];

export default {
	name: "issue",
	description: "Manage #dyno-status issues.",
	componentsV2: true,
	options: [],
	execute(interaction) {
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		return buildIssueMenuPayload(userId);
	},
};

export function buildIssueMenuPayload(userId, notice) {
	const components = [
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status Issues` },
		{
			type: MessageComponentTypes.TEXT_DISPLAY,
			content: [
				"Create and manage status posts:",
				"- **New Post** - Create and post a new status post.",
				"- **Update Issue** - Add a progress update to an existing issue's post and updates thread.",
				"- **Publish Issue** - Crosspost an announcement to servers following the channel.",
				"- **Resolve Issue** - Mark an issue resolved and post its final update.",
				"- **Manage Issue** - View, edit, or delete an existing issue post. Server Managers only.",
			].join("\n"),
		},
		{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
		{
			type: MessageComponentTypes.ACTION_ROW,
			components: [{
				type: MessageComponentTypes.STRING_SELECT,
				custom_id: `issue_select_menu:${userId}`,
				placeholder: "Select an issue action...",
				min_values: 1,
				max_values: 1,
				options: ISSUE_OPTIONS,
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
			accent_color: notice ? COLORS.partial : COLORS.main,
			components,
		}],
	};
}

export function buildNewIssueModal(guildId, userId) {
	return {
		custom_id: `issue:new:${guildId}:${userId}`,
		title: "New Dyno Status Post",
		components: [
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Type",
				description: "Choose a service incident severity or announcement; this sets the post's accent color.",
				component: {
					type: 21,
					custom_id: "issue_type",
					options: [
						{ value: "major", label: "Major", description: "Major service outages or incidents" },
						{ value: "minor", label: "Minor", description: "Partial outage or specific degraded behavior" },
						{ value: "announcement", label: "Announcement", description: "Maintenance or developer notice" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Title",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_title",
					style: TextStyleTypes.SHORT,
					placeholder: "A short title for the #dyno-status post",
					min_length: 1,
					max_length: 100,
					required: true,
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Status",
				component: {
					type: MessageComponentTypes.STRING_SELECT,
					custom_id: "issue_status",
					placeholder: "Choose the current status",
					options: [
						{ label: "Investigating", value: "investigating" },
						{ label: "Planned", value: "planned" },
						{ label: "Scheduled", value: "scheduled" },
						{ label: "Identified", value: "identified" },
						{ label: "Monitoring", value: "monitoring" },
					],
					required: true,
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Message",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_message",
					style: TextStyleTypes.PARAGRAPH,
					placeholder: "Describe the impact, affected services, or announcement details",
					min_length: 10,
					max_length: 750,
					required: true,
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Extra Options",
				description: "Create an updates thread by default. Choose immediate publishing to crosspost now.",
				component: {
					type: 22,
					custom_id: "issue_options",
					required: false,
					min_values: 0,
					max_values: 2,
					options: [
						{
							value: "updates_thread",
							label: "Create Updates Thread",
							description: "Create a locked updates thread for this issue",
							default: true,
						},
						{
							value: "publish_immediately",
							label: "Publish Immediately",
							description: "Publish this status issue to all server following the channel",
						},
					],
				},
			},
		],
	};
}

const ISSUE_SELECTION_VIEWS = {
	update: {
		heading: `## ${emoji("gears")} Update Dyno Status Issue`,
		description: "Select a recent issue to change its type, title, status, or message, and optionally append a progress update.",
		placeholder: "Select an issue to update...",
		empty: "There are no recent issues to update.",
	},
	publish: {
		heading: `## ${emoji("status_dyno")} Publish Dyno Status Issue`,
		description: "Select a recent issue to crosspost to every server following the issue channel.",
		placeholder: "Select an issue to publish...",
		empty: "There are no recent issues to publish.",
	},
	resolve: {
		heading: `## ${emoji("status_resolved")} Resolve Dyno Status Issue`,
		description: "Select a recent issue to mark resolved and post its final update.",
		placeholder: "Select an issue to resolve...",
		empty: "There are no recent issues to resolve.",
	},
};

export function buildIssueSelectionPayload(userId, issues, action = "update") {
	const view = ISSUE_SELECTION_VIEWS[action] ?? ISSUE_SELECTION_VIEWS.update;
	const options = issues.filter((issue) => issue.status !== "resolved").map((issue) => ({
		label: issue.title.slice(0, 100),
		value: issue.message_id,
		description: `${issue.type} · ${issue.status}`.slice(0, 100),
	}));
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: view.heading },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: view.description },
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				...(options.length ? [{
					type: MessageComponentTypes.ACTION_ROW,
					components: [{
						type: MessageComponentTypes.STRING_SELECT,
						custom_id: `issue_${action}_select:${userId}`,
						placeholder: view.placeholder,
						min_values: 1,
						max_values: 1,
						options,
					}],
				}] : [{
					type: MessageComponentTypes.TEXT_DISPLAY,
					content: view.empty,
				}]),
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [{
						type: MessageComponentTypes.BUTTON,
						custom_id: `issue:back:${userId}`,
						label: "Back to Issue Menu",
						style: 2,
					}],
				},
			],
		}],
	};
}

export function buildIssueManageModal(guildId, userId) {
	return {
		custom_id: `issue:manage:${guildId}:${userId}`,
		title: "Manage Dyno Status Issue",
		components: [
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Message ID",
				description: "The message ID of the #dyno-status post to manage.",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_id",
					style: TextStyleTypes.SHORT,
					placeholder: "e.g. 1234567890123456789",
					min_length: 17,
					max_length: 20,
					required: true,
				},
			},
		],
	};
}

export function buildIssueRawPayload(issue) {
	const lines = [
		`## ${emoji("info")} Raw Dyno Status Issue`,
		`**Message ID:** ${issue.message_id}`,
		`**Channel:** <#${issue.channel_id}>`,
		`**Type:** ${issue.type}`,
		`**Status:** ${issue.status}`,
		`**Created:** <t:${issue.createdAtTimestamp}:F> (<t:${issue.createdAtTimestamp}:R>)`,
		`**Created by:** <@${issue.created_by}>`,
		`**Updates thread:** ${issue.thread_id ? `<#${issue.thread_id}>` : "None"}`,
		`**Title:** ${issue.title}`,
		`**Message:**\n${issue.message}`,
	];
	if (issue.updates.length) {
		lines.push("**Updates:**");
		for (const { timestamp, message } of issue.updates) {
			lines.push(`- <t:${timestamp}:F> (<t:${timestamp}:R>): ${message}`);
		}
	}
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: lines.join("\n") }],
		}],
		allowed_mentions: { parse: [] },
	};
}

export function buildIssueManageActionsPayload(userId, messageId) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("gears")} Manage Issue ${messageId}` },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Choose an action for this issue post." },
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `issue:manage-view:${userId}:${messageId}`,
							label: "View Raw",
							style: 2,
						},
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `issue:manage-edit:${userId}:${messageId}`,
							label: "Edit Post",
							style: 1,
						},
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `issue:manage-delete:${userId}:${messageId}`,
							label: "Delete Post",
							style: 4,
						},
					],
				},
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [{
						type: MessageComponentTypes.BUTTON,
						custom_id: `issue:back:${userId}`,
						label: "Back to Issue Menu",
						style: 2,
					}],
				},
			],
		}],
	};
}

export function buildIssueEditModal(guildId, userId, issue) {
	const fullMessage = [
		`**<t:${issue.createdAtTimestamp}:R>** - ${issue.message}`,
		...issue.updates.map(({ timestamp, message }) => `**<t:${timestamp}:R>** - ${message}`),
	].join("\n");
	return {
		custom_id: `issue:manage-edit-submit:${guildId}:${userId}:${issue.message_id}`,
		title: "Edit Dyno Status Post",
		components: [
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Type",
				component: {
					type: 21,
					custom_id: "issue_type",
					required: true,
					options: [
						{ value: "major", label: "Major", description: "Major service outages or incidents", default: issue.type === "major" },
						{ value: "minor", label: "Minor", description: "Partial outage or degraded behavior", default: issue.type === "minor" },
						{ value: "announcement", label: "Announcement", description: "Maintenance or developer notice", default: issue.type === "announcement" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Title",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_title",
					style: TextStyleTypes.SHORT,
					min_length: 1,
					max_length: 100,
					required: true,
					value: issue.title,
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Status",
				component: {
					type: MessageComponentTypes.STRING_SELECT,
					custom_id: "issue_status",
					required: true,
					options: [
						{ label: "Investigating", value: "investigating", default: issue.status === "investigating" },
						{ label: "Planned", value: "planned", default: issue.status === "planned" },
						{ label: "Scheduled", value: "scheduled", default: issue.status === "scheduled" },
						{ label: "Identified", value: "identified", default: issue.status === "identified" },
						{ label: "Monitoring", value: "monitoring", default: issue.status === "monitoring" },
						{ label: "Resolved", value: "resolved", default: issue.status === "resolved" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Full Message",
				description: "Edit the raw message.",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_full_message",
					style: TextStyleTypes.PARAGRAPH,
					min_length: 1,
					max_length: 3800,
					required: true,
					value: fullMessage,
				},
			},
		],
	};
}

export function buildIssueDeleteConfirmPayload(userId, issue) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.error,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("warning")} Delete Issue ${issue.message_id}` },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `You are about to permanently delete **${issue.title}**, its updates thread (if any), and its database record. This cannot be undone.` },
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `issue:manage-delete-confirm:${userId}:${issue.message_id}`,
							label: "Confirm Delete",
							style: 4,
						},
						{
							type: MessageComponentTypes.BUTTON,
							custom_id: `issue:manage-cancel:${userId}:${issue.message_id}`,
							label: "Cancel",
							style: 2,
						},
					],
				},
			],
		}],
	};
}

export function buildIssueUpdateModal(guildId, userId, messageId) {
	return {
		custom_id: `issue:update:${guildId}:${userId}:${messageId}`,
		title: "Update Dyno Status Issue",
		components: [
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Type",
				description: "Optional. Leave unselected to keep the current type.",
				component: {
					type: 21,
					custom_id: "issue_type",
					required: false,
					options: [
						{ value: "major", label: "Major", description: "Major service outages or incidents" },
						{ value: "minor", label: "Minor", description: "Partial outage or degraded behavior" },
						{ value: "announcement", label: "Announcement", description: "Maintenance or developer notice" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Title",
				description: "Optional replacement; leave blank to keep the current title.",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "issue_title",
					style: TextStyleTypes.SHORT,
					placeholder: "Enter a replacement title",
					max_length: 100,
					required: false,
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Issue Status",
				description: "Optional. Leave unselected to keep the current status.",
				component: {
					type: MessageComponentTypes.STRING_SELECT,
					custom_id: "issue_status",
					placeholder: "Leave unchanged or select a status",
					required: false,
					options: [
						{ label: "Investigating", value: "investigating" },
						{ label: "Planned", value: "planned" },
						{ label: "Scheduled", value: "scheduled" },
						{ label: "Identified", value: "identified" },
						{ label: "Monitoring", value: "monitoring" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Update Message",
				description: "Optional; appended to the issue with the current timestamp.",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "update_message",
					style: TextStyleTypes.PARAGRAPH,
					placeholder: "Add a progress update",
					max_length: 750,
					required: false,
				},
			},
		],
	};
}

export function buildIssueResolveModal(guildId, userId, messageId) {
	return {
		custom_id: `issue:resolve:${guildId}:${userId}:${messageId}`,
		title: "Resolve Dyno Status Issue",
		components: [
			{
				type: MessageComponentTypes.LABEL,
				label: "Resolution Message",
				description: "Posted as the issue's final update with the current timestamp.",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "resolve_message",
					style: TextStyleTypes.PARAGRAPH,
					placeholder: "Describe the resolution or final status",
					min_length: 1,
					max_length: 750,
					required: true,
				},
			},
		],
	};
}