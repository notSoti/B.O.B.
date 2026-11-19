import {
	ButtonStyleTypes,
	InteractionResponseFlags,
	MessageComponentTypes,
	TextStyleTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { emoji } from "../emojis.js";
import { discordTimestamp } from "../utils.js";

const STATUS_API = "https://dyno.gg/api/status";
const STATUS_PAGE_URL = "https://dyno.gg/status";
const STATUS_USER_AGENT = "BOB-Bot/1.0 (+https://github.com/)";

function formatCount(value) {
	return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatPercent(online, total) {
	if (!total) {
		return "0%";
	}
	if (online >= total) {
		return "100%";
	}

	return `${((online / total) * 100).toFixed(1)}%`;
}

function isMajorOutage(summary) {
	const availability = summary.expectedShardCount
		? summary.connectedShardCount / summary.expectedShardCount
		: summary.onlinePercent / 100;
	return availability < 0.5;
}

function getServiceSummary(service) {
	const clusters = new Map();

	for (const entry of service.statuses ?? []) {
		const result = entry.result;
		const clusterId = String(result?.clusterId ?? entry.id ?? result?.hostname);
		const cluster = clusters.get(clusterId) ?? {
			expectedShards: 0,
			connectedShards: 0,
			explicitlyOnline: false,
		};
		const shardCount = Number(result?.shardCount);
		const connectedCount = Number(result?.connectedCount) || 0;

		if (shardCount > 0) {
			cluster.expectedShards += shardCount;
			cluster.connectedShards += Math.min(Math.max(connectedCount, 0), shardCount);
		}
		else if (result?.status === "ready") {
			cluster.explicitlyOnline = true;
		}

		clusters.set(clusterId, cluster);
	}

	// Some premium status responses contain more cluster IDs than clusterCount reports.
	// Count every distinct cluster in statuses, while retaining the declared count as
	// a lower bound in case an unavailable cluster has no status entry.
	const clusterCount = Math.max(Number(service.clusterCount) || 0, clusters.size);

	let onlineClusters = 0;
	let partialClusters = 0;
	let connectedShardCount = 0;
	let expectedShardCount = 0;
	for (const cluster of clusters.values()) {
		expectedShardCount += cluster.expectedShards;
		connectedShardCount += cluster.connectedShards;
		if (cluster.expectedShards > 0 && cluster.connectedShards >= cluster.expectedShards || cluster.expectedShards === 0 && cluster.explicitlyOnline) {
			onlineClusters++;
		}
		else if (cluster.connectedShards > 0) {
			partialClusters++;
		}
	}

	expectedShardCount = Math.max(Number(service.shardCount) || 0, expectedShardCount);
	connectedShardCount = Math.min(connectedShardCount, expectedShardCount);
	const offlineClusters = Math.max(0, clusterCount - onlineClusters);
	const unavailableClusters = Math.max(0, offlineClusters - partialClusters);
	const offlineShardCount = Math.max(0, expectedShardCount - connectedShardCount);
	const onlinePercent = clusterCount ? (onlineClusters / clusterCount) * 100 : 0;
	const guildCount = (service.statuses ?? []).reduce((total, entry) => total + (Number(entry.result?.guildCount) || 0), 0);

	return {
		onlineClusters,
		clusterCount,
		offlineClusters,
		partialClusters,
		unavailableClusters,
		onlinePercent,
		connectedShardCount,
		expectedShardCount,
		offlineShardCount,
		guildCount,
	};
}

function getClusterDetails(service, clusterReference) {
	const references = typeof clusterReference === "object" && clusterReference !== null
		? [clusterReference.id, clusterReference.clusterId, clusterReference.hostname]
			.filter((value) => value != null)
			.map(String)
		: clusterReference == null ? [] : [String(clusterReference)];
	const clusterId = references[0];
	const statusEntry = service?.statuses?.find((entry) => {
		const result = entry.result;
		return result && [result.clusterId, entry.id, result.hostname]
			.some((value) => value != null && references.includes(String(value)));
	});

	return { clusterId, details: statusEntry?.result };
}

function actionButtons(userId, showLink = true) {
	const buttons = [
		{ type: MessageComponentTypes.BUTTON, custom_id: `status:cluster:${userId}`, label: "Specific Cluster", style: ButtonStyleTypes.PRIMARY },
		{ type: MessageComponentTypes.BUTTON, custom_id: `status:guild:${userId}`, label: "Specific Guild", style: ButtonStyleTypes.PRIMARY },
		{ type: MessageComponentTypes.BUTTON, custom_id: `status:full:${userId}`, label: "Full Status", style: ButtonStyleTypes.SECONDARY },
	];
	if (showLink) {
		buttons.push({ type: MessageComponentTypes.BUTTON, style: ButtonStyleTypes.LINK, label: "Status Page", url: STATUS_PAGE_URL });
	}
	return { type: MessageComponentTypes.ACTION_ROW, components: buttons };
}

function navigationButtons(userId) {
	return {
		type: MessageComponentTypes.ACTION_ROW,
		components: [
			{ type: MessageComponentTypes.BUTTON, custom_id: `status:back:${userId}`, label: "Back", style: ButtonStyleTypes.SECONDARY },
			{ type: MessageComponentTypes.BUTTON, style: ButtonStyleTypes.LINK, label: "Status Page", url: STATUS_PAGE_URL },
		],
	};
}

function containerPayload(components, accentColor = COLORS.main) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [{ type: MessageComponentTypes.CONTAINER, accent_color: accentColor, components }],
	};
}

