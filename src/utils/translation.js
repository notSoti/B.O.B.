const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TRANSLATION_LENGTH = 4000;

function validateText(text) {
	const trimmed = String(text ?? "").trim();
	if (!trimmed) {
		throw new Error("There is no text to translate.");
	}
	if (trimmed.length > MAX_TRANSLATION_LENGTH) {
		throw new Error(`Text must be ${MAX_TRANSLATION_LENGTH} characters or fewer.`);
	}
	return trimmed;
}

function validLanguageCode(code) {
	return typeof code === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(code);
}

async function translateWithOpenRouter(text, targetLanguage, apiKey, model) {
	const response = await fetch(OPENROUTER_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "https://github.com/",
			"X-Title": "BOB-Bot",
		},
		body: JSON.stringify({
			model,
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "translation_result",
					strict: true,
					schema: {
						type: "object",
						properties: {
							translation: { type: "string" },
							source_language: { type: "string" },
							source_language_code: { type: "string" },
						},
						required: ["translation", "source_language", "source_language_code"],
						additionalProperties: false,
					},
				},
			},
			plugins: [{ id: "response-healing" }],
			provider: { require_parameters: true },
			messages: [{
				role: "user",
				content: [
					`Translate the text below into language code ${targetLanguage}. Detect its original language.`,
					"source_language_code must be an ISO 639-1 language code when possible; include a regional subtag only when needed.",
					`Text: ${JSON.stringify(text)}`,
				].join("\n"),
			}],
		}),
	});

	if (!response.ok) {
		throw new Error(`OpenRouter returned HTTP ${response.status}`);
	}

	const result = await response.json();
	const content = result.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		throw new Error("OpenRouter returned an invalid response");
	}

	const jsonText = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
	const translated = JSON.parse(jsonText);
	if (
		typeof translated.translation !== "string"
		|| !translated.translation.trim()
		|| !validLanguageCode(translated.source_language_code)
	) {
		throw new Error("OpenRouter returned incomplete translation data");
	}

	return {
		text: translated.translation.trim(),
		sourceLanguage: translated.source_language_code.toLowerCase(),
		sourceLanguageCode: translated.source_language_code.toLowerCase(),
	};
}

/**
 * Checks whether OpenRouter translation is configured.
 * @param {object} env Cloudflare Worker environment bindings.
 * @returns {boolean} Whether a non-empty API key is configured.
 */
export function isTranslationEnabled(env) {
	return Boolean(env.OPENROUTER_API_KEY?.trim());
}

/**
 * Translates text through OpenRouter.
 * @param {string} input Text to translate.
 * @param {object} env Cloudflare Worker environment bindings.
 * @param {string} targetLanguage Target ISO language code.
 * @returns {Promise<{text: string, sourceLanguage?: string, sourceLanguageCode?: string}>} Translation result.
 */
export async function translateText(input, env, targetLanguage = "en") {
	const text = validateText(input);
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("Translation is disabled because OPENROUTER_API_KEY is not configured.");
	}
	return translateWithOpenRouter(text, targetLanguage, apiKey, env.OPENROUTER_MODEL?.trim() || "openrouter/free");
}