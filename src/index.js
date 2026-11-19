import {
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
	verifyKey,
} from "discord-interactions";
import { commandsByName } from "./commands/index.js";
import { COLORS } from "./constants.js";
import { ensureApplicationEmojis } from "./emojis.js";
import { createDatabase } from "./database.js";
import { handleAutomodInteraction } from "./interactions/automod.js";
import { handleIssueInteraction } from "./interactions/issue.js";
import { handleLockdownInteraction } from "./interactions/lockdown.js";
import { handleSettingsInteraction } from "./interactions/settings.js";
import { handleStatusInteraction } from "./interactions/status.js";
import { handleTranslateInteraction } from "./interactions/translate.js";
import { createDiscord } from "./utils/discord.js";

function interactionResponse(type, data) {
	return new Response(JSON.stringify({ type, ...(data ? { data } : {}) }), {
		headers: {
			"Content-Type": "application/json",
		},
	});
}

export default {
	async fetch(request, env, executionCtx) {
		if (request.method !== "POST") {
			return new Response("Not found", { status: 404 });
		}

		const body = await request.arrayBuffer();

		const signature = request.headers.get("X-Signature-Ed25519");
		const timestamp = request.headers.get("X-Signature-Timestamp");
		const publicKey = env.DISCORD_PUBLIC_KEY;
		const signatureValid = await verifyKey(body, signature, timestamp, publicKey);

		if (!signatureValid) {
			console.error("Invalid request signature");
			return new Response("Invalid request signature", { status: 401 });
		}

		let interaction;

		try {
			interaction = JSON.parse(new TextDecoder().decode(body));
		}
		catch {
			return new Response("Invalid interaction payload", { status: 400 });
		}

		if (interaction.type === InteractionType.PING) {
			return interactionResponse(InteractionResponseType.PONG);
		}

		const database = createDatabase(env.DB);
		executionCtx?.waitUntil(ensureApplicationEmojis(env));

		if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
			const discord = createDiscord(env, interaction);
			const settingsHandled = await handleSettingsInteraction(interaction, database, discord);
			const handled = settingsHandled ?? await handleLockdownInteraction(interaction, database, discord)
				?? handleStatusInteraction(interaction, discord)
				?? handleTranslateInteraction(interaction, env, discord)
				?? await handleIssueInteraction(interaction, database, discord)
				?? handleAutomodInteraction(interaction, database, discord);

			if (!handled) {
				return interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, {
					content: "This component is not supported.",
					flags: InteractionResponseFlags.EPHEMERAL,
				});
			}

			if (handled.completion) {
				const completion = Promise.resolve()
					.then(() => typeof handled.completion === "function" ? handled.completion() : handled.completion)
					.catch((error) => {
						console.error("Component interaction failed:", error);
						return discord.createFollowupResponse({
							flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
							components: [{
								type: MessageComponentTypes.CONTAINER,
								accent_color: COLORS.error,
								components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "This action failed. Please try again." }],
							}],
						});
					});
				if (executionCtx) {
					executionCtx.waitUntil(completion);
				}
				else {
					void completion;
				}
			}

			return interactionResponse(handled.response.type, handled.response.data);
		}

		if (interaction.type === InteractionType.MODAL_SUBMIT) {
			const discord = createDiscord(env, interaction);
			const settingsHandled = await handleSettingsInteraction(interaction, database, discord);
			const handled = settingsHandled ?? await handleLockdownInteraction(interaction, database, discord)
				?? handleStatusInteraction(interaction, discord)
				?? handleTranslateInteraction(interaction, env, discord)
				?? await handleIssueInteraction(interaction, database, discord);
			if (!handled) {
				return interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, {
					content: "This form is not supported.",
					flags: InteractionResponseFlags.EPHEMERAL,
				});
			}

			if (handled.completion) {
				const completion = Promise.resolve()
					.then(() => typeof handled.completion === "function" ? handled.completion() : handled.completion)
					.catch((error) => {
						console.error("Modal submission failed:", error);
						return discord.editOriginalResponse({
							flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
							components: [{
								type: MessageComponentTypes.CONTAINER,
								accent_color: COLORS.error,
								components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "This form submission failed. Please try again." }],
							}],
						});
					});
				if (executionCtx) {
					executionCtx.waitUntil(completion);
				}
				else {
					void completion;
				}
			}

			return interactionResponse(handled.response.type, handled.response.data);
		}

		if (
			interaction.type !== InteractionType.APPLICATION_COMMAND
			|| ![1, 3].includes(interaction.data?.type)
			|| (interaction.data.type === 1 && interaction.data.options && !Array.isArray(interaction.data.options))
		) {
			return interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, {
				content: "This interaction is not supported.",
				flags: InteractionResponseFlags.EPHEMERAL,
			});
		}

		if (!interaction.guild_id) {
			return interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, {
				content: "Commands can only be used in servers.",
				flags: InteractionResponseFlags.EPHEMERAL,
			});
		}

		const command = commandsByName.get(interaction.data.name);

		if (!command) {
			return interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, {
				content: "Unknown command.",
				flags: InteractionResponseFlags.EPHEMERAL,
			});
		}

		const immediateResponse = command.getImmediateResponse?.(env, interaction);
		const initialResponse = immediateResponse
			? interactionResponse(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, immediateResponse.payload)
			: interactionResponse(
				InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
				(command.getDeferredResponseFlags?.(interaction) ?? 0)
					? { flags: command.getDeferredResponseFlags(interaction) }
					: undefined,
			);
		if (immediateResponse?.skipExecution) {
			return initialResponse;
		}
		const discord = createDiscord(env, interaction);
		const execution = command.respondImmediately
			? Promise.resolve().then(() => command.execute(interaction, discord, database, env))
			: Promise.resolve(command.execute(interaction, discord, database, env));
		const completion = execution
			.then(async (result) => {
				if (result?.initialResponse && result.completion) {
					await discord.editOriginalResponse(result.initialResponse);
					const completionResult = typeof result.completion === "function"
						? await result.completion()
						: await result.completion;
					return discord.editOriginalResponse(completionResult);
				}
				return discord.editOriginalResponse(result);
			})
			.catch((error) => {
				console.error(`Command ${command.name} failed:`, error);
				const errorMessage = "The command failed. Please try again later.";
				const responseBody = command.componentsV2
					? {
						flags: InteractionResponseFlags.IS_COMPONENTS_V2,
						components: [{
							type: MessageComponentTypes.CONTAINER,
							accent_color: COLORS.error,
							components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: errorMessage }],
						}],
					}
					: errorMessage;

				return discord.editOriginalResponse(responseBody);
			});

		if (executionCtx) {
			executionCtx.waitUntil(completion);
		}
		else if (command.executeImmediately || command.respondImmediately) {
			void completion;
		}
		else {
			await completion;
		}

		return initialResponse;
	},
};
