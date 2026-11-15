'use strict';
// End-to-end checks against the real server + a real PostgreSQL engine.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
process.env.NODE_ENV = 'test'; delete process.env.BLOB_READ_WRITE_TOKEN; // tests never read .env.local / your real DATABASE_URL
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; else { delete process.env.DATABASE_URL; process.env.PGLITE_DIR = 'memory'; } // TEST_DATABASE_URL = a throw-away Postgres; otherwise embedded Postgres
const app = require('../server');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ✓', m); };
function client(base) {
  let cookie = '';
  const f = async (method, p, body, raw) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    if (raw) return r; let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d };
  };
  f.cookie = () => cookie; return f;
}
(async () => {
  const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  const O = client(base), M = client(base), E = client(base), X = client(base);
  console.log('Setup & auth');
  ok((await O('GET', '/api/status')).d.needsSetup === true, 'fresh system asks for owner setup');
  ok((await X('POST', '/api/setup', { name: 'Own', username: 'owner', password: 'short' })).s === 400, 'weak owner password rejected');
  ok((await O('POST', '/api/setup', { business: 'Thejaa Food Product', name: 'The Owner', username: 'owner', password: 'ownerpass1' })).s === 200, 'owner created');
  ok((await O('POST', '/api/setup', { name: 'x', username: 'hacker', password: 'password123' })).s === 403, 'second setup blocked');
  ok((await O('POST', '/api/login', { username: 'owner', password: 'wrong' })).s === 401, 'wrong password rejected');
  ok((await O('POST', '/api/login', { username: 'owner', password: 'ownerpass1' })).s === 200, 'owner logs in');
  ok((await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403, 'requests without CSRF header are blocked');
  console.log('Users & roles');
  const mgr = await O('POST', '/api/users', { name: 'Branch Mgr', username: 'mgr', password: 'managerpass', role: 'manager' }); ok(mgr.s === 200 && mgr.d.role === 'manager', 'owner creates a manager');
  ok((await M('POST', '/api/login', { username: 'mgr', password: 'managerpass' })).s === 200, 'manager logs in');
  const emp = await M('POST', '/api/users', { name: 'Rep One', username: 'rep1', password: 'reppass123', role: 'employee' }); ok(emp.s === 200, 'manager creates an employee');
  ok((await M('POST', '/api/users', { name: 'Evil', username: 'evil', password: 'password123', role: 'manager' })).s === 403, 'manager cannot create a manager');
  ok((await E('POST', '/api/login', { username: 'rep1', password: 'reppass123' })).s === 200, 'employee logs in');
  ok((await E('GET', '/api/users')).s === 403, 'employee cannot list users');
  ok((await E('POST', '/api/products', { name: 'X', price: 1 })).s === 403, 'employee cannot add products (server-enforced)');
  ok((await M('POST', '/api/products', { name: 'X', price: 1 })).s === 403, 'manager cannot add products by default');
  ok((await E('GET', '/api/reports/summary')).s === 403, 'employee cannot see reports');
  ok((await E('PATCH', '/api/settings', { business_name: 'Hack' })).s === 403, 'employee cannot change settings');
  ok((await M('PATCH', '/api/settings', { business_name: 'Hack' })).s === 403, 'manager cannot change settings');
  ok((await M('PATCH', '/api/users/1', { active: false })).s === 403, 'manager cannot touch the owner');
  console.log('Products, stock, discounts');
  const p1 = (await O('POST', '/api/products', { name: 'Cut chicken', sku: 'CHK', price: 1200, cost: 900, discount_pct: 0, tax_pct: 0, stock: 50 })).d.id;
  const p2 = (await O('POST', '/api/products', { name: 'Milk 1L', price: 100, cost: 70, discount_pct: 10, tax_pct: 12, stock: 5 })).d.id; ok(p1 && p2, 'owner adds products');
  ok((await O('POST', '/api/products', { name: 'dup', sku: 'CHK', price: 5 })).s === 409, 'duplicate SKU rejected');
  ok((await M('POST', `/api/products/${p2}/stock`, { delta: 10, reason: 'Delivery' })).s === 200, 'manager receives stock');
  ok((await E('POST', `/api/products/${p2}/stock`, { delta: 10 })).s === 403, 'employee cannot adjust stock');
  const eprods = (await E('GET', '/api/products')).d; ok(eprods.length === 2 && !('cost' in eprods[0]), 'employee sees products without cost price');
  console.log('Orders, real-time sync, PDF');
  const poll0 = (await O('GET', '/api/poll')).d; ok(Number.isInteger(poll0.last), 'owner screen starts polling for live events');
  const body = { client_ref: 'ref-abcdef-001', payment_method: 'cash', items: [{ product_id: p1, qty: 13.6 }, { product_id: p2, qty: 2, discount_pct: 50 }] };
  const o1 = await E('POST', '/api/orders', body); ok(o1.s === 200 && /^INV-\d{6}$/.test(o1.d.invoice_no), 'employee creates order with unique invoice number ' + o1.d.invoice_no);
  const exp = 1200 * 13.6 + (100 * 2 * 0.9 * 1.12); ok(Math.abs(o1.d.total - exp) < 0.01, `server ignores employee discount override & computes total (${o1.d.total})`);
  const dup = await E('POST', '/api/orders', body); ok(dup.d.duplicate === true && dup.d.id === o1.d.id, 'duplicate submission returns the same order (no duplicate invoice)');
  ok((await D().get('SELECT COUNT(*)::int n FROM orders')).n === 1, 'only one order row exists');
  ok(Math.abs((await D().get('SELECT stock FROM products WHERE id=@id', { id: p1 })).stock - (50 - 13.6)) < 1e-9, 'stock deducted once');
  const poll1 = (await O('GET', '/api/poll?since=' + poll0.last)).d; ok(poll1.events.some(e => e.type === 'order' && e.data.invoice_no === o1.d.invoice_no && e.data.employee === 'Rep One'), 'main computer receives the new order on its next poll (no refresh)');
  ok((await E('GET', '/api/poll?since=' + poll0.last)).d.events.every(e => e.type !== 'order' || e.data.employee === 'Rep One'), 'employee only receives events for own orders');
  const pdf = await O('GET', `/api/orders/${o1.d.id}/pdf`, null, true); const buf = Buffer.from(await pdf.arrayBuffer()); ok(buf.slice(0, 4).toString() === '%PDF' && buf.length > 1500, 'A4 PDF invoice generated');
  const row = await D().get('SELECT size,invoice_no,substr(pdf,1,4) AS head FROM order_pdfs WHERE order_id=@id', { id: o1.d.id }); ok(row && Buffer.from(row.head).toString() === '%PDF' && row.size === buf.length, 'A4 PDF is stored inside the database (order_pdfs) and served from it');
  ok((await D().get('SELECT COUNT(*)::int n FROM order_pdfs')).n === 1, 'exactly one stored PDF per order (no duplicate generation)');
  const th = await O('GET', `/api/orders/${o1.d.id}/pdf?format=thermal`, null, true); ok(Buffer.from(await th.arrayBuffer()).slice(0, 4).toString() === '%PDF', '57mm receipt PDF generated');
  ok((await E('GET', `/api/orders/${o1.d.id}`)).s === 200, 'employee can view own order');
  ok((await E('POST', '/api/orders', { client_ref: 'ref-abcdef-002', payment_method: 'cash', items: [{ product_id: p2, qty: 9999 }] })).s === 409, 'insufficient stock rejected');
  ok((await E('POST', '/api/orders', { client_ref: 'ref-abcdef-003', payment_method: 'credit', items: [{ product_id: p2, qty: 1 }] })).s === 400, 'credit sale requires a customer');
  ok((await E('POST', `/api/orders/${o1.d.id}/cancel`, { reason: 'x' })).s === 403, 'employee cannot cancel/delete orders');
  ok((await M('POST', `/api/orders/${o1.d.id}/cancel`, { reason: 'x' })).s === 403, 'manager cannot cancel orders by default');
  ok((await E('GET', '/api/orders')).d.length === 1, 'employee sees own orders only');
  console.log('Creditors');
  const cust = (await E('POST', '/api/customers', { name: 'Jayabima Stores', phone: '0771234567' })).d.id;
  const o2 = await M('POST', '/api/orders', { client_ref: 'ref-abcdef-004', customer_id: cust, payment_method: 'credit', paid: 500, items: [{ product_id: p1, qty: 1 }] }); ok(o2.s === 200, 'manager makes a credit sale');
  ok((await O('GET', '/api/creditors')).d[0].balance === 700, 'creditor balance = 700');
  ok((await E('POST', '/api/payments', { customer_id: cust, amount: 100 })).s === 403, 'employee cannot record creditor payments');
  ok((await O('POST', '/api/payments', { customer_id: cust, amount: 5000 })).s === 400, 'overpayment rejected');
  ok((await O('POST', '/api/payments', { customer_id: cust, amount: 300 })).d.balance === 400, 'payment reduces balance to 400');
  console.log('Analytics');
  const sum = (await O('GET', '/api/reports/summary')).d; ok(Math.abs(sum.cards.today.revenue - (o1.d.total + 1200)) < 0.01 && sum.cards.today.orders === 2, "today's sales match database");
  ok(sum.outstanding === 400, 'outstanding creditor total matches'); ok(sum.employees.find(e => e.name === 'Rep One').orders === 1, 'employee-wise performance');
  ok(sum.products[0].name === 'CUT CHICKEN', 'best-selling product ranked first'); ok(sum.payments.length === 2, 'payment method breakdown');
  const xl = await O('GET', '/api/reports/export?type=xlsx', null, true); ok(xl.headers.get('content-type').includes('spreadsheetml') && (await xl.arrayBuffer()).byteLength > 3000, 'Excel export works');
  const rp = await O('GET', '/api/reports/export?type=pdf', null, true); ok(Buffer.from(await rp.arrayBuffer()).slice(0, 4).toString() === '%PDF', 'PDF report export works');
  ok((await E('GET', '/api/reports/export?type=xlsx', null, true)).status === 403, 'employee cannot export');
  console.log('File storage (product photos & logo)');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const upl = async (who, method, p, body, type = 'image/png') => { const r = await fetch(base + p, { method, headers: { 'Content-Type': type, 'X-CSRF': '1', cookie: who.cookie() }, body }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  ok((await upl(E, 'POST', `/api/products/${p1}/image`, PNG)).s === 403, 'employee cannot upload product photos');
  ok((await upl(M, 'POST', `/api/products/${p1}/image`, PNG)).s === 403, 'manager cannot upload product photos by default');
  ok((await upl(O, 'POST', `/api/products/${p1}/image`, Buffer.from('<script>alert(1)</script> not an image at all'))).s === 400, 'a file that is not really an image is rejected (checked by content, not header)');
  ok((await upl(O, 'POST', `/api/products/${p1}/image`, Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]))).s === 413, 'files over 3 MB are rejected');
  const im1 = await upl(O, 'POST', `/api/products/${p1}/image`, PNG); ok(im1.s === 200 && /^\/api\/images\/[a-f0-9]{32}$/.test(im1.d.image_url), 'owner uploads a product photo (stored in Postgres when no Blob token)');
  const gi = await fetch(base + im1.d.image_url); ok(gi.status === 200 && gi.headers.get('content-type') === 'image/png' && Buffer.from(await gi.arrayBuffer()).equals(PNG), 'photo is served back byte-for-byte with the right content type');
  ok((await E('GET', '/api/products')).d.find(p => p.id === p1).image_url === im1.d.image_url, 'photo URL appears in the product list the POS uses');
  const im2 = await upl(O, 'POST', `/api/products/${p1}/image`, PNG); ok(im2.d.image_url !== im1.d.image_url && (await fetch(base + im1.d.image_url)).status === 404, 'replacing a photo deletes the old file');
  ok((await O('DELETE', `/api/products/${p1}/image`)).s === 200 && (await fetch(base + im2.d.image_url)).status === 404, 'removing a photo deletes the file');
  const th0 = Buffer.from(await (await O('GET', `/api/orders/${o1.d.id}/pdf?format=thermal`, null, true)).arrayBuffer()).length;
  ok((await upl(M, 'POST', '/api/settings/logo', PNG)).s === 403 && (await upl(E, 'POST', '/api/settings/logo', PNG)).s === 403, 'only the owner can change the logo');
  ok((await upl(O, 'POST', '/api/settings/logo', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]), 'image/webp')).s === 400, 'WebP logo rejected (PDF invoices need PNG/JPEG)');
  const lg = await upl(O, 'POST', '/api/settings/logo', PNG); ok(lg.s === 200 && lg.d.logo.startsWith('/api/images/'), 'owner uploads the logo');
  ok((await O('GET', '/api/status')).d.logo === lg.d.logo, 'logo shows on the login screen (public status)');
  const th1 = Buffer.from(await (await O('GET', `/api/orders/${o1.d.id}/pdf?format=thermal`, null, true)).arrayBuffer()); ok(th1.slice(0, 4).toString() === '%PDF' && th1.length > th0, 'logo is printed on the PDF receipt');
  ok((await O('DELETE', '/api/settings/logo')).d.logo === '', 'logo can be removed');
  // Vercel Blob mode, using a stand-in for the Blob SDK so no real store is touched
  const bp = require.resolve('@vercel/blob'), calls = []; require.cache[bp] = { id: bp, filename: bp, loaded: true, exports: { put: async (pn, body, opt) => { calls.push(['put', pn, opt]); return { url: `https://abc123.public.blob.vercel-storage.com/${pn}` }; }, del: async (u, opt) => { calls.push(['del', u, opt]); } } };
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
  const b1 = await upl(O, 'POST', `/api/products/${p1}/image`, PNG); const put1 = calls.find(c => c[0] === 'put');
  ok(b1.s === 200 && /^https:\/\/abc123\.public\.blob\.vercel-storage\.com\/products\//.test(b1.d.image_url), 'with BLOB_READ_WRITE_TOKEN set, photos go to Vercel Blob');
  ok(put1[2].access === 'public' && put1[2].addRandomSuffix === true && put1[2].token === 'vercel_blob_rw_test' && put1[2].contentType === 'image/png', 'Blob put() called with public access, random suffix, token and real content type');
  await upl(O, 'POST', `/api/products/${p1}/image`, PNG); ok(calls.some(c => c[0] === 'del' && c[1] === b1.d.image_url), 'replaced photo is deleted from Blob');
  await O('DELETE', `/api/products/${p1}/image`); ok(calls.filter(c => c[0] === 'del').length === 2, 'removed photo is deleted from Blob');
  delete process.env.BLOB_READ_WRITE_TOKEN; delete require.cache[bp];
  ok(Array.isArray((await O('GET', '/api/errors')).d) && (await M('GET', '/api/errors')).s === 403, 'only the owner can read the server error log');
  console.log('Cancel, logs, deactivation, backup');
  ok((await O('POST', `/api/orders/${o1.d.id}/cancel`, { reason: 'Customer returned' })).s === 200, 'owner cancels order');
  ok(Math.abs((await D().get('SELECT stock FROM products WHERE id=@id', { id: p1 })).stock - 49) < 1e-9, 'stock restored on cancel');
  ok((await D().get('SELECT size FROM order_pdfs WHERE order_id=@id', { id: o1.d.id })).size !== buf.length, 'stored PDF re-issued with CANCELLED stamp');
  ok((await O('GET', '/api/reports/summary')).d.cards.today.orders === 1, 'cancelled order excluded from sales');
  const logs = (await O('GET', '/api/logs')).d.map(l => l.action); ok(['login', 'order.create', 'order.cancel', 'user.create', 'discount.applied'].every(a => logs.includes(a)), 'activity log recorded logins, orders, cancel, user creation, discounts');
  await O('PATCH', `/api/products/${p1}`, { price: 1300 }); ok((await O('GET', '/api/logs?q=price')).d.some(l => l.action === 'product.price'), 'price change logged');
  ok((await M('PATCH', `/api/users/${emp.d.id}`, { active: false })).s === 200, 'manager deactivates employee'); ok((await E('GET', '/api/me')).s === 401, 'deactivated employee is locked out immediately');
  const ex = await O('GET', '/api/export', null, true), dump = JSON.parse(await ex.text()); ok(dump.orders.length === 2 && dump.products.length === 2 && !JSON.stringify(dump).includes('password_hash'), 'owner can export all data (no password hashes)');
  ok((await M('GET', '/api/export', null, true)).status === 403, 'manager cannot export the database');
  console.log('Invoice design settings');
  const st2 = await O('PATCH', '/api/settings', { business_email: 'info@thejaa.lk', bank_details: 'Bank: BOC\nAccount: 123456' }); ok(st2.d.business_email === 'info@thejaa.lk' && st2.d.bank_details.includes('\n'), 'owner saves e-mail and bank details for the invoice footer');
  ok((await M('PATCH', '/api/settings', { bank_details: 'x' })).s === 403, 'manager cannot change invoice bank details');
  const o9 = await M('POST', '/api/orders', { client_ref: 'ref-abcdef-009', payment_method: 'cash', items: [{ product_id: p2, qty: 1 }] });
  const inv9 = Buffer.from(await (await O('GET', `/api/orders/${o9.d.id}/pdf`, null, true)).arrayBuffer()); ok(inv9.slice(0, 4).toString() === '%PDF', 'new-design A4 invoice (with bank details + e-mail footer) is generated');
  {
  console.log('Automatic bill discounts');
  const R2 = client(base); ok((await M('POST', '/api/users', { name: 'Rep Two', username: 'rep2', password: 'reppass456', role: 'employee' })).s === 200 && (await R2('POST', '/api/login', { username: 'rep2', password: 'reppass456' })).s === 200, 'second employee created for discount tests');
  const bulk = (await O('POST', '/api/products', { name: 'Bulk item', price: 1000, cost: 700, stock: 500 })).d.id, dsc = (await O('POST', '/api/products', { name: 'Disc item', price: 1000, discount_pct: 10, stock: 500 })).d.id, taxd = (await O('POST', '/api/products', { name: 'Taxed item', price: 1000, tax_pct: 12, stock: 500 })).d.id;
  let n = 0; const sell = (who, items, extra = {}) => who('POST', '/api/orders', { client_ref: 'disc-ref-' + String(++n).padStart(4, '0'), payment_method: 'cash', items, ...extra });
  const near = (a, b) => Math.abs(a - b) < 0.011; const get = async id => (await O('GET', '/api/orders/' + id)).d;
  const pre = await sell(R2, [{ product_id: bulk, qty: 5 }]); ok(near(pre.d.total, 5000) && !pre.d.bill_discount, 'before any rule exists a Rs. 5,000 bill is charged in full')
  ok((await R2('POST', '/api/discount-rules', { min_amount: 5000, percent: 5 })).s === 403, 'employee cannot create discount rules');
  ok((await M('POST', '/api/discount-rules', { min_amount: 5000, percent: 5 })).s === 403, 'manager cannot create discount rules by default');
  ok((await O('POST', '/api/discount-rules', { min_amount: 5000, percent: 0 })).s === 400 && (await O('POST', '/api/discount-rules', { min_amount: 5000, percent: 150 })).s === 400 && (await O('POST', '/api/discount-rules', { min_amount: -1, percent: 5 })).s === 400, 'invalid percent / amount rejected');
  const r5 = await O('POST', '/api/discount-rules', { name: 'Bulk bill 5%', min_amount: 5000, percent: 5 }); ok(r5.s === 200, 'owner creates the rule: Rs. 5,000+ → 5%');
  ok((await R2('GET', '/api/discount-rules')).d.length === 1, 'cashiers can read the active rules (to show the preview)');
  const a1 = await sell(R2, [{ product_id: bulk, qty: 4 }]); ok(near(a1.d.total, 4000) && !a1.d.bill_discount, 'Rs. 4,000 bill: no discount');
  const a2 = await sell(R2, [{ product_id: bulk, qty: 5 }]); ok(near(a2.d.total, 4750) && near(a2.d.bill_discount, 250), 'exactly Rs. 5,000: 5% discount applied automatically → Rs. 4,750');
  const ord2 = await get(a2.d.id); ok(ord2.bill_discount_pct === 5 && near(ord2.bill_discount_amt, 250) && ord2.bill_discount_name === 'Bulk bill 5%' && near(ord2.discount_total, 250), 'discount stored on the order (rule name, %, amount)');
  const a3 = await sell(R2, [{ product_id: dsc, qty: 5 }]); ok(near(a3.d.total, 4500) && !a3.d.bill_discount, 'threshold is judged AFTER product discounts (5 × 900 = 4,500 → no bill discount)');
  const a4 = await sell(R2, [{ product_id: dsc, qty: 6 }]); ok(near(a4.d.total, 5130) && near(a4.d.bill_discount, 270) && near((await get(a4.d.id)).discount_total, 870), '6 × 900 = 5,400 → 5% (270) on top of the product discount (600)');
  const a5 = await sell(R2, [{ product_id: taxd, qty: 6 }]); ok(near(a5.d.total, 6384) && near(a5.d.bill_discount, 300), 'with 12% tax: discount reduces tax too (6,000 − 300 + 684 = 6,384)');
  const a6 = await sell(R2, [{ product_id: bulk, qty: 6 }, { product_id: bulk, qty: 2, is_return: true }]); ok(near(a6.d.total, 4000) && !a6.d.bill_discount, 'returns reduce the bill before the threshold is checked');
  const r10 = await O('POST', '/api/discount-rules', { min_amount: 10000, percent: 8 }); const a7 = await sell(R2, [{ product_id: bulk, qty: 12 }]); ok(near(a7.d.bill_discount, 960) && near(a7.d.total, 11040), 'two tiers: Rs. 12,000 gets the best rule only (8%, not 13%)');
  await O('PATCH', '/api/discount-rules/' + r10.d.id, { active: false }); const a8 = await sell(R2, [{ product_id: bulk, qty: 12 }]); ok(near(a8.d.bill_discount, 600) && near(a8.d.total, 11400), 'a disabled rule is ignored (falls back to 5%)');
  const a9 = await sell(R2, [{ product_id: bulk, qty: 6 }], { skip_bill_discount: true }); ok(near(a9.d.bill_discount, 300), 'employee without discount permission cannot waive the discount');
  const a10 = await sell(M, [{ product_id: bulk, qty: 6 }], { skip_bill_discount: true }); ok(near(a10.d.total, 6000) && !a10.d.bill_discount, 'manager (with discount permission) can waive it for one bill');
  const dsold = await sell(R2, [{ product_id: bulk, qty: 6 }]); const dup2 = await R2('POST', '/api/orders', { client_ref: 'disc-ref-' + String(n).padStart(4, '0'), payment_method: 'cash', items: [{ product_id: bulk, qty: 6 }] }); ok(dup2.d.duplicate === true && dup2.d.id === dsold.d.id, 'a repeated tap on a discounted order still returns the same invoice');
  const pdf = Buffer.from(await (await O('GET', `/api/orders/${a2.d.id}/pdf`, null, true)).arrayBuffer()), th = Buffer.from(await (await O('GET', `/api/orders/${a2.d.id}/pdf?format=thermal`, null, true)).arrayBuffer()); ok(pdf.slice(0, 4).toString() === '%PDF' && th.slice(0, 4).toString() === '%PDF', 'A4 invoice and 57mm receipt generate for a discounted order');
  const sm = (await O('GET', '/api/reports/summary')).d, dbSum = (await D().get('SELECT COALESCE(SUM(bill_discount_amt),0) v FROM orders WHERE status=\'completed\'')).v; ok(near(sm.range_stats.bill_discounts, dbSum) && dbSum > 1500 && sm.range_stats.discounts >= dbSum, 'reports show total bill discounts (' + dbSum + ') inside total discounts');
  const lg2 = (await O('GET', '/api/logs')).d.map(l => l.action); ok(['discount_rule.create', 'discount.bill', 'discount.waived'].every(x => lg2.includes(x)), 'rule changes, applied discounts and waivers are in the activity log');
  ok((await O('DELETE', '/api/discount-rules/' + r5.d.id)).s === 200 && (await O('DELETE', '/api/discount-rules/' + r10.d.id)).s === 200, 'owner deletes the rules');
  const a11 = await sell(R2, [{ product_id: bulk, qty: 6 }]); ok(!a11.d.bill_discount && near((await get(a2.d.id)).bill_discount_amt, 250), 'after deleting rules: no discount on new bills; old invoices keep theirs');
  }
  console.log('Routes & permanent delete');
  {
    const R3 = client(base); const names = async who => (await who('GET', '/api/customers')).d.map(c => c.name).sort();
    const rA = (await O('POST', '/api/routes', { name: 'Anuradhapura' })).d.id, rB = (await O('POST', '/api/routes', { name: 'Kurunegala' })).d.id;
    ok(rA && rB, 'owner creates routes (Anuradhapura, Kurunegala)');
    ok((await O('POST', '/api/routes', { name: 'anuradhapura' })).s === 409, 'duplicate route name rejected (case-insensitive)');
    const rC = await M('POST', '/api/routes', { name: 'Temp route' }); ok(rC.s === 200, 'manager can manage routes by default');
    ok((await M('DELETE', '/api/routes/' + rC.d.id)).s === 200, 'an unused route can be deleted');
    const abc = (await O('POST', '/api/customers', { name: 'ABC Shop', route_id: rA })).d.id, xyz = (await O('POST', '/api/customers', { name: 'XYZ Stores', route_id: rB })).d.id, free = (await O('POST', '/api/customers', { name: 'No Route Shop' })).d.id;
    const u3 = await M('POST', '/api/users', { name: 'Rep Three', username: 'rep3', password: 'reppass789', role: 'employee', route_id: rA }); ok(u3.s === 200 && u3.d.route_id === rA, 'manager creates an employee assigned to the Anuradhapura route');
    ok((await R3('POST', '/api/login', { username: 'rep3', password: 'reppass789' })).s === 200 && (await R3('GET', '/api/me')).d.user.route_name === 'Anuradhapura', 'employee signs in and /me shows their route');
    ok((await R3('POST', '/api/routes', { name: 'Hack' })).s === 403, 'employee cannot create routes');
    ok(JSON.stringify(await names(R3)) === JSON.stringify(['ABC Shop']), 'employee on the Anuradhapura route sees ONLY ABC Shop (server-filtered)');
    ok((await names(O)).includes('XYZ Stores') && (await names(O)).includes('No Route Shop') && (await names(M)).length >= 3, 'owner and manager (no route) still see every customer');
    ok((await M('PATCH', '/api/users/' + u3.d.id, { route_id: 987654 })).s === 400, 'assigning a route that does not exist is rejected');
    const rp = (await O('POST', '/api/products', { name: 'Route item', price: 100, stock: 100 })).d.id; let k = 0; const sell = (who, cid) => who('POST', '/api/orders', { client_ref: 'route-ref-' + String(++k).padStart(4, '0'), payment_method: 'cash', customer_id: cid, items: [{ product_id: rp, qty: 1 }] });
    ok((await sell(R3, abc)).s === 200, 'employee can bill a shop on their own route');
    const bad1 = await sell(R3, xyz); ok(bad1.s === 403 && /not on your route/.test(bad1.d.error), 'employee cannot bill a shop on another route (403)');
    ok((await sell(R3, null)).s === 200, 'walk-in sales still work');
    const nc = (await R3('POST', '/api/customers', { name: 'New Route Shop', route_id: rB })).d.id; ok((await O('GET', '/api/customers')).d.find(c => c.id === nc).route_id === rA, 'a shop added by a routed employee joins THEIR route automatically');
    ok((await R3('POST', '/api/customers/assign-route', { ids: [free], route_id: rA })).s === 403, 'employee cannot reassign shops');
    ok((await M('POST', '/api/customers/assign-route', { ids: [free], route_id: 424242 })).s === 400, 'bulk assign to a bad route rejected');
    ok((await M('POST', '/api/customers/assign-route', { ids: [free, xyz], route_id: rA })).d.updated === 2, 'manager bulk-assigns two shops to a route');
    ok(JSON.stringify(await names(R3)) === JSON.stringify(['ABC Shop', 'New Route Shop', 'No Route Shop', 'XYZ Stores']), 'the employee’s list updates automatically with the newly assigned shops');
    await M('PATCH', '/api/users/' + u3.d.id, { route_id: rB }); ok(JSON.stringify(await names(R3)) === '[]', 'moving the employee to a route with no shops empties their list');
    await M('PATCH', '/api/users/' + u3.d.id, { route_id: null }); ok((await names(R3)).length >= 5, 'removing the route shows all customers again');
    await M('PATCH', '/api/users/' + u3.d.id, { route_id: rA });
    ok((await O('DELETE', '/api/routes/' + rA)).s === 409, 'a route that still has shops/employees cannot be deleted');
    // ----- permanent delete of cancelled orders
    const o1 = (await sell(R3, null)).d, o2 = (await sell(R3, null)).d, o3 = (await sell(R3, null)).d, o4 = (await sell(R3, null)).d;
    await O('POST', `/api/orders/${o1.id}/cancel`, { reason: 'test 1' }); await O('POST', `/api/orders/${o2.id}/cancel`, { reason: 'test 2' }); await O('POST', `/api/orders/${o3.id}/cancel`, { reason: 'test 3' });
    const stock0 = (await D().get('SELECT stock FROM products WHERE id=@i', { i: rp })).stock, poll0 = (await O('GET', '/api/poll')).d.last;
    ok((await R3('POST', '/api/orders/bulk-delete', { ids: [o1.id] })).s === 403, 'employee cannot delete orders');
    ok((await M('POST', '/api/orders/bulk-delete', { ids: [o1.id] })).s === 403, 'manager cannot delete orders by default');
    const live = await O('POST', '/api/orders/bulk-delete', { ids: [o4.id] }); ok(live.s === 409 && live.d.error.includes(o4.invoice_no), 'a COMPLETED order cannot be deleted (cancel it first)');
    ok((await O('POST', '/api/orders/bulk-delete', { ids: [o1.id, o4.id] })).s === 409 && (await O('GET', '/api/orders/' + o1.id)).s === 200, 'a mixed selection is refused as a whole — nothing is deleted');
    ok((await O('POST', '/api/orders/bulk-delete', { ids: [] })).s === 400 && (await O('POST', '/api/orders/bulk-delete', { ids: [987654] })).s === 404, 'empty / unknown selections rejected');
    const del = await O('POST', '/api/orders/bulk-delete', { ids: [o1.id, o2.id] }); ok(del.s === 200 && del.d.deleted === 2, 'owner permanently deletes two cancelled orders at once (checkbox bulk delete)');
    ok((await O('GET', '/api/orders/' + o1.id)).s === 404 && (await O('GET', `/api/orders/${o2.id}/pdf`, null, true)).status === 404, 'deleted orders and their PDFs are gone');
    ok((await D().get('SELECT COUNT(*)::int n FROM order_items WHERE order_id=ANY(@i)', { i: [o1.id, o2.id] })).n === 0 && (await D().get('SELECT COUNT(*)::int n FROM order_pdfs WHERE order_id=ANY(@i)', { i: [o1.id, o2.id] })).n === 0, 'their items and stored PDFs are erased from the database');
    ok((await D().get('SELECT stock FROM products WHERE id=@i', { i: rp })).stock === stock0, 'deleting does not touch stock (it was restored when the order was cancelled)');
    ok((await O('GET', '/api/orders?status=completed')).d.some(o => o.id === o4.id), 'other orders are untouched');
    ok((await O('GET', '/api/logs?q=order.delete')).d.filter(l => l.action === 'order.delete').length === 2, 'each deletion leaves a record in the activity log');
    ok((await O('GET', '/api/poll?since=' + poll0)).d.events.some(e => e.type === 'order' && e.data.event === 'deleted' && e.data.count === 2), 'other screens are told to refresh');
    const perms = (await O('GET', '/api/users')).d.defaults.manager.concat(['orders.delete']); ok((await O('PATCH', '/api/users/' + mgr.d.id, { permissions: perms })).s === 200 && (await M('POST', '/api/orders/bulk-delete', { ids: [o3.id] })).d.deleted === 1, 'owner can grant a manager the delete permission');
  }
  console.log('Returns / credit notes');
  {
    const near = (a, b) => Math.abs(a - b) < 0.011; let k = 0; const ref = p => p + '-' + String(++k).padStart(5, '0');
    const wp = (await O('POST', '/api/products', { name: 'Watalappan', price: 150, cost: 90, stock: 100 })).d.id, stockOf = async id => (await D().get('SELECT stock FROM products WHERE id=@i', { i: id })).stock;
    const shop = (await O('POST', '/api/customers', { name: 'Return Shop', phone: '0771112222' })).d.id;
    const sell = (who, items, extra = {}) => who('POST', '/api/orders', { client_ref: ref('ret-sale'), payment_method: 'cash', items, ...extra });
    const items = async id => (await O('GET', '/api/orders/' + id)).d.items; const ret = (who, orderId, lines, extra = {}) => who('POST', '/api/returns', { client_ref: ref('ret-ret'), order_id: orderId, refund_method: 'cash', items: lines, ...extra });
    // --- the situation from the shop: billed 20 Watalappan, only 10 come back
    const a = (await sell(O, [{ product_id: wp, qty: 20 }], { customer_id: shop })).d, aItem = (await items(a.id))[0].id; ok(near(a.total, 3000) && near(await stockOf(wp), 80), 'billed 20 Watalappan (Rs. 3,000), stock 100 → 80');
    const oldWay = await sell(O, [{ product_id: wp, qty: 10, is_return: true }]); ok(oldWay.s === 400 && /Orders/.test(oldWay.d.error) && /Return/.test(oldWay.d.error), 'a bill containing only returns now tells you where to record a return');
    const rb = (await O('GET', `/api/orders/${a.id}/returnable`)).d; ok(rb.items[0].sold === 20 && rb.items[0].returned === 0 && rb.items[0].remaining === 20 && near(rb.items[0].unit_refund, 150), 'the return screen shows: billed 20, returned 0, can return 20');
    const r1 = await ret(O, a.id, [{ order_item_id: aItem, qty: 10 }]); ok(r1.s === 200 && /^RET-\d{6}$/.test(r1.d.return_no) && near(r1.d.total, 1500), 'return 10 of the 20 → credit note ' + r1.d.return_no + ' for Rs. 1,500');
    ok(near(await stockOf(wp), 90), 'the 10 returned go back into stock (80 → 90)');
    const rb2 = (await O('GET', `/api/orders/${a.id}/returnable`)).d.items[0]; ok(rb2.returned === 10 && rb2.remaining === 10, 'afterwards: returned 10, can still return 10');
    const over = await ret(O, a.id, [{ order_item_id: aItem, qty: 20 }]); ok(over.s === 409 && /Only 10/.test(over.d.error), 'trying to return all 20 again is refused: “Only 10 of WATALAPPAN can still be returned”');
    ok((await ret(O, a.id, [{ order_item_id: aItem, qty: 11 }])).s === 409, 'returning 11 when 10 are left is refused');
    ok((await ret(O, a.id, [{ order_item_id: aItem, qty: 10 }])).s === 200 && near(await stockOf(wp), 100), 'returning the remaining 10 works');
    ok((await ret(O, a.id, [{ order_item_id: aItem, qty: 1 }])).s === 409 && near((await D().get("SELECT SUM(total) v FROM sales_returns WHERE order_id=@o AND status='completed'", { o: a.id })).v, 3000), 'nothing more can be returned; the two credit notes add up to exactly Rs. 3,000');
    ok((await ret(O, a.id, [{ order_item_id: aItem, qty: 0 }])).s === 400 && (await ret(O, a.id, [{ order_item_id: aItem, qty: -2 }])).s === 400 && (await ret(O, a.id, [{ order_item_id: 99999999, qty: 1 }])).s === 400, 'zero, negative and unknown items rejected');
    // --- duplicate tap
    const b = (await sell(O, [{ product_id: wp, qty: 6 }])).d, bItem = (await items(b.id))[0].id, fixed = ref('ret-dup'), s1 = await ret(O, b.id, [{ order_item_id: bItem, qty: 2 }], { client_ref: fixed }), s2 = await ret(O, b.id, [{ order_item_id: bItem, qty: 2 }], { client_ref: fixed });
    ok(s2.d.duplicate === true && s2.d.id === s1.d.id && (await O('GET', `/api/orders/${b.id}/returnable`)).d.items[0].returned === 2, 'a double tap records the return once');
    ok((await ret(O, b.id, [{ order_item_id: bItem, qty: 1 }], { refund_method: 'credit_note' })).s === 400, 'credit-to-account needs a customer (walk-in sale refused)');
    // --- nothing is lost by writing off spoiled goods
    const st = await stockOf(wp); ok((await ret(O, b.id, [{ order_item_id: bItem, qty: 1, restock: false }])).s === 200 && near(await stockOf(wp), st), 'goods marked “not restocked” (spoiled) do not return to stock');
    // --- credit sale: a credit note lowers what the customer owes
    const c = (await sell(O, [{ product_id: wp, qty: 20 }], { customer_id: shop, payment_method: 'credit', paid: 0 })).d, cItem = (await items(c.id))[0].id, before = (await O('GET', '/api/customers')).d.find(x => x.id === shop).balance;
    ok(near(before, 3000), 'credit sale of 20: customer owes Rs. 3,000');
    ok((await ret(O, c.id, [{ order_item_id: cItem, qty: 10 }], { refund_method: 'credit_note', reason: 'unsold' })).s === 200 && near((await O('GET', '/api/customers')).d.find(x => x.id === shop).balance, 1500), 'returning 10 as a credit note lowers the balance to Rs. 1,500');
    ok(near((await O('GET', '/api/creditors')).d.find(x => x.id === shop).balance, 1500) && (await O('GET', `/api/customers/${shop}/ledger`)).d.returns.length >= 1, 'creditors list and customer ledger reflect the credit note');
    // --- bill discount: refunds match what was actually paid, and add up exactly
    const rule = (await O('POST', '/api/discount-rules', { name: 'ret5', min_amount: 5000, percent: 5 })).d.id, d1 = (await sell(O, [{ product_id: wp, qty: 40 }])).d, dItem = (await items(d1.id))[0].id; ok(near(d1.total, 5700), '40 × 150 with the 5% bill discount = Rs. 5,700');
    const p1 = await ret(O, d1.id, [{ order_item_id: dItem, qty: 25 }]), p2 = await ret(O, d1.id, [{ order_item_id: dItem, qty: 15 }]); ok(near(p1.d.total, 3562.5) && near(p2.d.total, 2137.5) && near(p1.d.total + p2.d.total, 5700), 'returning 25 then 15 refunds 3,562.50 + 2,137.50 = exactly the Rs. 5,700 paid');
    await O('DELETE', '/api/discount-rules/' + rule);
    // --- permissions
    const rep = await M('POST', '/api/users', { name: 'Rep Nine', username: 'rep9', password: 'reppass999', role: 'employee' }); const R9 = client(base); await R9('POST', '/api/login', { username: 'rep9', password: 'reppass999' });
    const e1 = (await sell(R9, [{ product_id: wp, qty: 4 }])).d, e1Item = (await items(e1.id))[0].id;
    ok((await R9('GET', `/api/orders/${e1.id}/returnable`)).s === 403 && (await ret(R9, e1.id, [{ order_item_id: e1Item, qty: 1 }])).s === 403, 'an employee cannot record returns unless granted');
    ok((await ret(M, e1.id, [{ order_item_id: e1Item, qty: 1 }])).s === 200, 'a manager can (default)');
    await O('PATCH', '/api/users/' + rep.d.id, { permissions: ['pos.sell', 'orders.view_own', 'returns.create'] }); ok((await ret(R9, e1.id, [{ order_item_id: e1Item, qty: 1 }])).s === 200, 'after the owner grants it, the employee can return goods on their OWN invoice');
    ok((await R9('GET', `/api/orders/${a.id}/returnable`)).s === 404 && (await R9('GET', '/api/returns')).d.length >= 2 && (await R9('GET', '/api/returns')).d.every(r => r.invoice_no === e1.invoice_no), 'but not on someone else’s invoice, and their Returns list only shows returns on their own invoices');
    // --- two people at the same moment
    const g = (await sell(M, [{ product_id: wp, qty: 20 }])).d, gItem = (await items(g.id))[0].id; const race = await Promise.all([ret(O, g.id, [{ order_item_id: gItem, qty: 15 }]), ret(M, g.id, [{ order_item_id: gItem, qty: 15 }])]);
    ok(race.filter(x => x.s === 200).length === 1 && race.filter(x => x.s === 409).length === 1, 'two simultaneous returns of 15 on an invoice of 20: exactly one is accepted (cannot over-return)');
    // --- documents, lists, events
    const rid = r1.d.id, pdfA = Buffer.from(await (await O('GET', `/api/returns/${rid}/pdf`, null, true)).arrayBuffer()), pdfT = Buffer.from(await (await O('GET', `/api/returns/${rid}/pdf?format=thermal`, null, true)).arrayBuffer());
    ok(pdfA.slice(0, 4).toString() === '%PDF' && pdfT.slice(0, 4).toString() === '%PDF', 'credit note A4 and 57mm PDFs generate');
    ok((await R9('GET', `/api/returns/${rid}/pdf`, null, true)).status === 404, 'an employee cannot open another person’s credit note');
    ok((await O('GET', '/api/orders')).d.find(x => x.id === a.id).returned === 3000 && (await O('GET', `/api/orders/${a.id}`)).d.returns.length === 2, 'the invoice shows how much has been returned');
    ok((await O('GET', '/api/returns')).d.some(r => r.return_no === r1.d.return_no), 'Returns list shows the credit notes');
    // --- reports are net of returns
    const sm = (await O('GET', '/api/reports/summary')).d, rtot = (await D().get("SELECT COALESCE(SUM(total),0) v FROM sales_returns WHERE status='completed'")).v; ok(near(sm.range_stats.returns_total, rtot) && near(sm.range_stats.revenue, sm.range_stats.gross_sales - rtot) && rtot > 7000, 'reports: revenue = sales − returns (returns Rs. ' + rtot + ')');
    ok(near(sm.cards.today.revenue, sm.range_stats.revenue), "dashboard cards are net of returns too");
    // --- cancelling
    ok((await M('POST', `/api/returns/${p2.d.id}/cancel`, { reason: 'x' })).s === 403, 'manager cannot cancel a return by default');
    const sBefore = await stockOf(wp); ok((await O('POST', `/api/returns/${p2.d.id}/cancel`, { reason: 'entered by mistake' })).s === 200 && near(await stockOf(wp), sBefore - 15) && (await O('GET', `/api/orders/${d1.id}/returnable`)).d.items[0].remaining === 15, 'cancelling a return reverses the stock and makes those goods returnable again');
    ok((await O('POST', `/api/returns/${p2.d.id}/cancel`, { reason: 'again' })).s === 409, 'a return cannot be cancelled twice');
    ok((await O('POST', `/api/orders/${d1.id}/cancel`, { reason: 'x' })).s === 409, 'an invoice that has returns cannot be cancelled');
    await O('POST', `/api/returns/${p1.d.id}/cancel`, { reason: 'undo all' }); ok((await O('POST', `/api/orders/${d1.id}/cancel`, { reason: 'now fine' })).s === 200, '…until its returns are cancelled first');
    ok((await O('POST', '/api/orders/bulk-delete', { ids: [d1.id] })).d.deleted === 1 && (await D().get('SELECT COUNT(*)::int n FROM sales_returns WHERE order_id=@o', { o: d1.id })).n === 0, 'permanently deleting that cancelled invoice also removes its cancelled return records');
  }
  console.log('Manager sees only their own team');
  {
    const M2 = client(base), RB = client(base), RA = client(base); let k = 0; const near = (a, b) => Math.abs(a - b) < 0.011;
    const m2 = await O('POST', '/api/users', { name: 'Manager Two', username: 'mgr2', password: 'managerpass2', role: 'manager' }); await M2('POST', '/api/login', { username: 'mgr2', password: 'managerpass2' });
    const empB = await M2('POST', '/api/users', { name: 'Team B Rep', username: 'teamb', password: 'teamb-pass1', role: 'employee' }); await RB('POST', '/api/login', { username: 'teamb', password: 'teamb-pass1' });
    const empA = await M('POST', '/api/users', { name: 'Team A Rep', username: 'teama', password: 'teama-pass1', role: 'employee' }); await RA('POST', '/api/login', { username: 'teama', password: 'teama-pass1' });
    const prod = (await O('POST', '/api/products', { name: 'Scope item', price: 100, stock: 1000 })).d.id, sell = (who, q) => who('POST', '/api/orders', { client_ref: 'scope-ref-' + String(++k).padStart(4, '0'), payment_method: 'cash', items: [{ product_id: prod, qty: q }] });
    const oOwn = (await sell(O, 1)).d, oA = (await sell(RA, 3)).d, oM = (await sell(M, 2)).d, oM2 = (await sell(M2, 4)).d, oB = (await sell(RB, 5)).d;
    const teamA = [mgr.d.id, ...(await D().all('SELECT id FROM users WHERE created_by=@m', { m: mgr.d.id })).map(r => r.id)], dbGross = (await D().get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status='completed' AND user_id=ANY(@t)", { t: teamA })).v;
    const sOwner = (await O('GET', '/api/reports/summary')).d, sM = (await M('GET', '/api/reports/summary')).d, sM2 = (await M2('GET', '/api/reports/summary')).d;
    ok(sOwner.scope === 'all' && sM.scope === 'team' && sM2.scope === 'team', 'reports tell the manager they are looking at their team only');
    ok(near(sM2.range_stats.gross_sales, 900) && sM2.range_stats.orders === 2, 'Manager Two’s report = own sales (Rs. 400) + the employee they added (Rs. 500) = Rs. 900, nothing else');
    ok(near(sM.range_stats.gross_sales, dbGross) && sM.range_stats.gross_sales < sOwner.range_stats.gross_sales - 1000, 'the first manager’s report matches exactly their team’s sales and excludes the owner and the other manager’s team');
    ok(near(sOwner.range_stats.gross_sales, (await D().get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status='completed'")).v), 'the owner still sees every sale');
    ok(sM2.employees.every(e => [m2.d.id, empB.d.id].includes(e.id)) && sM2.cards.today.orders === 2, 'employee ranking and the “today” card are limited to the team too');
    const ids = async who => [...new Set((await who('GET', '/api/orders?limit=500')).d.map(o => o.employee))].sort();
    ok(JSON.stringify(await ids(M2)) === JSON.stringify(['Manager Two', 'Team B Rep']), 'Manager Two’s Orders list shows only their own team');
    ok(!(await ids(M)).includes('Team B Rep') && !(await ids(M)).includes('Manager Two') && (await ids(M)).includes('Team A Rep'), 'the other manager’s Orders list excludes that team but includes their own employee');
    ok((await M('GET', '/api/orders/' + oB.id)).s === 404 && (await M('GET', `/api/orders/${oM2.id}/pdf`, null, true)).status === 404 && (await M2('GET', '/api/orders/' + oA.id)).s === 404, 'a manager cannot open another team’s invoice or PDF');
    ok((await M('GET', '/api/orders/' + oA.id)).s === 200 && (await O('GET', '/api/orders/' + oB.id)).s === 200, 'but can open their employee’s invoice (owner can open any)');
    ok((await M('GET', '/api/users')).d.users.every(u => teamA.includes(u.id) || u.created_by === mgr.d.id || u.id === empA.d.id) && !(await M('GET', '/api/users')).d.users.some(u => u.id === empB.d.id), 'a manager’s Users list contains only the employees they added');
    ok((await M('PATCH', '/api/users/' + empB.d.id, { name: 'Hacked' })).s === 403 && (await M2('PATCH', '/api/users/' + empB.d.id, { name: 'Team B Renamed' })).s === 200, 'a manager cannot edit another manager’s employee, but can edit their own');
    ok((await M2('POST', '/api/users', { name: 'X', username: 'mgrx', password: 'managerpass3', role: 'manager' })).s === 403, 'a manager cannot create other managers');
    ok((await M2('GET', '/api/reports/export?type=xlsx', null, true)).status === 200, 'the manager’s Excel export works (team only)');
    ok((await M2('GET', '/api/logs')).d.every(l => [m2.d.id, empB.d.id].includes(l.user_id)), 'the manager’s Activity Log only shows their team’s actions');
    ok((await M('POST', `/api/orders/${oB.id}/cancel`, { reason: 'x' })).s === 403 || (await M('POST', `/api/orders/${oB.id}/cancel`, { reason: 'x' })).s === 404, 'a manager cannot cancel another team’s order');
  }
  srv.close(); console.log(`\nAll ${pass} checks passed.`); process.exit(0);
})().catch(e => { console.error('\n✗ FAILED:', e.message, '\n', e.stack.split('\n').slice(1, 3).join('\n')); process.exit(1); });
function D() { return app._db(); }