function statusErrorPayload(error) {
	const status = error.status
		? `HTTP status: ${error.status}`
		: error.name === "AbortError"
			? "HTTP status: unavailable (timed out after 10 seconds)"
			: "HTTP status: unavailable";
	return containerPayload([
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status\nThe status lookup failed. ${status}` },
	], COLORS.error);
}

async function fetchStatus(endpoint, signal) {
	const response = await fetch(endpoint, {
		headers: {
			Accept: "application/json",
			"User-Agent": STATUS_USER_AGENT,
		},
		signal,
	});
	if (!response.ok) {
		const error = new Error(`Dyno status API returned HTTP ${response.status}`);
		error.status = response.status;
		throw error;
	}

	try {
		return await response.json();
	}
	catch (error) {
		error.status = response.status;
		throw error;
	}
}

export function buildSummaryPayload(data, userId) {
	const components = [{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status` }];
	let accentColor = COLORS.main;
	let overallEmoji = emoji("status_resolved");
	let hasPartialOutage = false;
	let hasMajorOutage = false;

	for (const service of [data.prod, data.premium].filter(Boolean)) {
		const summary = getServiceSummary(service);
		const healthy = summary.onlinePercent === 100 && summary.partialClusters === 0;
		const majorOutage = isMajorOutage(summary);
		if (!healthy) {
			hasMajorOutage ||= majorOutage;
			hasPartialOutage ||= !majorOutage;
		}

		components.push(
			{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
			{
				type: MessageComponentTypes.TEXT_DISPLAY,
				content: [
					`### ${healthy ? emoji("status_resolved") : majorOutage ? emoji("status_major") : emoji("status_partial")} ${service.displayName ?? service.name} - ${formatPercent(summary.onlineClusters, summary.clusterCount)} Fully Online`,
					`${formatCount(summary.onlineClusters)}/${formatCount(summary.clusterCount)} Clusters Fully Online (${formatCount(summary.partialClusters)} Partial, ${formatCount(summary.unavailableClusters)} Offline)`,
					`${formatCount(summary.connectedShardCount)}/${formatCount(summary.expectedShardCount)} Shards Connected (${formatCount(summary.offlineShardCount)} Offline)`,
					`${formatCount(summary.guildCount)} guilds`,
				].join("\n"),
			},
		);
	}

	if (hasMajorOutage) {
		accentColor = COLORS.major;
		overallEmoji = emoji("status_major");
	}
	else if (hasPartialOutage) {
		accentColor = COLORS.partial;
		overallEmoji = emoji("status_partial");
	}
	components[0].content = `## ${overallEmoji} Dyno Status`;
	components.push({ type: MessageComponentTypes.SEPARATOR, spacing: 1, divider: false }, actionButtons(userId));
	return containerPayload(components, accentColor);
}

export function buildGuildPayload(data, overallStatus, serverId, userId) {
	const environment = data.env;
	const status = data.status;
	if (!status || typeof status !== "object") {
		return containerPayload([
			{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status\nNo status data was returned for server \`${serverId}\`.` },
			navigationButtons(userId),
		], COLORS.partial);
	}

	const serviceName = environment === "premium" ? "premium" : "prod";
	const { clusterId, details } = getClusterDetails(overallStatus?.[serviceName], status.cluster);
	const ready = status.status === "ready";
	const lines = [
		`## ${emoji("status_dyno")} Dyno Status`,
		`### ${ready ? emoji("status_resolved") : emoji("status_major")} ${ready ? "Online" : "Unavailable"}`,
		`**Server ID:** \`${serverId}\``,
		`**Service:** ${environment === "premium" ? "Premium" : "Dyno"}`,
		`**Cluster:** ${clusterId ?? "Unknown"}`,
	];

	if (details) {
		const shardCount = Number(details.shardCount);
		const connectedCount = Number(details.connectedCount);
		if (shardCount > 0 && Number.isFinite(connectedCount)) {
			lines.push(`**Shards connected:** ${formatCount(connectedCount)}/${formatCount(shardCount)}`);
		}
		if (details.guildCount != null) {
			lines.push(`**Guilds on cluster:** ${formatCount(details.guildCount)}`);
		}
		if (details.uptime) {
			lines.push(`**Cluster uptime:** ${details.uptime}`);
		}
		if (details.started) {
			lines.push(`**Cluster started:** ${discordTimestamp(details.started)}`);
		}
	}

	return containerPayload([
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: lines.join("\n") },
		navigationButtons(userId),
	], ready ? COLORS.success : COLORS.error);
}

