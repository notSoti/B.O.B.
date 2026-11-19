import { createRuntimeConfig, runWithRuntimeConfig, unlinkIfPresent } from "./cloudflare-config.js";

const runtimeConfig = await createRuntimeConfig("development");
console.log(`Using D1 database '${runtimeConfig.databaseName}' (${runtimeConfig.databaseId}) for development.`);

try {
	runWithRuntimeConfig([
		"dev",
		"--env",
		"development",
		"--remote",
	], runtimeConfig.configPath);
}
finally {
	await unlinkIfPresent(runtimeConfig.configPath);
}
