import {
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { errorPayload } from "../payloads.js";
import { hasManageGuild, hasManageRoles } from "../utils.js";
import {
	buildEmbedActionModal,
	buildEmbedMenuPayload,
	buildLockdownActionModal,
	buildLockdownMenuPayload,
	buildLockdownSuccessPayload,
} from "../commands/lockdown.js";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
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

function getModalSelections(components = [], selections = {}) {
	for (const component of components) {
		const child = component.component;
		if (child?.custom_id) {
			if (Array.isArray(child.values)) {
				selections[child.custom_id] = child.values;
			}
			else if (child.value !== undefined) {
				selections[child.custom_id] = child.value;
			}
		}
		getModalSelections(component.components, selections);
	}
	return selections;
}

function buildLockdownEmbed(description, color = COLORS.main) {
	return {
		title: "Channel Locked",
		color,
		description,
	};
}

async function postLockdownModlog(interaction, database, discord, action, categories) {
	const settings = await database.getGuildSettings(interaction.guild_id);
	if (!settings.modlogs_channel_id) {
		return;
	}

	const isStart = action === "started";
	const fields = [
		{ name: "Categories", value: categories.join(", ") },
		{ name: "Moderator", value: `<@${getInvokerId(interaction)}>` },
	];

	try {
		await discord.createModlogMessage(settings.modlogs_channel_id, {
			color: isStart ? COLORS.error : COLORS.success,
			title: isStart ? "Lockdown Started" : "Lockdown Ended",
			fields,
			timestamp: new Date().toISOString(),
			footer: { text: `Moderator ID: ${getInvokerId(interaction)}` },
		});
	}
	catch (error) {
		console.error(`Failed to post ${action} lockdown modlog:`, error);
	}
}

async function startCategoryLockdown(interaction, database, discord, categories, reason) {
	const configuredChannels = await database.getLockdownCategoryChannels(interaction.guild_id);
	const selectedChannels = configuredChannels.filter(({ category }) => categories.includes(category));
	const channelCategories = new Map();
	for (const { category, channel_id: channelId } of selectedChannels) {
		if (!channelCategories.has(channelId)) {
			channelCategories.set(channelId, new Set());
		}
		channelCategories.get(channelId).add(category);
	}

	const guildChannels = await discord.listGuildChannels(interaction.guild_id);
	const channelMap = new Map(guildChannels.map((channel) => [channel.id, channel]));
	const overwriteTargetId = interaction.guild_id;
	const results = new Map(categories.map((category) => [category, { locked: 0, failed: 0 }]));
	const failures = [];
	const existingMessages = reason
		? await database.getLockdownEmbedMessages(interaction.guild_id, categories)
		: [];
	const existingMessagesByChannel = new Map();
	for (const message of existingMessages) {
		if (!existingMessagesByChannel.has(message.channel_id)) {
			existingMessagesByChannel.set(message.channel_id, []);
		}
		existingMessagesByChannel.get(message.channel_id).push(message);
	}

	for (const [channelId, categoriesForChannel] of channelCategories) {
		const channel = channelMap.get(channelId);
		if (!channel) {
			for (const category of categoriesForChannel) {
				results.get(category).failed++;
			}
			failures.push({ channelId, error: new Error("Configured channel was not found in this server.") });
			continue;
		}

		try {
			const denyPermission = channel.type === 15 ? 1n << 38n : 1n << 11n;
			const existingOverwrite = channel.permission_overwrites?.find((overwrite) => overwrite.id === overwriteTargetId);
			const existingDeny = BigInt(existingOverwrite?.deny ?? "0");
			await discord.setChannelPermissionOverwrite(channelId, overwriteTargetId, {
				type: 0,
				allow: (BigInt(existingOverwrite?.allow ?? "0") & ~denyPermission).toString(),
				deny: (existingDeny | denyPermission).toString(),
			});

			for (const category of categoriesForChannel) {
				results.get(category).locked++;
			}
			if (reason && channel.type !== 15) {
				try {
					const previousMessages = existingMessagesByChannel.get(channelId) ?? [];
					if (previousMessages.length) {
						const [messageToUpdate, ...duplicates] = previousMessages;
						const existingMessage = await discord.getChannelMessage(channelId, messageToUpdate.message_id);
						const existingEmbed = existingMessage.embeds?.[0] ?? {};
						await discord.editChannelEmbedMessage(
							channelId,
							messageToUpdate.message_id,
							buildLockdownEmbed(reason, existingEmbed.color),
						);

						for (const duplicate of duplicates) {
							try {
								await discord.deleteChannelMessage(channelId, duplicate.message_id);
								const duplicateCategories = await database.getLockdownEmbedMessageCategories(interaction.guild_id, [duplicate.message_id]);
								await database.deleteLockdownEmbedMessages(interaction.guild_id, duplicateCategories);
							}
							catch (error) {
								console.error(`Failed to remove duplicate lockdown message ${duplicate.message_id}:`, error);
							}
						}
					}
					else {
						const message = await discord.createChannelEmbedMessage(channelId, buildLockdownEmbed(reason));
						await database.saveLockdownEmbedMessages(interaction.guild_id, [...categoriesForChannel], [{
							channelId,
							messageId: message.id,
						}]);
					}
				}
				catch (error) {
					console.error(`Failed to post or track lockdown message in channel ${channelId}:`, error);
				}
			}
		}
		catch (error) {
			for (const category of categoriesForChannel) {
				results.get(category).failed++;
			}
			failures.push({ channelId, error });
		}
	}

	if (failures.length) {
		console.error("Some lockdown channels could not be locked", {
			guildId: interaction.guild_id,
			failedChannels: failures.map(({ channelId, error }) => ({ channelId, error: error.message })),
		});
	}
	await postLockdownModlog(interaction, database, discord, "started", categories);

	return results;
}

async function endCategoryLockdown(interaction, database, discord, categories) {
	const configuredChannels = await database.getLockdownCategoryChannels(interaction.guild_id);
	const selectedChannels = configuredChannels.filter(({ category }) => categories.includes(category));
	const channelCategories = new Map();
	for (const { category, channel_id: channelId } of selectedChannels) {
		if (!channelCategories.has(channelId)) {
			channelCategories.set(channelId, new Set());
		}
		channelCategories.get(channelId).add(category);
	}

	const guildChannels = await discord.listGuildChannels(interaction.guild_id);
	const channelMap = new Map(guildChannels.map((channel) => [channel.id, channel]));
	const results = new Map(categories.map((category) => [category, { unlocked: 0, failed: 0 }]));
	const failures = [];

	for (const [channelId, categoriesForChannel] of channelCategories) {
		const channel = channelMap.get(channelId);
		if (!channel) {
			for (const category of categoriesForChannel) {
				results.get(category).failed++;
			}
			failures.push({ channelId, error: new Error("Configured channel was not found in this server.") });
			continue;
		}

		try {
			const permission = channel.type === 15 ? 1n << 38n : 1n << 11n;
			const existingOverwrite = channel.permission_overwrites?.find((overwrite) => overwrite.id === interaction.guild_id);
			if (existingOverwrite) {
				const allow = BigInt(existingOverwrite.allow ?? "0");
				const deny = BigInt(existingOverwrite.deny ?? "0");
				const nextAllow = allow & ~permission;
				const nextDeny = deny & ~permission;
				if (nextAllow === 0n && nextDeny === 0n) {
					await discord.deleteChannelPermissionOverwrite(channelId, interaction.guild_id);
				}
				else if (nextAllow !== allow || nextDeny !== deny) {
					await discord.setChannelPermissionOverwrite(channelId, interaction.guild_id, {
						type: 0,
						allow: nextAllow.toString(),
						deny: nextDeny.toString(),
					});
				}
			}
			for (const category of categoriesForChannel) {
				results.get(category).unlocked++;
			}
		}
		catch (error) {
			for (const category of categoriesForChannel) {
				results.get(category).failed++;
			}
			failures.push({ channelId, error });
		}
	}

	const trackedMessages = await database.getLockdownEmbedMessages(interaction.guild_id, categories);
	const messageIds = [...new Set(trackedMessages.map(({ message_id: messageId }) => messageId))];
	const messageCategories = await database.getLockdownEmbedMessageCategories(interaction.guild_id, messageIds);
	const categoriesByMessage = new Map();
	const channelByMessage = new Map();
	for (const { message_id: messageId, category } of messageCategories) {
		if (!categoriesByMessage.has(messageId)) {
			categoriesByMessage.set(messageId, new Set());
		}
		categoriesByMessage.get(messageId).add(category);
	}
	for (const { message_id: messageId, channel_id: channelId } of trackedMessages) {
		channelByMessage.set(messageId, channelId);
	}
	const removedReferences = [];
	for (const messageId of messageIds) {
		const messageCategoriesForId = categoriesByMessage.get(messageId) ?? new Set();
		const categoriesToRemove = [...messageCategoriesForId].filter((category) => categories.includes(category));
		const categoriesToKeep = [...messageCategoriesForId].filter((category) => !categories.includes(category));
		if (categoriesToKeep.length) {
			removedReferences.push(...categoriesToRemove.map((category) => ({ messageId, category })));
			continue;
		}
		const channelId = channelByMessage.get(messageId);
		try {
			await discord.deleteChannelMessage(channelId, messageId);
			for (const messageCategory of messageCategoriesForId) {
				removedReferences.push({ messageId, category: messageCategory });
			}
		}
		catch (error) {
			if (error.status === 404) {
				for (const messageCategory of messageCategoriesForId) {
					removedReferences.push({ messageId, category: messageCategory });
				}
			}
			else {
				console.error(`Failed to delete tracked lockdown embed ${messageId} from channel ${channelId}:`, error);
				failures.push({ channelId, error });
			}
		}
	}
	await database.deleteLockdownEmbedMessages(interaction.guild_id, removedReferences);

	if (failures.length) {
		console.error("Some lockdown channels or messages could not be unlocked/deleted", {
			guildId: interaction.guild_id,
			failed: failures.map(({ channelId, error }) => ({ channelId, error: error.message })),
		});
	}
	await postLockdownModlog(interaction, database, discord, "ended", categories);

	return results;
}

export async function handleLockdownInteraction(interaction, database, discord) {
	const customId = interaction.data?.custom_id ?? "";
	const selectMatch = /^lock_select_menu:(\d{17,20})$/.exec(customId);
	const embedSelectMatch = /^lock_embed_menu:(\d{17,20})$/.exec(customId);
	const modalMatch = /^lockdown:(action:(?:start|end)|embed:(?:add|edit|delete)):(\d{17,20}):(\d{17,20})$/.exec(customId);
	if (!selectMatch && !embedSelectMatch && !modalMatch) {
		return null;
	}

	const userId = getInvokerId(interaction);
	const ownerId = selectMatch?.[1] ?? embedSelectMatch?.[1] ?? modalMatch?.[3];
	if (!interaction.guild_id || !userId || ownerId !== userId) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload(
			"Only the person who opened this lockdown menu can use it.",
		));
	}
	if (!hasManageGuild(interaction.member?.permissions)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload(
			"You need Manage Server permission to modify lockdown categories.",
		));
	}
	if (!hasManageRoles(interaction.app_permissions)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload(
			"I need Manage Roles permission to manage lockdowns.",
		));
	}

	if (selectMatch) {
		if (
			interaction.type !== InteractionType.MESSAGE_COMPONENT
			|| interaction.data.component_type !== MessageComponentTypes.STRING_SELECT
			|| interaction.data.values?.length !== 1
		) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This lockdown menu selection is invalid."));
		}
		const action = interaction.data.values[0];
		if (["lock_start", "lock_end"].includes(action)) {
			return openModal(
				buildLockdownActionModal(action === "lock_start" ? "start" : "end", interaction.guild_id, userId),
				buildLockdownMenuPayload(userId),
				discord,
			);
		}
		if (action === "lock_embeds") {
			return responseWith(InteractionResponseType.UPDATE_MESSAGE, buildEmbedMenuPayload(userId));
		}
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("That lockdown menu selection is invalid."));
	}
	if (embedSelectMatch) {
		if (
			interaction.type !== InteractionType.MESSAGE_COMPONENT
			|| interaction.data.component_type !== MessageComponentTypes.STRING_SELECT
			|| interaction.data.values?.length !== 1
		) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This embed menu selection is invalid."));
		}

		const [action] = interaction.data.values;
		if (action === "back") {
			return responseWith(InteractionResponseType.UPDATE_MESSAGE, buildLockdownMenuPayload(userId));
		}
		if (!["add", "edit", "delete"].includes(action)) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("That embed action is invalid."));
		}

		return openModal(
			buildEmbedActionModal(action, interaction.guild_id, userId),
			buildEmbedMenuPayload(userId),
			discord,
		);
	}

	if (!modalMatch || interaction.type !== InteractionType.MODAL_SUBMIT || modalMatch[2] !== interaction.guild_id) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This lockdown form is invalid."));
	}

	return {
		response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
		completion: (async () => {
			const selections = getModalSelections(interaction.data.components);
			const modalAction = modalMatch[1];
			if (modalAction.startsWith("action:")) {
				const categories = selections.categories;
				if (!Array.isArray(categories) || categories.length === 0 || categories.some((category) => !["General", "Support"].includes(category))) {
					return discord.editOriginalResponse(errorPayload("Select at least one valid category."));
				}
				const action = modalAction.slice("action:".length);
				if (action === "start") {
					const reason = typeof selections.reason === "string" ? selections.reason.trim() : "";
					const results = await startCategoryLockdown(interaction, database, discord, categories, reason);
					const summary = [...results.entries()].map(([category, result]) =>
						`${category}: ${result.locked} channel(s) locked, ${result.failed} failed`,
					).join("\n");
					return discord.editOriginalResponse(buildLockdownSuccessPayload(summary));
				}
				const results = await endCategoryLockdown(interaction, database, discord, categories);
				const summary = [...results.entries()].map(([category, result]) =>
					`${category}: ${result.unlocked} channel(s) unlocked, ${result.failed} failed`,
				).join("\n");
				return discord.editOriginalResponse(buildLockdownSuccessPayload(summary));
			}
			if (modalAction.startsWith("embed:")) {
				const action = modalAction.slice("embed:".length);
				const categories = selections.categories;
				if (!Array.isArray(categories) || categories.length === 0 || categories.some((category) => !["General", "Support"].includes(category))) {
					return discord.editOriginalResponse(errorPayload("Select at least one valid category."));
				}
				if (action !== "delete" && (typeof selections.description !== "string" || !selections.description.trim())) {
					return discord.editOriginalResponse(errorPayload("Provide the embed description."));
				}
				if (action === "add") {
					const guildChannels = await discord.listGuildChannels(interaction.guild_id);
					const channelsById = new Map(guildChannels.map((channel) => [channel.id, channel]));
					const configuredChannels = await database.getLockdownCategoryChannels(interaction.guild_id);
					const trackedMessages = await database.getLockdownEmbedMessages(interaction.guild_id, categories);
					const channelsByCategory = new Map(categories.map((category) => [
						category,
						new Set(configuredChannels.filter((item) => item.category === category).map((item) => item.channel_id)),
					]));
					const targetChannels = new Map();
					for (const category of categories) {
						for (const channelId of channelsByCategory.get(category)) {
							const channel = channelsById.get(channelId);
							if (channel && channel.type !== 15) {
								if (!targetChannels.has(channelId)) {
									targetChannels.set(channelId, new Set());
								}
								targetChannels.get(channelId).add(category);
							}
						}
					}

					let addedCount = 0;
					let failedCount = 0;
					for (const [channelId, messageCategories] of targetChannels) {
						try {
							const existingMessages = new Map(
								trackedMessages
									.filter((message) => message.channel_id === channelId)
									.map((message) => [message.message_id, message]),
							);
							let messageId;
							if (existingMessages.size) {
								const [existingMessageId, ...duplicates] = existingMessages.keys();
								const existingMessage = await discord.getChannelMessage(channelId, existingMessageId);
								const existingEmbed = existingMessage.embeds?.[0] ?? {};
								await discord.editChannelEmbedMessage(
									channelId,
									existingMessageId,
									buildLockdownEmbed(selections.description.trim(), existingEmbed.color),
								);
								messageId = existingMessageId;
								for (const duplicateMessageId of duplicates) {
									try {
										await discord.deleteChannelMessage(channelId, duplicateMessageId);
										const duplicateCategories = await database.getLockdownEmbedMessageCategories(interaction.guild_id, [duplicateMessageId]);
										await database.deleteLockdownEmbedMessages(interaction.guild_id, duplicateCategories);
									}
									catch (error) {
										console.error(`Failed to remove duplicate lockdown embed ${duplicateMessageId}:`, error);
									}
								}
							}
							else {
								const message = await discord.createChannelEmbedMessage(
									channelId,
									buildLockdownEmbed(selections.description.trim()),
								);
								messageId = message.id;
							}
							await database.saveLockdownEmbedMessages(interaction.guild_id, [...messageCategories], [{ channelId, messageId }]);
							addedCount++;
						}
						catch (error) {
							failedCount++;
							console.error(`Failed to add lockdown embed in channel ${channelId}:`, error);
						}
					}

					return discord.editOriginalResponse(buildLockdownSuccessPayload(
						`Added ${addedCount} lockdown embed(s); ${failedCount} failed.`,
					));
				}

				const applicableMessages = await database.getLockdownEmbedMessages(interaction.guild_id, categories);
				const relevantChannels = new Set(
					(await database.getLockdownCategoryChannels(interaction.guild_id))
						.filter(({ category }) => categories.includes(category))
						.map(({ channel_id: channelId }) => channelId),
				);
				const categoryMessages = applicableMessages.filter((message) => relevantChannels.has(message.channel_id));
				if (!categoryMessages.length) {
					return discord.editOriginalResponse(buildLockdownSuccessPayload("No tracked lockdown embeds were found in the selected categories."));
				}
				const uniqueMessages = new Map(categoryMessages.map((message) => [message.message_id, message]));

				let succeededCount = 0;
				let failedCount = 0;
				for (const message of uniqueMessages.values()) {
					try {
						if (action === "delete") {
							await discord.deleteChannelMessage(message.channel_id, message.message_id);
							const messageCategories = await database.getLockdownEmbedMessageCategories(interaction.guild_id, [message.message_id]);
							await database.deleteLockdownEmbedMessages(interaction.guild_id, messageCategories);
						}
						else {
							const existingMessage = await discord.getChannelMessage(message.channel_id, message.message_id);
							const existingEmbed = existingMessage.embeds?.[0] ?? {};
							await discord.editChannelEmbedMessage(
								message.channel_id,
								message.message_id,
								buildLockdownEmbed(selections.description.trim(), existingEmbed.color),
							);
						}
						succeededCount++;
					}
					catch (error) {
						failedCount++;
						console.error(`Failed to ${action} lockdown embed ${message.message_id}:`, error);
					}
				}

				return discord.editOriginalResponse(buildLockdownSuccessPayload(
					`${action === "edit" ? "Edited" : "Deleted"} ${succeededCount} lockdown embed(s); ${failedCount} failed.`,
				));
			}

			return null;
		})(),
	};
}