export function buildClusterPayload(data, environment, clusterId, userId) {
	const service = data[environment];
	const match = service?.statuses?.find((entry) => String(entry.result?.clusterId ?? entry.id) === String(clusterId));
	if (!match) {
		return containerPayload([
			{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status\nNo ${environment} cluster \`${clusterId}\` was found.` },
			navigationButtons(userId),
		], COLORS.partial);
	}

	const result = match.result ?? {};
	const expectedShards = Number(result.shardCount) || 0;
	const connectedShards = Math.min(Number(result.connectedCount) || 0, expectedShards);
	const fullyOnline = expectedShards > 0 && connectedShards === expectedShards;
	const partiallyOnline = connectedShards > 0 && !fullyOnline;
	const lines = [
		`## ${service.displayName ?? service.name} — Cluster ${result.clusterId ?? match.id}`,
		`### ${fullyOnline ? emoji("status_resolved") : partiallyOnline ? emoji("status_partial") : emoji("status_major")} ${fullyOnline ? "Online" : partiallyOnline ? "Partially Online" : "Offline"}`,
	];
	if (expectedShards > 0) {
		lines.push(`**Shards:** ${formatCount(connectedShards)}/${formatCount(expectedShards)} connected (${formatCount(expectedShards - connectedShards)} offline)`);
	}
	if (match.error) {
		lines.push(`**Status detail:** ${match.error}`);
	}
	if (result.server) {
		lines.push(`**Server:** ${result.server}`);
	}
	if (result.guildCount != null) {
		lines.push(`**Guilds:** ${formatCount(result.guildCount)}`);
	}
	if (result.unavailableCount != null) {
		lines.push(`**Unavailable guilds:** ${formatCount(result.unavailableCount)}`);
	}
	if (result.uptime) {
		lines.push(`**Uptime:** ${result.uptime}`);
	}
	if (result.started) {
		lines.push(`**Started:** ${discordTimestamp(result.started)}`);
	}
	return containerPayload([
		{ type: MessageComponentTypes.TEXT_DISPLAY, content: lines.join("\n") },
		navigationButtons(userId),
	], fullyOnline ? COLORS.success : partiallyOnline ? COLORS.partial : COLORS.major);
}

