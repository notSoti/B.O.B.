import {
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
	TextStyleTypes,
} from "discord-interactions";
import { COLORS } from "../constants.js";
import { errorPayload } from "../payloads.js";
import { escapeMarkdown } from "../utils.js";
import { isTranslationEnabled, translateText } from "../utils/translation.js";

function getInvokerId(interaction) {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function responseWith(type, data) {
	return { response: { type, ...(data ? { data } : {}) } };
}

function parseModalValues(components = [], values = {}) {
	for (const component of components) {
		if (component.component?.custom_id && component.component.value !== undefined) {
			values[component.component.custom_id] = component.component.value;
		}
		parseModalValues(component.components, values);
	}
	return values;
}

function validLanguageCode(code) {
	return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(code);
}

function languageName(code) {
	return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

function responseTranslationPayload(text, language) {
	const displayText = text.length > 3900 ? `${text.slice(0, 3897)}…` : text;
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
		components: [{
			type: MessageComponentTypes.CONTAINER,
			accent_color: COLORS.success,
			components: [
				{ type: MessageComponentTypes.TEXT_DISPLAY, content: `## Translation to ${escapeMarkdown(languageName(language))}\n${escapeMarkdown(displayText)}` },
			],
		}],
		allowed_mentions: { parse: [] },
	};
}

export function handleTranslateInteraction(interaction, env, discord) {
	const customId = interaction.data?.custom_id ?? "";
	const buttonMatch = /^translate:reply:(\d{17,20}):([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/i.exec(customId);
	const modalMatch = /^translate:submit:(\d{17,20}):([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/i.exec(customId);
	if (!buttonMatch && !modalMatch) {
		return null;
	}

	const [, ownerId, targetLanguage] = buttonMatch ?? modalMatch;
	if (!getInvokerId(interaction) || getInvokerId(interaction) !== ownerId) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("Only the person who requested this translation can use it."));
	}

	if (buttonMatch) {
		if (interaction.type !== InteractionType.MESSAGE_COMPONENT || interaction.data.component_type !== MessageComponentTypes.BUTTON) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This translation control is invalid."));
		}
		if (!isTranslationEnabled(env)) {
			return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("Translation is disabled because the OpenRouter API key is not configured."));
		}
		return responseWith(InteractionResponseType.MODAL, {
			custom_id: `translate:submit:${ownerId}:${targetLanguage}`,
			title: "Translate a Response",
			components: [{
				type: MessageComponentTypes.LABEL,
				label: "Text to translate",
				component: {
					type: MessageComponentTypes.INPUT_TEXT,
					custom_id: "response_text",
					style: TextStyleTypes.PARAGRAPH,
					placeholder: "Enter your response",
					min_length: 6,
					max_length: 2000,
					required: true,
				},
			}],
		});
	}

	if (interaction.type !== InteractionType.MODAL_SUBMIT || !validLanguageCode(targetLanguage)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("This translation form is invalid."));
	}
	if (!isTranslationEnabled(env)) {
		return responseWith(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, errorPayload("Translation is disabled because the OpenRouter API key is not configured."));
	}

	return {
		response: {
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
				components: [{
					type: MessageComponentTypes.CONTAINER,
					accent_color: COLORS.main,
					components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: "Translating…" }],
				}],
			},
		},
		completion: async () => {
			try {
				const values = parseModalValues(interaction.data.components);
				const translated = await translateText(values.response_text, env, targetLanguage);
				return discord.editOriginalResponse(responseTranslationPayload(translated.text, targetLanguage));
			}
			catch (error) {
				console.error("Response translation failed:", error);
				return discord.editOriginalResponse(errorPayload("The translation failed. Please try again."));
			}
		},
	};
}