import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceConfigPath = resolve(projectRoot, "wrangler.jsonc");

function runWrangler(args, configPath = sourceConfigPath, inheritOutput = false) {
	return execFileSync("npx", ["wrangler", ...args, "--config", configPath], {
		cwd: projectRoot,
		encoding: inheritOutput ? undefined : "utf8",
		stdio: inheritOutput ? "inherit" : ["inherit", "pipe", "inherit"],
	});
}

function parseDatabaseList(output) {
	for (let start = 0; start < output.length; start += 1) {
		if (output[start] !== "[" && output[start] !== "{") {
			continue;
		}

		const stack = [];
		let inString = false;
		let escaped = false;

		for (let end = start; end < output.length; end += 1) {
			const character = output[end];

			if (inString) {
				if (escaped) {
					escaped = false;
				}
				else if (character === "\\") {
					escaped = true;
				}
				else if (character === "\"") {
					inString = false;
				}
				continue;
			}

			if (character === "\"") {
				inString = true;
			}
			else if (character === "[" || character === "{") {
				stack.push(character);
			}
			else if (character === "]" || character === "}") {
				const opening = stack.pop();

				if ((opening === "[" && character !== "]") || (opening === "{" && character !== "}")) {
					break;
				}

				if (stack.length === 0) {
					try {
						const parsed = JSON.parse(output.slice(start, end + 1));
						const databases = Array.isArray(parsed) ? parsed : parsed.result ?? parsed.databases;

						if (Array.isArray(databases)) {
							return databases;
						}
					}
					catch {
						break;
					}
				}
			}
		}
	}

	throw new Error(`Could not parse Wrangler D1 list output as JSON: ${output.slice(0, 300)}`);
}

function getDatabaseId(databaseList, name) {
	const database = databaseList.find((item) => item.name === name);

	return database?.uuid ?? database?.database_id ?? database?.id;
}

export async function createRuntimeConfig(environment, { skipCreate = false } = {}) {
	const config = JSON.parse(await readFile(sourceConfigPath, "utf8"));
	const selectedEnvironment = environment ? config.env?.[environment] : config;
	const d1Binding = selectedEnvironment?.d1_databases?.find((binding) => binding.binding === "DB");

	if (!selectedEnvironment || !d1Binding) {
		throw new Error(`No DB D1 binding is configured for ${environment ?? "production"}.`);
	}

	let databaseId = d1Binding.database_id;

	if (!databaseId) {
		const databases = parseDatabaseList(runWrangler(["d1", "list", "--json"]));
		databaseId = getDatabaseId(databases, d1Binding.database_name);

		if (!databaseId && skipCreate) {
			throw new Error(`D1 database '${d1Binding.database_name}' was not found. Create it first or omit --skip-d1-create.`);
		}

		if (!databaseId) {
			const runtimeConfigPath = resolve(projectRoot, `.wrangler-runtime-${process.pid}.jsonc`);

			await writeFile(runtimeConfigPath, JSON.stringify(config, null, "\t"));
			try {
				runWrangler([
					"d1",
					"create",
					d1Binding.database_name,
					"--binding",
					"DB",
					"--update-config",
					"--env",
					environment ?? "",
				], runtimeConfigPath, true);
			}
			finally {
				await unlinkIfPresent(runtimeConfigPath);
			}

			const refreshedDatabases = parseDatabaseList(runWrangler(["d1", "list", "--json"]));
			databaseId = getDatabaseId(refreshedDatabases, d1Binding.database_name);
		}
	}

	if (!databaseId) {
		throw new Error(`Could not resolve D1 database ID for '${d1Binding.database_name}'.`);
	}

	d1Binding.database_id = databaseId;
	const runtimeConfigPath = resolve(projectRoot, `.wrangler-runtime-${process.pid}.jsonc`);

	await writeFile(runtimeConfigPath, `${JSON.stringify(config, null, "\t")}\n`);
	return {
		databaseName: d1Binding.database_name,
		databaseId,
		configPath: runtimeConfigPath,
		projectRoot,
	};
}

export function runWithRuntimeConfig(args, configPath, { inheritOutput = true } = {}) {
	return runWrangler(args, configPath, inheritOutput);
}

export async function unlinkIfPresent(path) {
	const { unlink } = await import("node:fs/promises");

	try {
		await unlink(path);
	}
	catch (error) {
		if (error.code !== "ENOENT") {
			throw error;
		}
	}
}