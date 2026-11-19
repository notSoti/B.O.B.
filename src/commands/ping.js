import { discordTimestamp } from "../utils.js";

export default {
	name: "ping",
	description: "Check whether the worker can reach Discord.",
	async execute(interaction, discord, database, env) {
		const latency = await discord.measureApiLatency();
		const deployedAt = env.CF_VERSION_METADATA?.timestamp;
		const deployedLine = deployedAt
			? `\nDeployed: ${discordTimestamp(new Date(deployedAt), "R")}`
			: "";

		return `Pong! ${latency}ms${deployedLine}`;
	},
};
