import ping from "./ping.js";
import automod from "./automod.js";
import issue from "./issue.js";
import lockdown from "./lockdown.js";
import mute from "./mute.js";
import permissions from "./permissions.js";
import settings from "./settings.js";
import snowflake from "./snowflake.js";
import status from "./status.js";
import translate from "./translate.js";
import whois from "./whois.js";

export const commands = [ping, automod, issue, lockdown, mute, permissions, settings, snowflake, status, translate, whois];
export const commandsByName = new Map(commands.map((command) => [command.name, command]));
export const commandDefinitions = commands.map((command) => ({
	name: command.name,
	...(command.applicationCommandType === 3 ? {} : { description: command.description }),
	type: command.applicationCommandType ?? 1,
	// Discord Application Command Context: GUILD
	contexts: [0],
	default_member_permissions: "32",
	...(command.options ? { options: command.options } : {}),
}));