export function buildFullStatusPayload(data, userId) {
	const components = [{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Full Dyno Status` }];
	let accentColor = COLORS.main;
	const services = [data.prod, data.premium].filter(Boolean);
	const serviceEntries = services.map((service) => ({
		service,
		entries: (service.statuses ?? [])
			.map((entry) => ({ id: String(entry.result?.clusterId ?? entry.id), result: entry.result ?? {}, error: entry.error }))
			.sort((left, right) => Number(left.id) - Number(right.id)),
		groupSize: service.name === "premium" ? 16 : 64,
	}));
	const fixedComponentCount = 3 + services.length * 2;
	const maxGroupCount = 40 - fixedComponentCount;
	let hasPartialOutage = false;
	let hasMajorOutage = false;
	const getTotalGroupCount = () => serviceEntries.reduce((total, item) =>
		total + Math.ceil(item.entries.length / item.groupSize), 0);

	while (getTotalGroupCount() > maxGroupCount) {
		for (const item of serviceEntries) {
			item.groupSize *= 2;
		}
	}

	for (const { service, entries, groupSize } of serviceEntries) {
		const summary = getServiceSummary(service);
		const healthy = summary.onlinePercent === 100 && summary.partialClusters === 0;
		const majorOutage = isMajorOutage(summary);
		if (!healthy) {
			hasMajorOutage ||= majorOutage;
			hasPartialOutage ||= !majorOutage;
		}
		components.push(
			{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
			{
				type: MessageComponentTypes.TEXT_DISPLAY,
				content: `### ${healthy ? emoji("status_resolved") : majorOutage ? emoji("status_major") : emoji("status_partial")} ${service.displayName ?? service.name} — ${formatPercent(summary.onlineClusters, summary.clusterCount)} Fully Online\n${formatCount(summary.onlineClusters)}/${formatCount(summary.clusterCount)} fully online; ${formatCount(summary.partialClusters)} partial; ${formatCount(summary.unavailableClusters)} offline\n${formatCount(summary.connectedShardCount)}/${formatCount(summary.expectedShardCount)} shards connected`,
			},
		);

		for (let index = 0; index < entries.length; index += groupSize) {
			const group = entries.slice(index, index + groupSize);
			const groupOnline = group.filter(({ result }) => {
				const expected = Number(result.shardCount) || 0;
				return expected > 0 && Number(result.connectedCount) >= expected;
			}).length;
			const groupPartial = group.filter(({ result }) => Number(result.connectedCount) > 0 && Number(result.connectedCount) < (Number(result.shardCount) || 0)).length;
			const groupOffline = group.length - groupOnline - groupPartial;
			const shardCount = group.reduce((total, { result }) => total + (Number(result.shardCount) || 0), 0);
			const connectedCount = group.reduce((total, { result }) => total + Math.min(Number(result.connectedCount) || 0, Number(result.shardCount) || 0), 0);
			const guilds = group.reduce((total, { result }) => total + (Number(result.guildCount) || 0), 0);
			const unavailable = group.reduce((total, { result }) => total + (Number(result.unavailableCount) || 0), 0);
			const serverNames = [...new Set(group.map(({ result }) => result.server).filter(Boolean))];
			const start = group[0].id;
			const end = group[group.length - 1].id;
			const range = start === end ? `Cluster ${start}` : `Clusters ${start}-${end}`;
			components.push({
				type: MessageComponentTypes.TEXT_DISPLAY,
				content: `**${range}** — ${groupOnline} online, ${groupPartial} partial, ${groupOffline} offline\n${formatCount(connectedCount)}/${formatCount(shardCount)} shards\n${group.some(({ error }) => error) ? `Offline cluster response: ${group.filter(({ error }) => error).map(({ id }) => id).join(", ")}\n` : ""}${serverNames.length === 1 ? `Server: ${serverNames[0]}\n` : ""}${formatCount(unavailable)} guild(s) unavailable\n${formatCount(guilds)} guilds`,
			});
		}
	}

	if (hasMajorOutage) {
		accentColor = COLORS.major;
	}
	else if (hasPartialOutage) {
		accentColor = COLORS.partial;
	}
	components.push({ type: MessageComponentTypes.SEPARATOR, spacing: 1, divider: false }, navigationButtons(userId));
	return containerPayload(components, accentColor);
}

