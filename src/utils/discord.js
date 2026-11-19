const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Creates request-scoped helpers for Discord API operations.
 * @param {object} env Cloudflare Worker bindings, including the Discord application ID and bot token.
 * @param {object} interaction The Discord interaction associated with this request.
 * @returns {object} Helpers for responding to the interaction and more.
 */
export function createDiscord(env, interaction) {
	async function apiRequest(path, { allowNotFound = false, method = "GET", body } = {}) {
		const response = await fetch(`${DISCORD_API_BASE}${path}`, {
			method,
			headers: {
				Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});

		if (allowNotFound && response.status === 404) {
			return null;
		}

		if (!response.ok) {
			const error = new Error(`Discord API request failed with status ${response.status}`);
			error.status = response.status;
			throw error;
		}

		return response.status === 204 ? null : response.json();
	}

	return {
		/**
		 * Edits the original response to the associated interaction.
		 * @param {string|object} responseBody Replacement message content or a Discord message payload.
		 * @returns {Promise<void>} Resolves when Discord accepts the edit.
		 * @throws {Error} If Discord rejects the response edit.
		 */
		async editOriginalResponse(responseBody) {
			const response = await fetch(
				`${DISCORD_API_BASE}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(typeof responseBody === "string" ? { content: responseBody } : responseBody),
				},
			);

			if (!response.ok) {
				const errorDetails = await response.text();
				throw new Error(`Discord response edit failed with status ${response.status}: ${errorDetails}`);
			}
		},
		/**
		 * Creates an interaction follow-up message.
		 * @param {object} responseBody Discord message payload.
		 * @returns {Promise<void>} Resolves when Discord accepts the follow-up.
		 */
		async createFollowupResponse(responseBody) {
			const response = await fetch(
				`${DISCORD_API_BASE}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(responseBody),
				},
			);

			if (!response.ok) {
				const errorDetails = await response.text();
				throw new Error(`Discord follow-up failed with status ${response.status}: ${errorDetails}`);
			}
		},
		/**
		 * Measures round-trip latency for an authenticated Discord API request.
		 * @returns {Promise<number>} Elapsed time in milliseconds.
		 * @throws {Error} If the Discord API request fails.
		 */
		async measureApiLatency() {
			const startedAt = performance.now();
			const response = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
				headers: {
					Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
				},
			});
			const latency = Math.round(performance.now() - startedAt);

			if (!response.ok) {
				throw new Error(`Discord API health check failed with status ${response.status}`);
			}

			return latency;
		},
		/**
		 * Fetches a Discord user by ID.
		 * @param {string} userId The Discord user ID.
		 * @returns {Promise<object>} The Discord user object.
		 */
		getUser(userId) {
			return apiRequest(`/users/${userId}`);
		},
		/**
		 * Lists the emojis owned by the application.
		 * @returns {Promise<object[]>} The application's emoji objects.
		 */
		listApplicationEmojis() {
			return apiRequest(`/applications/${env.DISCORD_APPLICATION_ID}/emojis`).then(({ items }) => items ?? []);
		},
		/**
		 * Opens or returns a direct message channel for a user.
		 * @param {string} userId The user ID.
		 * @returns {Promise<object>} DM channel.
		 */
		createDM(userId) {
			return apiRequest("/users/@me/channels", { method: "POST", body: { recipient_id: userId } });
		},
		/**
		 * Sends a message to a channel.
		 * @param {string} channelId The channel ID.
		 * @param {object} message Discord message payload.
		 * @returns {Promise<object>} Created message.
		 */
		sendMessage(channelId, message) {
			return apiRequest(`/channels/${channelId}/messages`, { method: "POST", body: message });
		},
		/**
		 * Fetches a user's membership in a guild, if they are a member.
		 * @param {string} guildId The Discord guild ID.
		 * @param {string} userId The Discord user ID.
		 * @returns {Promise<object|null>} The guild member object, or null if they are not a member.
		 */
		getGuildMember(guildId, userId) {
			return apiRequest(`/guilds/${guildId}/members/${userId}`, { allowNotFound: true });
		},
		/**
		 * Applies or clears a guild member timeout.
		 * @param {string} guildId The guild ID.
		 * @param {string} userId The member ID.
		 * @param {string|null} communicationDisabledUntil ISO timestamp, or null to clear the timeout.
		 * @returns {Promise<object>} Updated guild member.
		 */
		setMemberTimeout(guildId, userId, communicationDisabledUntil) {
			return apiRequest(`/guilds/${guildId}/members/${userId}`, {
				method: "PATCH",
				body: { communication_disabled_until: communicationDisabledUntil },
			});
		},
		/**
		 * Lists Auto Moderation rules configured in a guild.
		 * @param {string} guildId The Discord guild ID.
		 * @returns {Promise<object[]>} The guild's Auto Moderation rules.
		 */
		listAutoModerationRules(guildId) {
			return apiRequest(`/guilds/${guildId}/auto-moderation/rules`);
		},
		/**
		 * Enables or disables a guild Auto Moderation rule.
		 * @param {string} guildId The Discord guild ID.
		 * @param {string} ruleId The Auto Moderation rule ID.
		 * @param {boolean} enabled Whether the rule should be enabled.
		 * @returns {Promise<object>} The updated Auto Moderation rule.
		 */
		setAutoModerationRuleEnabled(guildId, ruleId, enabled) {
			return apiRequest(`/guilds/${guildId}/auto-moderation/rules/${ruleId}`, {
				method: "PATCH",
				body: { enabled },
			});
		},
		/**
		 * Fetches channels available in a guild for category selection.
		 * @param {string} guildId The guild ID.
		 * @returns {Promise<object[]>} Guild channels.
		 */
		listGuildChannels(guildId) {
			return apiRequest(`/guilds/${guildId}/channels`);
		},
		/**
		 * Creates a webhook in a channel.
		 * @param {string} channelId The channel ID.
		 * @param {string} name Webhook name.
		 * @returns {Promise<object>} Webhook with its token.
		 */
		createWebhook(channelId, name) {
			return apiRequest(`/channels/${channelId}/webhooks`, { method: "POST", body: { name } });
		},
		/**
		 * Executes a stored webhook and waits for the created message.
		 * @param {string} webhookId Webhook ID.
		 * @param {string} webhookToken Webhook token.
		 * @param {object} message Message body.
		 * @param {object} options Execution options.
		 * @returns {Promise<object>} Created message.
		 */
		executeWebhook(webhookId, webhookToken, message, { threadId, withComponents = false } = {}) {
			const query = new URLSearchParams({ wait: "true" });
			if (threadId) {
				query.set("thread_id", threadId);
			}
			if (withComponents) {
				query.set("with_components", "true");
			}
			return fetch(`${DISCORD_API_BASE}/webhooks/${webhookId}/${webhookToken}?${query}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(message),
			}).then(async (response) => {
				if (!response.ok) {
					const error = new Error(`Discord webhook request failed with status ${response.status}: ${await response.text()}`);
					error.status = response.status;
					throw error;
				}
				return response.json();
			});
		},
		/**
		 * Edits an existing message sent by a webhook.
		 * @param {string} webhookId Webhook ID.
		 * @param {string} webhookToken Webhook token.
		 * @param {string} messageId Message ID.
		 * @param {object} message Replacement message payload.
		 * @param {object} options Edit query options.
		 * @returns {Promise<object>} Edited message.
		 */
		editWebhookMessage(webhookId, webhookToken, messageId, message, { withComponents = false } = {}) {
			const query = new URLSearchParams();
			if (withComponents) {
				query.set("with_components", "true");
			}
			const queryString = query.size ? `?${query}` : "";
			return fetch(`${DISCORD_API_BASE}/webhooks/${webhookId}/${webhookToken}/messages/${messageId}${queryString}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(message),
			}).then(async (response) => {
				if (!response.ok) {
					const error = new Error(`Discord webhook edit failed with status ${response.status}: ${await response.text()}`);
					error.status = response.status;
					throw error;
				}
				return response.json();
			});
		},
		/**
		 * Fetches an existing message sent by a webhook.
		 * @param {string} webhookId Webhook ID.
		 * @param {string} webhookToken Webhook token.
		 * @param {string} messageId Message ID.
		 * @returns {Promise<object>} The webhook message.
		 */
		getWebhookMessage(webhookId, webhookToken, messageId) {
			return fetch(`${DISCORD_API_BASE}/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`, {
				headers: { Accept: "application/json" },
			}).then(async (response) => {
				if (!response.ok) {
					const error = new Error(`Discord webhook message request failed with status ${response.status}: ${await response.text()}`);
					error.status = response.status;
					throw error;
				}
				return response.json();
			});
		},
		/**
		 * Deletes a message previously sent by a webhook.
		 * @param {string} webhookId Webhook ID.
		 * @param {string} webhookToken Webhook token.
		 * @param {string} messageId Message ID.
		 * @returns {Promise<null>} Resolves when the message is deleted.
		 */
		deleteWebhookMessage(webhookId, webhookToken, messageId) {
			return fetch(`${DISCORD_API_BASE}/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`, {
				method: "DELETE",
			}).then(async (response) => {
				if (!response.ok) {
					const error = new Error(`Discord webhook message deletion failed with status ${response.status}: ${await response.text()}`);
					error.status = response.status;
					throw error;
				}
				return null;
			});
		},
		/**
		 * Deletes a channel (including threads).
		 * @param {string} channelId Channel or thread ID.
		 * @returns {Promise<object>} The deleted channel object.
		 */
		deleteChannel(channelId) {
			return apiRequest(`/channels/${channelId}`, { method: "DELETE" });
		},
		/**
		 * Creates a public thread from a message.
		 * @param {string} channelId Parent channel ID.
		 * @param {string} messageId Message ID.
		 * @param {string} name Thread name.
		 * @returns {Promise<object>} Created thread.
		 */
		startThreadFromMessage(channelId, messageId, name) {
			return apiRequest(`/channels/${channelId}/messages/${messageId}/threads`, {
				method: "POST",
				body: { name },
			});
		},
		/**
		 * Updates a thread's archived and locked state.
		 * @param {string} threadId Thread ID.
		 * @param {object} state Thread properties to set.
		 * @returns {Promise<object>} Updated thread.
		 */
		updateThread(threadId, state) {
			return apiRequest(`/channels/${threadId}`, { method: "PATCH", body: state });
		},
		/**
		 * Adds a user to a thread.
		 * @param {string} threadId Thread ID.
		 * @param {string} userId User ID.
		 * @returns {Promise<null>} Resolves after the user is added.
		 */
		addThreadMember(threadId, userId) {
			return apiRequest(`/channels/${threadId}/thread-members/${userId}`, { method: "PUT", body: {} });
		},
		/**
		 * Publishes a message in an announcement channel.
		 * @param {string} channelId Announcement channel ID.
		 * @param {string} messageId Message ID.
		 * @returns {Promise<object>} Published message.
		 */
		publishMessage(channelId, messageId) {
			return apiRequest(`/channels/${channelId}/messages/${messageId}/crosspost`, { method: "POST", body: {} });
		},
		/**
		 * Fetches a guild and its owner ID.
		 * @param {string} guildId The guild ID.
		 * @returns {Promise<object>} Guild object.
		 */
		getGuild(guildId) {
			return apiRequest(`/guilds/${guildId}`);
		},
		/**
		 * Lists a guild's roles for hierarchy checks.
		 * @param {string} guildId The guild ID.
		 * @returns {Promise<object[]>} Guild roles.
		 */
		listGuildRoles(guildId) {
			return apiRequest(`/guilds/${guildId}/roles`);
		},
		/**
		 * Applies or edits a channel permission overwrite.
		 * @param {string} channelId The channel ID.
		 * @param {string} overwriteId The role or member ID for the overwrite.
		 * @param {object} overwrite The overwrite type, allow, and deny bitfields.
		 * @returns {Promise<null>} Resolves after the overwrite is saved.
		 */
		setChannelPermissionOverwrite(channelId, overwriteId, overwrite) {
			return apiRequest(`/channels/${channelId}/permissions/${overwriteId}`, {
				method: "PUT",
				body: overwrite,
			});
		},
		/**
		 * Deletes a channel permission overwrite. Discord removes the overwrite entirely.
		 * @param {string} channelId The channel ID.
		 * @param {string} overwriteId The role or member ID for the overwrite.
		 * @returns {Promise<null>} Resolves when the overwrite is deleted.
		 */
		deleteChannelPermissionOverwrite(channelId, overwriteId) {
			return apiRequest(`/channels/${channelId}/permissions/${overwriteId}`, { method: "DELETE" });
		},
		/**
		 * Posts a lockdown announcement embed to a channel.
		 * @param {string} channelId The channel ID.
		 * @param {object} embed Discord embed object.
		 * @returns {Promise<object>} Created message.
		 */
		createChannelEmbedMessage(channelId, embed) {
			return apiRequest(`/channels/${channelId}/messages`, {
				method: "POST",
				body: { embeds: [embed], allowed_mentions: { parse: [] } },
			});
		},
		/**
		 * Posts a modlog embed to a channel.
		 * @param {string} channelId The channel ID.
		 * @param {object} embed Discord embed object.
		 * @returns {Promise<object>} Created message.
		 */
		createModlogMessage(channelId, embed) {
			return apiRequest(`/channels/${channelId}/messages`, {
				method: "POST",
				body: { embeds: [embed], allowed_mentions: { parse: [] } },
			});
		},
		/**
		 * Fetches a channel message.
		 * @param {string} channelId The channel ID.
		 * @param {string} messageId The message ID.
		 * @returns {Promise<object>} Discord message.
		 */
		getChannelMessage(channelId, messageId) {
			return apiRequest(`/channels/${channelId}/messages/${messageId}`);
		},
		/**
		 * Edits an existing channel message embed.
		 * @param {string} channelId The channel ID.
		 * @param {string} messageId The message ID.
		 * @param {object} embed Replacement Discord embed object.
		 * @returns {Promise<object>} The edited message.
		 */
		editChannelEmbedMessage(channelId, messageId, embed) {
			return apiRequest(`/channels/${channelId}/messages/${messageId}`, {
				method: "PATCH",
				body: { embeds: [embed], allowed_mentions: { parse: [] } },
			});
		},
		/**
		 * Deletes a message from a channel.
		 * @param {string} channelId The channel ID.
		 * @param {string} messageId The message ID.
		 * @returns {Promise<null>} Resolves when the message is deleted.
		 */
		deleteChannelMessage(channelId, messageId) {
			return apiRequest(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
		},
	};
}
