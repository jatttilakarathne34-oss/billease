# BillEase — POS & Business Management (Vercel + PostgreSQL)

Node.js + Express backend, PostgreSQL database, plain-JS frontend. All permissions are enforced on the server.
Every completed order is saved to the database **together with its A4 PDF invoice** (table `order_pdfs`).

## Deploy on Vercel
> The web pages are also bundled into `assets.js` (made from `public/` by `npm run build`) and served by the app itself, so the site loads even if the host does not publish the `public/` folder. If you ever change files in `public/`, run `npm run build` and upload the new `assets.js` too.

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
    npm test         # 182 end-to-end checks
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

## Automatic bill discounts
Owner → **Discounts**: add rules such as *bills of Rs. 5,000 or more get 5% off*. At checkout the discount is applied automatically (the cashier sees a live preview and a "add Rs. X more to get 5% off" hint). The bill is judged **after product discounts and before tax**; if several rules match, only the biggest applies (no stacking). The discount is stored on the order, shown on its own line on the A4 invoice and 57mm receipt, included in reports, and logged. Users with the *discount* permission can untick "Apply bill discount" for a single bill (logged as a waiver). Deleting or disabling a rule never changes past invoices.

## Routes (areas)
Owner/Manager → **Routes**: add routes such as *Anuradhapura*. On **Customers**, tick shops (e.g. *ABC Shop*) and *Assign to route*; on **Users**, give an employee a route. That employee's billing screen then lists only their route's shops, and the server refuses bills for shops on other routes. Shops they add join their route automatically. Users without a route (owner, managers) see every customer and get a route filter in billing.

## Deleting cancelled orders
Orders → tick the checkbox on cancelled orders (or use the row's *Delete* button, or the header checkbox to tick them all) → *Delete selected permanently*. Only **cancelled** orders can be deleted (cancel a live order first, which restores its stock). The order, its items and its saved PDF are erased for good; a short line in the Activity Log records who deleted it. Only the Owner can do this unless the Owner grants the *Permanently delete cancelled orders* permission. Invoice numbers are not reused, so deleted numbers leave a gap.

## Returns (credit notes)
Orders → **↩ Return** on the original invoice. The screen shows, per item, what was billed, what was already returned and what can still be returned; it will not accept more than that (bill 20, return 10 → 10 still returnable; asking for 20 is refused). Each return gets a credit-note number (RET-000001) with an A4 and a 57mm PDF. Choose the refund: credit to the customer's account (lowers what they owe; shown as "credit" if they end up in credit), or cash/card/transfer. Goods go back into stock unless you untick *Restock* (spoiled). The refund is exactly what the customer paid for those units, including any bill discount; the parts of a split return add up to the invoice amount to the cent. Reports and the dashboard show revenue **net of returns**. A return can be cancelled by someone with the *Cancel orders* permission (stock and credit are reversed); an invoice with active returns cannot be cancelled until they are.

## Roles
| | Owner | Manager | Employee |
|---|---|---|---|
| Billing / POS | yes | yes | yes |
| Manage automatic bill-discount rules | yes | only if granted | no |
| Change discounts / waive bill discount at billing | yes | yes | only if granted (otherwise the product's own discount applies) |
| Add / edit / archive products | yes | only if granted | no |
| Record returns / credit notes | yes | yes (default) | only if granted (own invoices only) |
| Cancel orders (and returns) | yes | only if granted | no |
| Permanently delete cancelled orders | yes | only if granted | no |
| Manage routes, assign shops | yes | yes (default) | no |
| Stock, customers, creditors, reports | yes | yes (default) | only if granted |
| Create users | managers + employees | employees only | no |
| Settings, data export | yes | no | no |

Orders are never deleted. They are cancelled (reason required, stock restored, logged). Users are deactivated, which logs them out immediately. Errors go to the `error_logs` table and to Vercel's runtime logs.

## Costs and limits
Vercel and Neon both have free tiers with usage limits. The polling above makes one small request every few seconds per open owner/manager screen. Bluetooth printing and phone cameras need HTTPS, which Vercel provides automatically.
