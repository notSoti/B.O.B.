import { createRuntimeConfig, runWithRuntimeConfig, unlinkIfPresent } from "./cloudflare-config.js";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const skipCreate = args.includes("--skip-d1-create");
const environment = args.find((arg) => !arg.startsWith("--"));

if (args.some((arg) => arg !== "development" && arg !== "--skip-d1-create")) {
	throw new Error("Usage: npm run deploy [-- development] [--skip-d1-create]");
}

const runtimeConfig = await createRuntimeConfig(environment, { skipCreate });
console.log(`Using D1 database '${runtimeConfig.databaseName}' (${runtimeConfig.databaseId}) for ${environment ?? "production"}.`);

try {
	if (!environment) {
		const syncResult = spawnSync("node", ["scripts/register-commands.js"], {
			cwd: runtimeConfig.projectRoot,
			stdio: "inherit",
		});

		if (syncResult.error) {
			throw syncResult.error;
		}

		if (syncResult.status !== 0) {
			throw new Error(`Discord command sync exited with status ${syncResult.status ?? "unknown"}.`);
		}
	}

	runWithRuntimeConfig([
		"d1",
		"migrations",
		"apply",
		"DB",
		"--remote",
		...(environment ? ["--env", environment] : []),
	], runtimeConfig.configPath);

	runWithRuntimeConfig([
		"deploy",
		...(environment ? ["--env", environment] : ["--env", ""]),
	], runtimeConfig.configPath);
}
finally {
	await unlinkIfPresent(runtimeConfig.configPath);
}