export function buildStatusModal(action, userId) {
	const isCluster = action === "cluster";
	return {
		custom_id: `status:submit-${action}:${userId}`,
		title: isCluster ? "Find a Dyno Cluster" : "Find a Server",
		components: isCluster ? [
			{
				type: MessageComponentTypes.LABEL,
				label: "Environment",
				component: {
					type: 21,
					custom_id: "environment",
					options: [
						{ label: "Production (Dyno)", value: "prod" },
						{ label: "Premium", value: "premium" },
					],
				},
			},
			{
				type: MessageComponentTypes.LABEL,
				label: "Cluster ID",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "cluster_id",
					style: TextStyleTypes.SHORT,
					placeholder: "e.g. 42",
					max_length: 20,
				},
			},
		] : [{
			type: MessageComponentTypes.LABEL,
			label: "Server ID",
			component: {
				type: MessageComponentTypes.INPUT_TEXT,
				custom_id: "server_id",
				style: TextStyleTypes.SHORT,
				placeholder: "Enter a Discord server ID",
				min_length: 17,
				max_length: 20,
			},
		}],
	};
}

export default {
	name: "status",
	description: "Check Dyno's service status.",
	componentsV2: true,
	executeImmediately: true,
	options: [{
		name: "server_id",
		description: "Check Dyno's status for a specific server.",
		type: 3,
		required: false,
	}],
	execute(interaction) {
		const serverId = interaction.data.options?.find((option) => option.name === "server_id")?.value;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		const endpoint = serverId ? `${STATUS_API}/${encodeURIComponent(serverId)}` : STATUS_API;
		return {
			initialResponse: containerPayload([
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## ${emoji("status_dyno")} Dyno Status\n${emoji("gears")} Fetching the status from ${STATUS_PAGE_URL}…` },
			]),
			completion: (async () => {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 10_000);
				try {
					const data = await fetchStatus(endpoint, controller.signal);
					let overallStatus;
					if (serverId) {
						try {
							overallStatus = await fetchStatus(STATUS_API, controller.signal);
						}
						catch (error) {
							if (controller.signal.aborted) {
								throw error;
							}
							console.error("Could not load overall Dyno status for server details:", error);
						}
					}

					return serverId
						? buildGuildPayload(data, overallStatus, serverId, userId)
						: buildSummaryPayload(data, userId);
				}
				catch (error) {
					let failure = error;
					if (controller.signal.aborted) {
						const timeoutError = new Error("Dyno status lookup timed out after 10 seconds");
						timeoutError.name = "AbortError";
						failure = timeoutError;
					}
					console.error("Dyno status lookup failed:", failure);
					return statusErrorPayload(failure);
				}
				finally {
					clearTimeout(timeout);
				}
			})(),
		};
	},
};
