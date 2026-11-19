# B.O.B.

An interaction-only Discord bot on Cloudflare Workers for the Dyno Discord server.

**Requirements:** Node.js/npm, a Cloudflare account, and a Discord application

## 1. Set up local build

1. Clone this repository and open a terminal in the repository root. Install dependencies with `npm ci`.
2. Create the development Worker and its D1 database from your project-root terminal:

	```sh
	npm run deploy -- development
	```

	This first deployment creates `bob-development` and `bob-development` D1 if needed. If it asks you to apply any database migrations, type `y`.
3. Add the development Discord app's three runtime secrets (found on [Discord's Developer Portal](https://discord.com/developers/applications/select/)) to the Worker that step 2 created. Run these commands from the same project-root terminal, one at a time, and enter the matching development-app value when prompted:

   ```sh
   npx wrangler secret put DISCORD_PUBLIC_KEY --env development
   npx wrangler secret put DISCORD_APPLICATION_ID --env development
   npx wrangler secret put DISCORD_BOT_TOKEN --env development
   ```

   The `--env development` flag targets the `bob-development` Worker, not production. Translation is disabled unless `OPENROUTER_API_KEY` is configured as a Worker secret. You can optionally set the `OPENROUTER_MODEL` runtime variable (defaults to `openrouter/free`).
4. Set the development Discord app's **Interactions Endpoint URL** to that Worker’s `workers.dev` URL, shown in Cloudflare under **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → bob-development → Domains**.
5. Start a remote development session:

   ```sh
   npm run dev
   ```

   Wrangler sends your current checkout (including uncommitted changes) to Cloudflare and runs it with the development Worker and D1. Production is not involved.
6. Sync the dev app's global slash commands once, and again after command changes. Create an `.env` file at the repository root with the dev app's credentials:

   ```dotenv
   DISCORD_APPLICATION_ID=your_development_app_id
   DISCORD_PUBLIC_KEY=your_development_public_token
   DISCORD_BOT_TOKEN=your_development_bot_token
   ```

   Then run `npm run sync-commands`.

The development database (`bob-development`) is created automatically if needed and is separate from production. Never configure both Workers to use the same D1 database.

## 2. Set up production

1. In Cloudflare **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**, create a Worker and connect it to the GitHub repository.
2. Configure the build:
   - Root directory: `/`
   - Build command: empty
   - Deploy command: `npm run deploy`
   - Preview builds: disabled
3. Under Advanced Settings, set the following values accordingly:
   - `DISCORD_PUBLIC_KEY`
   - `DISCORD_APPLICATION_ID`
   - `DISCORD_BOT_TOKEN` (encrypt as a secret)
   - `OPENROUTER_API_KEY` (encrypt as a secret) to optionally enable translations.
   - Optionally, `OPENROUTER_MODEL` (defaults to `openrouter/free`) to select the OpenRouter model.
4. Deploy! On the first deploy, the script creates the production D1 database (`bob`) if it does not already exist. It uses a temporary ignored Wrangler config for the generated database ID; no generated ID needs to be committed.
5. Inside the Worker, head to **Settings → Runtime variables and secrets** and set the same values from the step 3 again. This time mark all of them as secrets.
6. Set the production Discord app's **[Interactions Endpoint URL](https://discord.com/developers/applications/select/)** to the appropriate Worker's `workers.dev` URL found in the **Domains** tab (make sure to also enable it).

Cloudflare Workers Builds deploys from the connected production (main) branch. It applies migrations, syncs global commands, then deploys the Worker. The Workers Builds API token needs permission to deploy Workers and list/create D1 databases.

#### If you already created D1

The configured production database name is `bob`. The deploy script finds and reuses an existing database with that name. It supplies the `DB` binding during deployment, so no manual binding step is needed. To use a differently named database, update `database_name` in `wrangler.jsonc`. To disable automatic database creation, use `npm run deploy -- --skip-d1-create`.

## 3. Manual deployments

From the repository root:

```sh
npm run deploy                         # production
npm run deploy -- development          # development
npm run deploy -- --skip-d1-create     # production; require existing D1
npm run deploy -- development --skip-d1-create
```

Manual production deployment also syncs commands, applies migrations, and deploys. Manual development deployment applies development migrations and deploys, but leaves command sync to you.
