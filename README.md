# BillEase — POS & Business Management (Vercel + PostgreSQL)

Node.js + Express backend, PostgreSQL database, plain-JS frontend. All permissions are enforced on the server.
Every completed order is saved to the database **together with its A4 PDF invoice** (table `order_pdfs`).

## Deploy on Vercel
1. Put this folder in a GitHub repository (or use the Vercel CLI: `vercel`).
2. vercel.com → **Add New → Project** → import the repository. Vercel detects Express automatically; no build settings needed.
3. Open the project → **Storage** tab → create/connect **Neon (Serverless Postgres)**. Pick the region closest to you (Singapore for Sri Lanka) and connect it to the project. Vercel adds `DATABASE_URL` for you.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variable is picked up.
5. Open your site. The first visit shows **Setup**: create the Owner account. The database tables are created automatically on the first request.
6. Optional: add `JWT_SECRET` (any long random text) under Settings → Environment Variables. If you don't, one is generated and stored in the database.

`vercel.json` sets the function region to `sin1` (Singapore). Keep the function region and the database region the same, because it makes every action noticeably faster. Change it if your database is elsewhere.

## Run locally
    npm install
    npm start        # http://localhost:3000  (embedded PostgreSQL stored in ./data/pgdata)
    npm test         # 84 end-to-end checks
To use your Vercel database and Blob store locally, run `vercel env pull .env.local` — the app reads `.env.local` automatically.
`npm test` never touches your real database: it uses embedded Postgres, or the throw-away database in `TEST_DATABASE_URL` if you set it.

## Storage and environment variables
Vercel creates the first two for you when you connect storage in the **Storage** tab; you never type their values. Tick **Production, Preview and Development** when connecting, then redeploy.

| Variable | Created by | Needed? | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Vercel, when you connect **Neon Postgres** | **Required** | The database: users, orders, products, invoice PDFs |
| `BLOB_READ_WRITE_TOKEN` | Vercel, when you create a **Blob store** (choose **Public**) | Optional | Product photos and the business logo go to Vercel Blob. Without it they are stored in Postgres instead (works, just not on a CDN) |
| `JWT_SECRET` | You (any long random text) | Optional | Signs login cookies. If empty, one is generated and kept in the database |
| `PG_POOL_MAX` | You | Optional | Max database connections per function instance (default 4) |

Neon may also add `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and `POSTGRES_*` variables. The app does not use them; leave them in place.
If you set a custom prefix when connecting a store, the names change. The app expects exactly `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`.
The Blob store must be **Public** (its access mode is fixed when it is created). Photos are resized in the browser to 640 px, the logo to 400 px, and the server accepts PNG/JPEG/WebP up to 3 MB, checked by file content.
Upgrading an existing deployment is automatic: the first request after deploying adds the new columns and tables, and keeps your data.

## How it works on Vercel
* **Database:** one PostgreSQL database holds users, products, orders, customers, payments, stock, activity logs **and the invoice PDFs**.
* **Invoice PDFs:** created when the order is saved and stored in the database (one per order, never duplicated). A cancelled order's PDF is re-issued with a CANCELLED stamp. Old invoices do not change when you edit business details. The 57mm receipt is generated on demand from the same order.
* **Live updates:** Vercel functions cannot hold connections open, so screens check for new events every 4 seconds (owner/manager) or 15 seconds (employees), only while the tab is visible. The order is already in the database and its PDF is ready when the owner's screen is notified.
* **No duplicates:** each order carries a unique reference from the phone; double taps and retries return the same invoice. Stock is deducted atomically, so two phones can never sell the same last item.
* **Safety copy:** Settings → *Download full data export (JSON)*. Restore points come from your database provider (Neon dashboard).

## Roles
| | Owner | Manager | Employee |
|---|---|---|---|
| Billing / POS | yes | yes | yes |
| Change discounts at billing | yes | yes | only if granted (otherwise the product's own discount applies) |
| Add / edit / archive products | yes | only if granted | no |
| Cancel orders | yes | only if granted | no |
| Stock, customers, creditors, reports | yes | yes (default) | only if granted |
| Create users | managers + employees | employees only | no |
| Settings, data export | yes | no | no |

Orders are never deleted. They are cancelled (reason required, stock restored, logged). Users are deactivated, which logs them out immediately. Errors go to the `error_logs` table and to Vercel's runtime logs.

## Costs and limits
Vercel and Neon both have free tiers with usage limits. The polling above makes one small request every few seconds per open owner/manager screen. Bluetooth printing and phone cameras need HTTPS, which Vercel provides automatically.
