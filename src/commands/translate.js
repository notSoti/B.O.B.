import {
	ButtonStyleTypes,
	InteractionResponseFlags,
	MessageComponentTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { errorPayload } from "../payloads.js";
import { escapeMarkdown } from "../utils.js";
import { isTranslationEnabled, translateText } from "../utils/translation.js";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function languageName(code) {
	return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

function translationPayload(text, sourceLanguage, sourceLanguageCode, userId) {
	const displayText = text.length > 3900 ? `${text.slice(0, 3897)}…` : text;
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## Translation to English\n${escapeMarkdown(displayText)}` },
				{ type: MessageComponentTypes.SEPARATOR, spacing: 1 },
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `Detected language: ${escapeMarkdown(languageName(sourceLanguage) || sourceLanguage)}` },
				{
					type: MessageComponentTypes.ACTION_ROW,
					components: [{
						type: MessageComponentTypes.BUTTON,
						custom_id: `translate:reply:${userId}:${sourceLanguageCode}`,
						label: "Translate a Response",
						style: ButtonStyleTypes.PRIMARY,
					}],
				},
			],
		}],
		allowed_mentions: { parse: [] },
	};
}

function translationProgressPayload() {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.main,
			components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Translating…" }],
		}],
	};
}

function translationDisabledPayload() {
	return errorPayload("Translation is disabled because the OpenRouter API key is not configured.");
}

function translationErrorPayload() {
	return errorPayload("The translation failed. Please try again.");
}

export default {
	name: "Translate to English",
	description: "Translate this message to English.",
	applicationCommandType: 3,
	componentsV2: true,
	respondImmediately: true,
	getImmediateResponse(env) {
		return isTranslationEnabled(env)
			? { payload: translationProgressPayload() }
			: { payload: translationDisabledPayload(), skipExecution: true };
	},
	async execute(interaction, discord, database, env) {
		void database;
		const messageId = interaction.data.target_id;
		const message = interaction.data.resolved?.messages?.[messageId];
		if (!message) {
			throw new Error("The selected message could not be loaded.");
		}

		const text = [message.content, ...(message.embeds ?? []).map((embed) => embed.description)]
			.filter((part) => typeof part === "string" && part.trim())
			.join("\n");
		if (!text) {
			throw new Error("The selected message does not contain translatable text.");
		}

		const userId = getInvokerId(interaction);
		try {
			const translated = await translateText(text, env, "en");
			return translationPayload(translated.text, translated.sourceLanguage, translated.sourceLanguageCode, userId);
		}
		catch (error) {
			console.error("Message translation failed:", error);
			return translationErrorPayload();
		}
	},
};