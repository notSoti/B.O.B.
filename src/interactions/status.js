import {
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
} from "discord-interactions";
import { errorPayload } from "../payloads.js";
import {
	buildClusterPayload,
	buildFullStatusPayload,
	buildGuildPayload,
	buildStatusModal,
	buildSummaryPayload,
} from "../commands/status.js";

const STATUS_API = "https://dyno.gg/api/status";
const STATUS_USER_AGENT = "BOB-Bot/1.0 (+https://github.com/)";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function parseModalValues(components = [], values = {}) {
	for (const component of components) {
		if (component.custom_id && component.value !== undefined) {
			values[component.custom_id] = component.value;
		}
		if (component.component?.custom_id && component.component.value !== undefined) {
			values[component.component.custom_id] = component.component.value;
		}
		if (component.values?.length) {
			values[component.custom_id] = component.values[0];
		}
		if (component.component) {
			parseModalValues([component.component], values);
		}
		parseModalValues(component.components, values);
	}
	return values;
}

async function fetchDyno(endpoint) {
	const response = await fetch(endpoint, {
		headers: {
			Accept: "application/json",
			"User-Agent": STATUS_USER_AGENT,
		},
	});
	if (!response.ok) {
		const body = (await response.text()).slice(0, 500);
		console.error("Dyno status API request failed", {
			status: response.status,
			requestId: response.headers.get("cf-ray"),
			body,
		});
		throw new Error(`Dyno status API returned HTTP ${response.status}`);
	}
	return response.json();
}

function responseWith(type, data) {
	return { response: { type, ...(data ? { data } : {}) } };
}

export function handleStatusInteraction(interaction, discord) {
	const customId = interaction.data?.custom_id ?? "";
	const buttonMatch = /^status:(cluster|guild|full|back):(\d{17,20})$/.exec(customId);
	const modalMatch = /^status:submit-(cluster|guild):(\d{17,20})$/.exec(customId);
	if (!buttonMatch && !modalMatch) {
		return null;
	}

	const [, action, ownerId] = buttonMatch ?? modalMatch;
	const userId = getInvokerId(interaction);
	if (!interaction.guild_id || !userId || ownerId !== userId) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload(
			"Only the person who opened this status menu can use it, and only in its server.",
		));
	}

	if (buttonMatch) {
		if (interaction.data.component_type !== MessageComponentTypes.BUTTON) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This status control is invalid."));
		}
		if (action === "cluster" || action === "guild") {
			return responseWith(InteractionResponseType.MODAL, buildStatusModal(action, userId));
		}

		return {
			response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
			completion: (async () => {
				const data = await fetchDyno(STATUS_API);
				const payload = action === "full"
					? buildFullStatusPayload(data, userId)
					: buildSummaryPayload(data, userId);
				return discord.editOriginalResponse(payload);
			})(),
		};
	}

	if (interaction.type !== InteractionType.MODAL_SUBMIT) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This status form submission is invalid."));
	}

	return {
		response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE },
		completion: (async () => {
			const values = parseModalValues(interaction.data.components);
			if (action === "cluster") {
				const clusterId = String(values.cluster_id ?? "").trim();
				const environment = values.environment;
				if (!/^\d{1,10}$/.test(clusterId) || !["prod", "premium"].includes(environment)) {
					return discord.editOriginalResponse(errorPayload("Enter a valid cluster ID and choose an environment."));
				}
				const data = await fetchDyno(STATUS_API);
				return discord.editOriginalResponse(buildClusterPayload(data, environment, clusterId, userId));
			}

			const serverId = String(values.server_id ?? "").trim();
			if (!/^\d{17,20}$/.test(serverId)) {
				return discord.editOriginalResponse(errorPayload("Enter a valid Discord server ID."));
			}
			const data = await fetchDyno(`${STATUS_API}/${encodeURIComponent(serverId)}`);
			let overallStatus;
			try {
				overallStatus = await fetchDyno(STATUS_API);
			}
			catch (error) {
				console.error("Could not load overall Dyno status for server details:", error);
			}
			return discord.editOriginalResponse(buildGuildPayload(data, overallStatus, serverId, userId));
		})(),
	};
}
