CREATE TABLE lockdown_category_channels (
	guild_id TEXT NOT NULL,
	category TEXT NOT NULL CHECK (category IN ('General', 'Support')),
	channel_id TEXT NOT NULL,
	PRIMARY KEY (guild_id, category, channel_id),
	UNIQUE (guild_id, channel_id)
);

CREATE TABLE guild_settings (
	guild_id TEXT PRIMARY KEY,
	modlogs_channel_id TEXT
);

CREATE TABLE automod_rule_selections (
	guild_id TEXT NOT NULL,
	rule_id TEXT NOT NULL,
	rule_name TEXT NOT NULL,
	PRIMARY KEY (guild_id, rule_id)
);

CREATE TABLE lockdown_embed_messages (
	message_id TEXT NOT NULL,
	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	category TEXT NOT NULL CHECK (category IN ('General', 'Support')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (message_id, category)
);

CREATE INDEX lockdown_embed_messages_guild_category
	ON lockdown_embed_messages (guild_id, category);

CREATE TABLE issue_channel_settings (
	guild_id TEXT PRIMARY KEY,
	channel_id TEXT NOT NULL,
	webhook_id TEXT NOT NULL,
	webhook_token TEXT NOT NULL
);

CREATE TABLE issues (
	guild_id TEXT NOT NULL,
	message_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	issue_type TEXT NOT NULL CHECK (issue_type IN ('major', 'minor', 'announcement')),
	title TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('investigating', 'planned', 'scheduled', 'identified', 'monitoring', 'resolved')),
	message TEXT NOT NULL,
	thread_id TEXT,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	created_at_timestamp INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, message_id)
);

CREATE INDEX issues_guild_created_at ON issues (guild_id, created_at DESC);
