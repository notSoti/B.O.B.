export function createDatabase(binding) {
	return {
		async getLockdownCategoryChannels(guildId) {
			const { results } = await binding.prepare(`
				SELECT category, channel_id
				FROM lockdown_category_channels
				WHERE guild_id = ?
				ORDER BY category, channel_id
			`).bind(guildId).all();

			return results;
		},
		async saveLockdownCategoryChannels(guildId, categories) {
			const statements = [
				binding.prepare("DELETE FROM lockdown_category_channels WHERE guild_id = ?").bind(guildId),
				...Object.entries(categories).flatMap(([category, channelIds]) => channelIds.map((channelId) => binding.prepare(`
					INSERT INTO lockdown_category_channels (guild_id, category, channel_id)
					VALUES (?, ?, ?)
				`).bind(guildId, category, channelId))),
			];

			await binding.batch(statements);
		},
		async saveLockdownEmbedMessages(guildId, categories, messages) {
			if (!messages.length) {
				return;
			}
			await binding.batch(messages.flatMap(({ channelId, messageId }) => categories.map((category) => binding.prepare(`
				INSERT INTO lockdown_embed_messages (message_id, guild_id, channel_id, category)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(message_id, category) DO NOTHING
			`).bind(messageId, guildId, channelId, category))));
		},
		async getLockdownEmbedMessages(guildId, categories) {
			if (!categories.length) {
				return [];
			}
			const placeholders = categories.map(() => "?").join(", ");
			const { results } = await binding.prepare(`
				SELECT message_id, channel_id, category
				FROM lockdown_embed_messages
				WHERE guild_id = ? AND category IN (${placeholders})
				ORDER BY created_at
			`).bind(guildId, ...categories).all();
			return results;
		},
		async getLockdownEmbedMessage(guildId, messageId) {
			const { results } = await binding.prepare(`
				SELECT message_id, channel_id, category
				FROM lockdown_embed_messages
				WHERE guild_id = ? AND message_id = ?
			`).bind(guildId, messageId).all();
			return results;
		},
		async getLockdownEmbedMessageCategories(guildId, messageIds) {
			if (!messageIds.length) {
				return [];
			}
			const placeholders = messageIds.map(() => "?").join(", ");
			const { results } = await binding.prepare(`
				SELECT message_id, category
				FROM lockdown_embed_messages
				WHERE guild_id = ? AND message_id IN (${placeholders})
			`).bind(guildId, ...messageIds).all();
			return results;
		},
		async deleteLockdownEmbedMessages(guildId, messages) {
			if (!messages.length) {
				return;
			}
			await binding.batch(messages.map(({ messageId, category }) => binding.prepare(`
				DELETE FROM lockdown_embed_messages
				WHERE guild_id = ? AND message_id = ? AND category = ?
			`).bind(guildId, messageId, category)));
		},
		async getAutomodRuleSelections(guildId) {
			const { results } = await binding.prepare(`
				SELECT rule_id AS id, rule_name AS name
				FROM automod_rule_selections
				WHERE guild_id = ?
				ORDER BY rule_name
			`).bind(guildId).all();
			return results;
		},
		async saveAutomodRuleSelections(guildId, rules) {
			const statements = [
				binding.prepare("DELETE FROM automod_rule_selections WHERE guild_id = ?").bind(guildId),
				...rules.map((rule) => binding.prepare(`
					INSERT INTO automod_rule_selections (guild_id, rule_id, rule_name)
					VALUES (?, ?, ?)
				`).bind(guildId, rule.id, rule.name)),
			];

			await binding.batch(statements);
		},
		async getAutomodRuleSelectionIds(guildId) {
			const { results } = await binding.prepare(`
				SELECT rule_id FROM automod_rule_selections WHERE guild_id = ?
			`).bind(guildId).all();

			return results.map(({ rule_id: ruleId }) => ruleId);
		},
		async getSettingsAutomodRuleSelections(guildId) {
			const { results } = await binding.prepare(`
				SELECT rule_id, rule_name
				FROM automod_rule_selections
				WHERE guild_id = ?
				ORDER BY rule_name
			`).bind(guildId).all();
			return results;
		},
		async getGuildSettings(guildId) {
			const { results } = await binding.prepare(`
				SELECT guild_id, modlogs_channel_id
				FROM guild_settings
				WHERE guild_id = ?
			`).bind(guildId).all();

			return results[0] ?? { guild_id: guildId, modlogs_channel_id: null };
		},
		async saveGuildSettings(guildId, settings) {
			await binding.prepare(`
				INSERT INTO guild_settings (guild_id, modlogs_channel_id)
				VALUES (?, ?)
				ON CONFLICT(guild_id) DO UPDATE SET modlogs_channel_id = excluded.modlogs_channel_id
			`).bind(guildId, settings.modlogsChannelId).run();
		},
		async getIssueChannelSettings(guildId) {
			const { results } = await binding.prepare(`
				SELECT guild_id, channel_id, webhook_id, webhook_token
				FROM issue_channel_settings
				WHERE guild_id = ?
			`).bind(guildId).all();
			return results[0] ?? null;
		},
		async saveIssueChannelSettings(guildId, { channelId, webhookId, webhookToken }) {
			await binding.prepare(`
				INSERT INTO issue_channel_settings (guild_id, channel_id, webhook_id, webhook_token)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(guild_id) DO UPDATE SET
					channel_id = excluded.channel_id,
					webhook_id = excluded.webhook_id,
					webhook_token = excluded.webhook_token
			`).bind(guildId, channelId, webhookId, webhookToken).run();
		},
		async saveIssue(guildId, issue) {
			await binding.prepare(`
				INSERT INTO issues (guild_id, message_id, channel_id, issue_type, title, status, message, created_at_timestamp, thread_id, created_by)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(guild_id, message_id) DO UPDATE SET thread_id = excluded.thread_id
			`).bind(
				guildId,
				issue.messageId,
				issue.channelId,
				issue.type,
				issue.title,
				issue.status,
				issue.message,
				issue.createdAtTimestamp,
				issue.threadId,
				issue.createdBy,
			).run();
		},
		async getIssueByMessage(guildId, messageId) {
			const { results } = await binding.prepare(`
				SELECT message_id, channel_id, issue_type AS type, title, status, message, created_at_timestamp AS createdAtTimestamp, thread_id, created_by, created_at
				FROM issues
				WHERE guild_id = ? AND message_id = ?
			`).bind(guildId, messageId).all();
			const issue = results[0];
			return issue ? splitIssueUpdates(issue) : null;
		},
		async getRecentIssues(guildId, limit = 25) {
			const { results } = await binding.prepare(`
				SELECT message_id, issue_type AS type, title, status, thread_id, created_at, created_at_timestamp AS createdAtTimestamp
				FROM issues
				WHERE guild_id = ? AND status != 'resolved'
				ORDER BY created_at DESC
				LIMIT ?
			`).bind(guildId, limit).all();
			return results;
		},
		async updateIssue(guildId, messageId, issue) {
			await binding.prepare(`
				UPDATE issues
				SET issue_type = ?, title = ?, status = ?, message = ?, thread_id = ?
				WHERE guild_id = ? AND message_id = ?
			`).bind(issue.type, issue.title, issue.status, issue.fullMessage, issue.thread_id, guildId, messageId).run();
		},
		async deleteIssue(guildId, messageId) {
			await binding.prepare(`
				DELETE FROM issues
				WHERE guild_id = ? AND message_id = ?
			`).bind(guildId, messageId).run();
		},
	};
}

function splitIssueUpdates(issue) {
	// The stored blob is always: the initial message as a timestamped line,
	// followed by one timestamped line per update.
	const lines = issue.message.split("\n");
	const parsed = lines.map((line) => {
		const match = /^\*\*<t:(\d+):R>\*\* - (.+)/.exec(line);
		return match ? { timestamp: Number(match[1]), message: match[2] } : { timestamp: null, message: line };
	});
	const [initial, ...updates] = parsed;
	return {
		...issue,
		message: initial.message,
		createdAtTimestamp: initial.timestamp ?? issue.createdAtTimestamp,
		fullMessage: issue.message,
		updates: updates.filter(({ timestamp }) => timestamp !== null),
	};
}