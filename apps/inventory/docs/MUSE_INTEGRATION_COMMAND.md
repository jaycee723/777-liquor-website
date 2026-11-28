# Incorporating `inventory.777liquor.com` into the Main `777liquor.com` GitHub Repository (Muse Command)

Copy and paste the command block below directly to **Muse** inside your main `777liquor.com` website repository.

---

## Copy-Paste Command for Muse

```text
MUSE INTEGRATION COMMAND — Incorporate the 777 Inventory Operations app (777liquor.com_inventory_page) into this main 777liquor.com repository and host it on Cloudflare Workers at https://inventory.777liquor.com under the 777liquor.com zone.

DO THESE STEPS IN ORDER:

1. IMPORT THE INVENTORY APP AS A SUB-APP FOLDER
   - Add the inventory repository into `/apps/inventory/` (using git subtree or direct copy from `777liquor.com_inventory_page` main branch) without modifying existing main-site pages in the root.
   - Preserve `apps/inventory/wrangler.jsonc`, `apps/inventory/cloudflare/inventory-worker.ts`, `apps/inventory/src/services/cloverService.ts`, and `apps/inventory/server/cloverService.ts`.

2. CONFIGURE CLOUDFLARE WORKERS CUSTOM DOMAIN (`inventory.777liquor.com`)
   - Verify `apps/inventory/wrangler.jsonc` has:
     - `"name": "777-inventory-app"`
     - `"main": "cloudflare/inventory-worker.ts"`
     - `"assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] }`
     - `"routes": [{ "pattern": "inventory.777liquor.com", "custom_domain": true }]`
   - Cloudflare will automatically provision the DNS record and TLS certificate for `inventory.777liquor.com` under the `777liquor.com` zone on first deploy.

3. ADD A DISCREET LAUNCH LINK ON THE MAIN `777liquor.com` SITE
   - In the main site's footer (or Staff Portal menu), add a clean link labeled "Staff Inventory" pointing to `https://inventory.777liquor.com` (`rel="noopener noreferrer"`).
   - Do not change the main site's public customer navigation or SEO metadata.

4. WIRE GITHUB ACTIONS AUTO-DEPLOY
   - Copy `apps/inventory/.github/workflows/deploy-inventory-cloudflare.yml` to `.github/workflows/deploy-inventory-cloudflare.yml` in the main repo root.
   - Set `defaults.run.working-directory: apps/inventory` and `workingDirectory: apps/inventory` on `cloudflare/wrangler-action@v3`, and trigger on `push` to `main` with `paths: ['apps/inventory/**', '.github/workflows/deploy-inventory-cloudflare.yml']`.

5. VERIFY & REPORT
   - Run `npm ci && npm run lint && npm run build` inside `apps/inventory/`.
   - Push to `main`, check the GitHub Actions run status, and fix any workflow errors until green.
   - Confirm the required secrets checklist for the repo/Cloudflare:
     - GitHub Repo Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
     - Cloudflare Worker Secrets (`cd apps/inventory && npx wrangler secret put ...`): `CLOVER_MERCHANT_ID`, `CLOVER_API_TOKEN`, `GEMINI_API_KEY`
```

---

## One-Time Cloudflare Secret Commands (Run Once Locally or in Cloudflare Dashboard)

```bash
npx wrangler secret put CLOVER_MERCHANT_ID
npx wrangler secret put CLOVER_API_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy --config wrangler.jsonc
```

Once deployed, `https://inventory.777liquor.com` serves both the launch/sign-in page and the live Clover REST API v3 GET/POST edge bridge directly under `777liquor.com`.
