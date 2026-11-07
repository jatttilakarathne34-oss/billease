'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = n => 'Rs. ' + money(n), qn = n => String(Math.round(n * 1000) / 1000);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const ldate = s => new Date(s).toLocaleString();
const S = { me: null, perms: [], cfg: {}, products: [], cart: [], ref: null, pay: { method: 'cash', paid: '', note: '', customer: '' }, charts: {}, view: '', cust: [] };
const can = (...p) => p.some(x => S.perms.includes(x));
const PL = { 'pos.sell': 'Use billing / POS', 'pos.discount': 'Change discounts at billing', 'orders.view_all': 'View all orders', 'orders.view_own': 'View own orders', 'orders.cancel': 'Cancel orders', 'products.view': 'View products page', 'products.manage': 'Add / edit / archive products', 'inventory.manage': 'Adjust stock', 'customers.manage': 'Manage customers', 'creditors.manage': 'Manage creditors & payments', 'reports.view': 'View reports & dashboard', 'reports.export': 'Export reports', 'users.manage': 'Manage users', 'logs.view': 'View activity log' };

async function api(path, o = {}) {
  const r = await fetch('/api' + path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF': '1' }, body: o.body ? JSON.stringify(o.body) : undefined, credentials: 'same-origin' });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) { if (r.status === 401 && S.me && path !== '/login') { S.me = null; stopPolling(); boot(); } throw new Error(d.error || 'Request failed'); }
  return d;
}
function toast(msg, type = '', link) { const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = esc(msg) + (link ? `<br><a href="${esc(link.href)}" target="_blank">${esc(link.text)}</a>` : ''); $('#toasts').append(t); setTimeout(() => t.remove(), link ? 9000 : 3500); }
function modal(html, wide) { closeModal(); const o = document.createElement('div'); o.className = 'ov'; o.innerHTML = `<div class="md ${wide ? 'wide' : ''}">${html}</div>`; o.addEventListener('mousedown', e => { if (e.target === o) closeModal(); }); $('#modal-host').append(o); return o; }
const closeModal = () => { $('#modal-host').innerHTML = ''; };
const guard = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; } };
// Image upload: shrink in the browser first (fast on phones, well under Vercel's 4.5 MB request limit), then send the raw file.
async function shrink(file, max, type) { const bm = await createImageBitmap(file), k = Math.min(1, max / Math.max(bm.width, bm.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k)); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); return new Promise(r => c.toBlob(r, type, 0.85)); }
async function upload(path, blob) { const r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': blob.type, 'X-CSRF': '1' }, body: blob, credentials: 'same-origin' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }
const thumb = (u, n = 36) => u ? `<img src="${esc(u)}" alt="" loading="lazy" style="width:${n}px;height:${n}px;object-fit:cover;border-radius:7px;flex:none">` : '';
const dl = (id, f) => `/api/orders/${id}/pdf${f ? '?format=' + f : ''}`;

// ───────── boot / auth ─────────
async function boot() {
  let st; try { const r = await fetch('/api/status'); st = await r.json().catch(() => ({})); if (!r.ok) return fatalScreen(st.error || 'The server returned an error (' + r.status + ').'); } catch { return fatalScreen('Cannot reach the server. Check your internet connection.'); }
  if (st.needsSetup) return authScreen(st, true);
  try { const m = await api('/me'); S.me = m.user; S.perms = m.perms; S.cfg = m.settings; shell(); }
  catch { authScreen(st, false); }
}
function fatalScreen(msg) {
  $('#root').innerHTML = `<div class="auth"><div class="box"><h1>BillEase can't start</h1><p class="mut" style="margin:8px 0 16px">The app is online but is not working yet.</p><div class="err">${esc(msg)}</div><button class="btn pri" style="width:100%" onclick="location.reload()">Try again</button></div></div>`;
}
function authScreen(st, setup) {
  $('#root').innerHTML = `<div class="auth"><form class="box" id="af">${st.logo ? `<img class="logo" src="${esc(st.logo)}">` : ''}<h1>${esc(st.business || 'BillEase')}</h1>
  <p class="mut" style="margin-bottom:18px">${setup ? 'First-time setup — create the Owner account' : 'Sign in to continue'}</p><div id="ae"></div>
  ${setup ? '<div class="f"><label>Business name</label><input name="business" value="' + esc(st.business || '') + '"></div><div class="f"><label>Your full name</label><input name="name" required></div>' : ''}
  <div class="f"><label>Username</label><input name="username" autocomplete="username" required autofocus></div>
  <div class="f"><label>Password ${setup ? '(min 8 characters)' : ''}</label><input type="password" name="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></div>
  <button class="btn pri" style="width:100%">${setup ? 'Create Owner & Start' : 'Sign In'}</button></form></div>`;
  $('#af').onsubmit = async e => {
    e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)), btn = $('button', e.target); btn.disabled = true;
    try { if (setup) await api('/setup', { method: 'POST', body: b }); await api('/login', { method: 'POST', body: { username: b.username, password: b.password } }); boot(); }
    catch (er) { $('#ae').innerHTML = `<div class="err">${esc(er.message)}</div>`; btn.disabled = false; }
  };
}

// ───────── shell & router ─────────
const NAV = [['dashboard', '📊', 'Dashboard', ['reports.view']], ['pos', '🧾', 'Billing', ['pos.sell']], ['orders', '📋', 'Orders', ['orders.view_all', 'orders.view_own']], ['products', '📦', 'Products', ['products.view']], ['stock', '🏷️', 'Stock', ['inventory.manage']],
  ['customers', '👥', 'Customers', ['customers.manage']], ['creditors', '💳', 'Creditors', ['creditors.manage']], ['reports', '📈', 'Reports', ['reports.view']], ['users', '🔐', 'Users', ['users.manage']], ['logs', '🕘', 'Activity Log', ['logs.view']], ['settings', '⚙️', 'Settings', ['OWNER']]];
const allowed = n => n[3][0] === 'OWNER' ? S.me.role === 'owner' : can(...n[3]);
function shell() {
  const nav = NAV.filter(allowed); const role = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }[S.me.role];
  $('#root').innerHTML = `<div class="top"><button id="mb">☰</button><span>${esc(S.cfg.business_name)}</span><span class="sp"></span><span class="live" id="lv2"></span></div>
  <div class="shell"><aside class="side" id="side"><div class="brand">${S.cfg.logo ? `<img src="${esc(S.cfg.logo)}">` : '🧾'}<span>${esc(S.cfg.business_name)}</span></div>
  <nav class="nav">${nav.map(n => `<a href="#/${n[0]}" data-v="${n[0]}"><span>${n[1]}</span>${n[2]}</a>`).join('')}</nav>
  <div class="me"><b><span class="live" id="lv"></span>${esc(S.me.name)}</b>${role} · <a href="#" id="pw" style="color:#93c5fd">Password</a> · <a href="#" id="lo" style="color:#fca5a5">Sign out</a></div></aside>
  <main class="main" id="main"></main></div>`;
  $('#mb').onclick = () => $('#side').classList.toggle('open');
  $('#side').onclick = e => { if (e.target.closest('a[data-v]')) $('#side').classList.remove('open'); };
  $('#lo').onclick = async e => { e.preventDefault(); await api('/logout', { method: 'POST' }).catch(() => {}); stopPolling(); S.me = null; location.hash = ''; boot(); };
  $('#pw').onclick = e => { e.preventDefault(); pwModal(); };
  window.onhashchange = route; startPolling(); S.cart = []; S.ref = null; S.pay = { method: 'cash', paid: '', note: '', customer: '' }; loadCart(); route();
}
function route() {
  if (!S.me) return; let v = location.hash.replace('#/', '') || ''; const ok = NAV.filter(allowed).map(n => n[0]);
  if (!ok.includes(v)) { v = can('reports.view') && can('orders.view_all') ? 'dashboard' : (ok.includes('pos') ? 'pos' : ok[0]); location.hash = '#/' + v; return; }
  S.view = v; $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {};
  const F = { dashboard: vDashboard, pos: vPos, orders: vOrders, products: vProducts, stock: vStock, customers: vCustomers, creditors: vCreditors, reports: vReports, users: vUsers, logs: vLogs, settings: vSettings }[v];
  $('#main').innerHTML = '<p class="mut">Loading…</p>'; Promise.resolve(F()).catch(e => { $('#main').innerHTML = `<div class="err">${esc(e.message)}</div>`; });
}
const head = (t, s, extra = '') => `<div class="row" style="margin-bottom:16px"><div class="sp"><div class="title">${t}</div><div class="mut">${s || ''}</div></div>${extra}</div>`;
function pwModal() {
  const o = modal(`<h3>Change password</h3><div class="f"><label>Current password</label><input type="password" id="p0"></div><div class="f"><label>New password (min 8)</label><input type="password" id="p1"></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="ps">Save</button></div>`);
  $('#ps', o).onclick = e => guard(e.target, async () => { await api('/me/password', { method: 'PATCH', body: { current: $('#p0').value, password: $('#p1').value } }); closeModal(); toast('Password changed', 'ok'); });
}

// ───────── realtime (short polling — works on serverless hosting such as Vercel) ─────────
let pollT = null, pollLast = null, pollOn = false;
const onVis = () => { if (!document.hidden && pollOn) { clearTimeout(pollT); pollTick(); } };
function startPolling() { stopPolling(); pollOn = true; pollLast = null; document.addEventListener('visibilitychange', onVis); pollTick(); }
function stopPolling() { pollOn = false; clearTimeout(pollT); document.removeEventListener('visibilitychange', onVis); }
async function pollTick() {
  if (!pollOn) return; const dot = v => $$('#lv,#lv2').forEach(d => d.classList.toggle('off', !v));
  if (!document.hidden) { try { const d = await api('/poll' + (pollLast === null ? '' : '?since=' + pollLast)); dot(true); if (pollLast !== null) d.events.forEach(handleEvent); pollLast = d.last; } catch { dot(false); } }
  if (pollOn) pollT = setTimeout(pollTick, can('orders.view_all') ? 4000 : 15000);
}
async function handleEvent(e) {
  const d = e.data;
  if (e.type === 'order') {
    if (d.event === 'created' && d.employee !== S.me.name) {
      const link = can('orders.view_all', 'orders.view_own') ? { href: dl(d.id), text: 'Open invoice PDF' } : null;
      toast(`New order ${d.invoice_no} — ${rs(d.total)} by ${d.employee}`, 'ok', link);
      if (link && localStorage.autoPdf === '1') setTimeout(() => window.open(dl(d.id), '_blank'), 1200);
    } else if (d.event === 'cancelled') toast(`Order ${d.invoice_no} was cancelled`);
    if (['dashboard', 'orders'].includes(S.view)) route();
  } else if (e.type === 'product') { if (S.view === 'pos') { await loadProducts(); renderList(); } else if (['products', 'stock'].includes(S.view)) route(); }
  else if (e.type === 'payment' && ['creditors', 'customers'].includes(S.view)) route();
}

// ───────── charts / cards ─────────
function chart(id, cfg) { const el = document.getElementById(id); if (!el) return; if (S.charts[id]) S.charts[id].destroy(); cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {}); S.charts[id] = new Chart(el, cfg); }
const stat = (l, v, s = '') => `<div class="stat"><small>${l}</small><b class="mono">${v}</b><span>${s}</span></div>`;
function cards(d) {
  const c = d.cards, o = x => `${x.orders} orders`;
  return `<div class="grid g5" style="margin-bottom:14px">${stat('Today', rs(c.today.revenue), o(c.today))}${stat('Yesterday', rs(c.yesterday.revenue), o(c.yesterday))}${stat('Last 7 days', rs(c.week.revenue), o(c.week))}${stat('This month', rs(c.month.revenue), o(c.month))}${stat('This year', rs(c.year.revenue), o(c.year))}</div>`;
}
const palette = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#64748b'];
async function vDashboard() {
  const d = await api('/reports/summary'), r = d.range_stats;
  $('#main').innerHTML = head('Dashboard', 'Live business overview — updates automatically when orders arrive', can('orders.view_all') ? `<label class="row" style="margin:0;font-size:13px;color:var(--ink)"><input type="checkbox" id="ap" style="width:auto;min-height:0" ${localStorage.autoPdf === '1' ? 'checked' : ''}> Auto-open invoice PDF for new orders</label>` : '') + cards(d) +
    `<div class="grid g5" style="margin-bottom:14px">${stat('Orders (30 days)', r.orders)}${stat('Avg order value', rs(r.avg_order))}${stat('Discounts (30 days)', rs(r.discounts))}${stat('Outstanding credit', rs(d.outstanding))}${stat('Unpaid / partial', r.unpaid_orders, 'last 30 days')}</div>
    <div class="grid g2"><div class="card"><h3>Sales — last 30 days</h3><div class="chartbox"><canvas id="c1"></canvas></div></div><div class="card"><h3>Recent orders <span class="live"></span></h3><div class="tw"><table id="ro"></table></div></div></div>`;
  const ap = $('#ap'); if (ap) ap.onchange = () => { localStorage.autoPdf = ap.checked ? '1' : '0'; };
  chart('c1', { type: 'bar', data: { labels: d.series.day.map(s => s.label.slice(5)), datasets: [{ label: 'Revenue', data: d.series.day.map(s => s.revenue), backgroundColor: '#2563eb', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  const os = await api('/orders?limit=10').catch(() => []); $('#ro').innerHTML = '<tr><th>Invoice</th><th>By</th><th class="r">Total</th><th></th></tr>' + os.map(o => `<tr><td><b>${o.invoice_no}</b><br><span class="mut">${ldate(o.created_at)}</span></td><td>${esc(o.employee)}</td><td class="r mono">${money(o.total)}</td><td><a class="btn sm" target="_blank" href="${dl(o.id)}">PDF</a></td></tr>`).join('') || '<tr><td class="mut">No orders yet</td></tr>';
}

// ───────── POS ─────────
const saveCart = () => localStorage.setItem('cart_' + S.me.id, JSON.stringify({ cart: S.cart, ref: S.ref, pay: S.pay }));
function loadCart() { try { const x = JSON.parse(localStorage['cart_' + S.me.id] || 'null'); if (x) { S.cart = x.cart || []; S.ref = x.ref; S.pay = x.pay || S.pay; } } catch {} }
async function loadProducts() { S.products = await api('/products'); }
async function vPos() {
  await Promise.all([loadProducts(), api('/customers').then(c => S.cust = c).catch(() => S.cust = [])]);
  $('#main').innerHTML = `<div class="pos"><section><div class="row" style="margin-bottom:12px"><input id="ps" placeholder="🔍 Search product name or SKU…" autocomplete="off" style="flex:1"><span class="mut" id="mys"></span></div><div class="plist" id="pl"></div></section><aside class="cartpane" id="cp"></aside></div><button class="cartbar" id="cb"></button>`;
  $('#ps').oninput = renderList; $('#cb').onclick = () => $('#cp').classList.toggle('open');
  api('/me/stats').then(s => { const e = $('#mys'); if (e) e.textContent = `My sales today: ${rs(s.revenue)} (${s.orders})`; }).catch(() => {});
  renderList(); renderCart();
}
function renderList() {
  const el = $('#pl'); if (!el) return; const q = ($('#ps').value || '').toLowerCase();
  const l = S.products.filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 150);
  el.innerHTML = l.map(p => `<div class="prod ${p.stock <= 0 ? 'out' : ''}" data-id="${p.id}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" style="width:100%;height:70px;object-fit:cover;border-radius:8px">` : ''}<b>${esc(p.name)}</b>${p.discount_pct ? `<span class="badge ok">${qn(p.discount_pct)}% off</span>` : ''}<div class="pr"><strong>${money(p.price)}</strong><span class="mut">Stock ${qn(p.stock)}</span></div></div>`).join('') || '<p class="mut">No products found.</p>';
  $$('.prod', el).forEach(e => e.onclick = () => addToCart(+e.dataset.id));
}
function addToCart(id) {
  const p = S.products.find(x => x.id === id); if (!p) return; const l = S.cart.find(c => c.product_id === id && !c.is_return);
  if (l) l.qty = Math.round((l.qty + 1) * 1000) / 1000; else S.cart.push({ product_id: id, qty: 1, discount_pct: p.discount_pct, is_return: false });
  if (!S.ref) S.ref = uid(); saveCart(); renderCart();
}
function calc() {
  let sub = 0, disc = 0, tax = 0, total = 0;
  const L = S.cart.map(c => { const p = S.products.find(x => x.id === c.product_id) || { price: 0, tax_pct: 0, name: '?', stock: 0 }, sg = c.is_return ? -1 : 1, g = p.price * c.qty, d = g * (+c.discount_pct || 0) / 100, t = (g - d) * p.tax_pct / 100;
    sub += sg * g; disc += sg * d; tax += sg * t; total += sg * (g - d + t); return { c, p, line: sg * (g - d + t) }; });
  return { L, sub, disc, tax, total };
}
function renderCart() {
  const el = $('#cp'); if (!el) return; const t = calc(), n = S.cart.length, canD = can('pos.discount'), P = S.pay;
  $('#cb').innerHTML = `<span>🛒 ${n} item${n === 1 ? '' : 's'}</span><span>${rs(t.total)}</span>`;
  const cust = S.cust.map(c => `<option value="${c.id}" ${String(P.customer) === String(c.id) ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.balance > 0 ? ' (owes ' + money(c.balance) + ')' : ''}</option>`).join('');
  el.innerHTML = `<div class="card" style="margin:0"><div class="row"><h3 class="sp" style="margin:0">Current bill</h3><button class="btn sm" id="cl">Clear</button><button class="btn sm" id="cx" style="display:${innerWidth <= 900 ? '' : 'none'}">✕</button></div><div style="margin:12px 0" id="lines">${t.L.map((x, i) => `<div class="line" style="${x.c.is_return ? 'border-color:#fca5a5' : ''}"><div class="t"><span>${esc(x.p.name)}${x.c.is_return ? ' <span class="badge bad">RETURN</span>' : ''}</span><span class="mono">${money(x.line)}</span></div>
    <div class="ctl"><button class="qb" data-a="m" data-i="${i}">−</button><input type="number" inputmode="decimal" step="any" min="0" value="${x.c.qty}" data-a="q" data-i="${i}"><button class="qb" data-a="p" data-i="${i}">+</button>
    ${canD ? `<input type="number" inputmode="decimal" min="0" max="100" value="${x.c.discount_pct}" data-a="d" data-i="${i}" title="Discount %" style="width:64px"><span class="mut">%</span>` : (x.c.discount_pct ? `<span class="badge ok">${qn(x.c.discount_pct)}% off</span>` : '')}
    <span class="sp"></span><button class="btn sm" data-a="r" data-i="${i}">↩</button><button class="btn sm bad" data-a="x" data-i="${i}">✕</button></div></div>`).join('') || '<p class="mut" style="text-align:center;padding:24px 0">Tap products to add them</p>'}</div>
  <div class="tot"><div><span>Subtotal</span><span class="mono">${money(t.sub)}</span></div><div><span>Discount</span><span class="mono">− ${money(t.disc)}</span></div>${t.tax ? `<div><span>Tax</span><span class="mono">${money(t.tax)}</span></div>` : ''}<div class="g"><span>Total</span><span class="mono">${rs(t.total)}</span></div></div>
  <div class="grid g2" style="margin-top:12px"><div><label>Payment</label><select id="pm">${['cash', 'card', 'transfer', 'credit'].map(m => `<option ${P.method === m ? 'selected' : ''} value="${m}">${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select></div>
  <div id="pdw" style="display:${P.method === 'credit' ? '' : 'none'}"><label>Paid now (Rs.)</label><input type="number" inputmode="decimal" id="pd" value="${esc(P.paid)}" placeholder="0.00"></div></div>
  <div class="f" style="margin-top:10px"><label>Customer ${P.method === 'credit' ? '(required)' : '(optional)'}</label><div class="row" style="flex-wrap:nowrap"><select id="cs"><option value="">Walk-in customer</option>${cust}</select><button class="btn" id="nc">＋</button></div></div>
  <div class="f"><label>Note</label><input id="nt" value="${esc(P.note)}" maxlength="200"></div>
  <button class="btn pri" id="go" style="width:100%;padding:14px;font-size:16px" ${n ? '' : 'disabled'}>Complete Order · ${rs(t.total)}</button></div>`;
  $('#cl').onclick = () => { if (S.cart.length && !confirm('Clear this bill?')) return; resetCart(); renderCart(); }; $('#cx').onclick = () => el.classList.remove('open');
  $('#lines').onclick = e => { const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT') return; const i = +b.dataset.i, c = S.cart[i], a = b.dataset.a;
    if (a === 'p') c.qty = Math.round((c.qty + 1) * 1000) / 1000; if (a === 'm') c.qty = Math.max(0.001, Math.round((c.qty - 1) * 1000) / 1000) || 1; if (a === 'r') c.is_return = !c.is_return; if (a === 'x') S.cart.splice(i, 1);
    if (!S.cart.length) S.ref = null; saveCart(); renderCart(); };
  $('#lines').onchange = e => { const b = e.target, c = S.cart[+b.dataset.i]; if (!c) return; if (b.dataset.a === 'q') c.qty = Math.max(0.001, +b.value || 1); if (b.dataset.a === 'd') c.discount_pct = Math.min(100, Math.max(0, +b.value || 0)); saveCart(); renderCart(); };
  $('#pm').onchange = e => { P.method = e.target.value; saveCart(); renderCart(); }; $('#cs').onchange = e => { P.customer = e.target.value; saveCart(); }; $('#nt').oninput = e => { P.note = e.target.value; saveCart(); }; const pd = $('#pd'); if (pd) pd.oninput = e => { P.paid = e.target.value; saveCart(); };
  $('#nc').onclick = () => custModal(null, c => { S.cust.push(c); P.customer = c.id; saveCart(); renderCart(); });
  $('#go').onclick = e => guard(e.target, completeOrder);
}
function resetCart() { S.cart = []; S.ref = null; S.pay = { method: 'cash', paid: '', note: '', customer: '' }; saveCart(); }
async function completeOrder() {
  if (!S.cart.length) return; const P = S.pay;
  const r = await api('/orders', { method: 'POST', body: { client_ref: S.ref, customer_id: P.customer || null, payment_method: P.method, paid: P.method === 'credit' ? (+P.paid || 0) : undefined, note: P.note, items: S.cart.map(c => ({ product_id: c.product_id, qty: c.qty, is_return: c.is_return, discount_pct: can('pos.discount') ? c.discount_pct : undefined })) } });
  resetCart(); $('#cp')?.classList.remove('open'); await loadProducts(); renderList(); renderCart();
  modal(`<div style="text-align:center"><div style="font-size:44px">✅</div><h3>Order ${esc(r.invoice_no)} saved</h3><div class="title mono">${rs(r.total)}</div><p class="mut" style="margin:6px 0 16px">${r.duplicate ? 'This order was already saved.' : 'Synced to the main computer.'}</p>
  <div class="grid"><a class="btn pri" target="_blank" href="${dl(r.id)}">📄 Open invoice (A4 PDF)</a><a class="btn" target="_blank" href="${dl(r.id, 'thermal')}">🧾 57mm receipt (PDF)</a>${navigator.bluetooth ? `<button class="btn" id="bt">📡 Print via Bluetooth</button>` : ''}<button class="btn" onclick="closeModal()">New bill</button></div></div>`);
  const bt = $('#bt'); if (bt) bt.onclick = () => guard(bt, () => btPrint(r.id));
}
const BT = [['000018f0-0000-1000-8000-00805f9b34fb', '00002af1-0000-1000-8000-00805f9b34fb'], ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f']];
async function btPrint(id) {
  const o = await api('/orders/' + id), W = 32, enc = new TextEncoder(), B = [], add = t => B.push(...enc.encode(t)), pr = (a, b) => a + ' '.repeat(Math.max(1, W - a.length - b.length)) + b, D = '-'.repeat(W) + '\n';
  B.push(0x1B, 0x40, 0x1B, 0x61, 1, 0x1B, 0x45, 1, 0x1D, 0x21, 0x11); add((S.cfg.business_name || '') + '\n'); B.push(0x1D, 0x21, 0, 0x1B, 0x45, 0); add((S.cfg.business_address || '') + '\n' + D + 'SALES INVOICE\n'); B.push(0x1B, 0x61, 0);
  add(`INV REF No : ${o.invoice_no}\n${ldate(o.created_at)}\nRep : ${o.employee}\nCustomer : ${o.customer_name}\n${D}`);
  o.items.forEach(i => { add(i.name.slice(0, W) + '\n'); add(pr(`  ${money(i.unit_price)} x ${qn(i.qty)}`, money(i.line_total)) + '\n'); });
  add(D + pr('Gross Amount:', money(o.subtotal)) + '\n' + pr('Discount:', money(o.discount_total)) + '\n' + D); B.push(0x1B, 0x45, 1);
  add(pr('Net Amount:', money(o.total)) + '\n'); B.push(0x1B, 0x45, 0); add(pr('Outstanding:', money(o.prev_outstanding)) + '\n'); B.push(0x1B, 0x45, 1); add(pr('Net Payable:', money(o.total + o.prev_outstanding)) + '\n'); B.push(0x1B, 0x45, 0);
  add(pr('Paid Amount:', money(o.paid)) + '\n' + D); B.push(0x1B, 0x61, 1); add((S.cfg.receipt_footer || 'Thank you!') + '\n\n\n\n'); B.push(0x1D, 0x56, 0x41, 0);
  const sv = BT.map(x => x[0]), dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: sv }), srv = await dev.gatt.connect(); let ch = null;
  for (const [s, c] of BT) { try { ch = await (await srv.getPrimaryService(s)).getCharacteristic(c); break; } catch {} } if (!ch) throw new Error('Printer not supported');
  const u = new Uint8Array(B); for (let i = 0; i < u.length; i += 100) { await ch.writeValue(u.slice(i, i + 100)); await new Promise(r => setTimeout(r, 40)); } toast('Printed', 'ok');
}

// ───────── orders ─────────
async function vOrders() {
  const all = can('orders.view_all'), users = all && can('users.manage') ? (await api('/users')).users : [];
  $('#main').innerHTML = head('Orders', all ? 'All orders, live' : 'Your orders') + `<div class="card"><div class="row"><input id="oq" placeholder="Invoice or customer" style="max-width:200px"><input type="date" id="of" style="max-width:150px"><input type="date" id="ot" style="max-width:150px"><select id="os" style="max-width:130px"><option value="">All status</option><option>completed</option><option>cancelled</option></select>${users.length ? `<select id="ou" style="max-width:170px"><option value="">All staff</option>${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>` : ''}<button class="btn pri" id="of2">Filter</button></div></div><div class="card tw"><table id="ot2"></table></div>`;
  const load = async () => { const p = new URLSearchParams({ q: $('#oq').value, from: $('#of').value, to: $('#ot').value, status: $('#os').value, user: $('#ou')?.value || '' }); const os = await api('/orders?' + p);
    $('#ot2').innerHTML = '<tr><th>Invoice</th><th>Date</th><th>Staff</th><th>Customer</th><th>Payment</th><th class="r">Total</th><th>Status</th><th></th></tr>' + os.map(o => `<tr><td><b>${o.invoice_no}</b></td><td>${ldate(o.created_at)}</td><td>${esc(o.employee)}</td><td>${esc(o.customer_name)}</td><td>${o.payment_method}${o.paid < o.total - 0.005 && o.status === 'completed' ? ' <span class="badge warn">due ' + money(o.total - o.paid) + '</span>' : ''}</td><td class="r mono">${money(o.total)}</td><td><span class="badge ${o.status === 'completed' ? 'ok' : 'bad'}">${o.status}</span></td>
    <td class="row" style="flex-wrap:nowrap"><a class="btn sm" target="_blank" href="${dl(o.id)}">PDF</a><a class="btn sm" target="_blank" href="${dl(o.id, 'thermal')}">57mm</a><button class="btn sm" data-d="${o.id}">View</button>${can('orders.cancel') && o.status === 'completed' ? `<button class="btn sm bad" data-c="${o.id}" data-n="${o.invoice_no}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td class="mut">No orders found</td></tr>'; };
  $('#of2').onclick = load; await load();
  $('#ot2').onclick = async e => { const d = e.target.dataset.d, c = e.target.dataset.c;
    if (d) { const o = await api('/orders/' + d); modal(`<h3>${o.invoice_no} <span class="badge ${o.status === 'completed' ? 'ok' : 'bad'}">${o.status}</span></h3><p class="mut">${ldate(o.created_at)} · ${esc(o.employee)} · ${esc(o.customer_name)}</p><div class="tw"><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Disc</th><th class="r">Total</th></tr>${o.items.map(i => `<tr><td>${i.is_return ? '↩ ' : ''}${esc(i.name)}</td><td class="r">${qn(i.qty)}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.discount_amt)}</td><td class="r">${money(i.line_total)}</td></tr>`).join('')}</table></div><p class="r" style="margin-top:10px">Subtotal ${money(o.subtotal)} · Discount ${money(o.discount_total)}<br><b>Total ${rs(o.total)}</b> · Paid ${money(o.paid)}</p>${o.cancel_reason ? `<div class="err">Cancelled: ${esc(o.cancel_reason)}</div>` : ''}<div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Close</button></div>`, true); }
    if (c) { const m = modal(`<h3>Cancel ${esc(e.target.dataset.n)}?</h3><p class="mut" style="margin-bottom:10px">Stock will be restored. This is recorded in the activity log.</p><div class="f"><label>Reason</label><input id="cr"></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Keep</button><button class="btn bad" id="cy">Cancel order</button></div>`);
      $('#cy', m).onclick = ev => guard(ev.target, async () => { await api(`/orders/${c}/cancel`, { method: 'POST', body: { reason: $('#cr').value } }); closeModal(); toast('Order cancelled'); load(); }); } };
}

// ───────── products & stock ─────────
async function vProducts() {
  const ps = await api('/products?all=1'), man = can('products.manage'), cost = ps[0] && 'cost' in ps[0], low = +S.cfg.low_stock || 10;
  $('#main').innerHTML = head('Products', 'Catalogue, prices and product discounts', man ? '<button class="btn pri" id="np">＋ Add product</button>' : '') + `<div class="card"><input id="pq" placeholder="🔍 Search…" style="max-width:300px;margin-bottom:12px"><div class="tw"><table id="pt"></table></div></div>`;
  const draw = () => { const q = $('#pq').value.toLowerCase(); $('#pt').innerHTML = `<tr><th></th><th>Name</th><th>SKU</th><th class="r">Price</th>${cost ? '<th class="r">Cost</th>' : ''}<th class="r">Disc %</th><th class="r">Tax %</th><th class="r">Stock</th><th></th></tr>` + ps.filter(p => !q || (p.name + p.sku).toLowerCase().includes(q)).map(p => `<tr style="${p.active ? '' : 'opacity:.5'}"><td>${thumb(p.image_url)}</td><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge">archived</span>'}</td><td class="mono">${esc(p.sku)}</td><td class="r mono">${money(p.price)}</td>${cost ? `<td class="r mono">${money(p.cost)}</td>` : ''}<td class="r">${qn(p.discount_pct)}</td><td class="r">${qn(p.tax_pct)}</td><td class="r"><span class="badge ${p.stock <= 0 ? 'bad' : p.stock < low ? 'warn' : 'ok'}">${qn(p.stock)}</span></td><td class="r">${man ? `<button class="btn sm" data-e="${p.id}">Edit</button> ${p.active ? `<button class="btn sm bad" data-a="${p.id}">Archive</button>` : `<button class="btn sm" data-r="${p.id}">Restore</button>`}` : ''}</td></tr>`).join(''); };
  $('#pq').oninput = draw; draw();
  const form = p => { const o = modal(`<h3>${p ? 'Edit' : 'New'} product</h3><div class="f"><label>Name</label><input id="fn" value="${esc(p?.name)}"></div><div class="grid g2"><div class="f"><label>SKU ${p ? '' : '(auto if blank)'}</label><input id="fs" value="${esc(p?.sku)}" ${p ? 'disabled' : ''}></div><div class="f"><label>Selling price</label><input id="fp" type="number" step="0.01" value="${p?.price ?? ''}"></div><div class="f"><label>Cost price</label><input id="fc" type="number" step="0.01" value="${p?.cost ?? 0}"></div><div class="f"><label>Product discount %</label><input id="fd" type="number" step="0.01" value="${p?.discount_pct ?? 0}"></div><div class="f"><label>Tax %</label><input id="ft" type="number" step="0.01" value="${p?.tax_pct ?? 0}"></div>${p ? '' : '<div class="f"><label>Opening stock</label><input id="fk" type="number" step="any" value="0"></div>'}</div><div class="f"><label>Photo (optional)</label><div class="row">${thumb(p?.image_url, 56)}<input type="file" id="fi" accept="image/*" style="flex:1">${p?.image_url ? '<button type="button" class="btn sm bad" id="frm">Remove photo</button>' : ''}</div></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="fsv">Save</button></div>`);
    const frm = $('#frm', o); if (frm) frm.onclick = e => guard(e.target, async () => { await api(`/products/${p.id}/image`, { method: 'DELETE' }); closeModal(); toast('Photo removed', 'ok'); route(); });
    $('#fsv', o).onclick = e => guard(e.target, async () => { const b = { name: $('#fn').value, price: $('#fp').value, cost: $('#fc').value, discount_pct: $('#fd').value, tax_pct: $('#ft').value }; if (!p) { b.sku = $('#fs').value; b.stock = $('#fk').value; } const sv = await api(p ? '/products/' + p.id : '/products', { method: p ? 'PATCH' : 'POST', body: b }), pid = p ? p.id : sv.id, ph = $('#fi').files[0]; if (ph) await upload(`/products/${pid}/image`, await shrink(ph, 640, 'image/jpeg')); closeModal(); toast('Saved', 'ok'); route(); }); };
  if (man) { $('#np').onclick = () => form(); $('#pt').onclick = async e => { const t = e.target, id = t.dataset.e || t.dataset.a || t.dataset.r; if (!id) return; if (t.dataset.e) return form(ps.find(p => p.id == id)); if (t.dataset.a && !confirm('Archive this product? It disappears from billing; history is kept.')) return; await api('/products/' + id, t.dataset.a ? { method: 'DELETE' } : { method: 'PATCH', body: { active: true } }).catch(er => toast(er.message, 'err')); route(); }; }
}
async function vStock() {
  const [ps, mv] = await Promise.all([api('/products'), api('/stock/movements')]), low = +S.cfg.low_stock || 10;
  $('#main').innerHTML = head('Stock', 'Receive stock and make adjustments') + `<div class="card"><input id="sq" placeholder="🔍 Search…" style="max-width:300px;margin-bottom:12px"><div class="tw"><table id="st"></table></div></div><div class="card"><h3>Recent stock movements</h3><div class="tw"><table><tr><th>When</th><th>Product</th><th class="r">Change</th><th>Reason</th><th>By</th></tr>${mv.map(m => `<tr><td>${ldate(m.created_at)}</td><td>${esc(m.product)}</td><td class="r mono" style="color:${m.delta > 0 ? 'var(--ok)' : 'var(--bad)'}">${m.delta > 0 ? '+' : ''}${qn(m.delta)}</td><td>${esc(m.reason)}</td><td>${esc(m.user)}</td></tr>`).join('')}</table></div></div>`;
  const draw = () => { const q = $('#sq').value.toLowerCase(); $('#st').innerHTML = '<tr><th>Product</th><th>SKU</th><th class="r">In stock</th><th></th></tr>' + ps.filter(p => !q || (p.name + p.sku).toLowerCase().includes(q)).map(p => `<tr><td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.sku)}</td><td class="r"><span class="badge ${p.stock <= 0 ? 'bad' : p.stock < low ? 'warn' : 'ok'}">${qn(p.stock)}</span></td><td class="r"><button class="btn sm pri" data-i="${p.id}">Adjust</button></td></tr>`).join(''); };
  $('#sq').oninput = draw; draw();
  $('#st').onclick = e => { const id = e.target.dataset.i; if (!id) return; const p = ps.find(x => x.id == id), o = modal(`<h3>Adjust stock — ${esc(p.name)}</h3><p class="mut" style="margin-bottom:10px">Current: ${qn(p.stock)}. Use a positive number to add, negative to remove.</p><div class="f"><label>Quantity change</label><input id="sd" type="number" step="any" autofocus></div><div class="f"><label>Reason</label><input id="sr" placeholder="e.g. New delivery"></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="ss">Apply</button></div>`);
    $('#ss', o).onclick = ev => guard(ev.target, async () => { await api(`/products/${id}/stock`, { method: 'POST', body: { delta: $('#sd').value, reason: $('#sr').value } }); closeModal(); toast('Stock updated', 'ok'); route(); }); };
}

// ───────── customers & creditors ─────────
function custModal(c, done) {
  const o = modal(`<h3>${c ? 'Edit' : 'New'} customer</h3><div class="f"><label>Name</label><input id="cn" value="${esc(c?.name)}"></div><div class="f"><label>Phone</label><input id="cp2" value="${esc(c?.phone)}"></div><div class="f"><label>Address</label><input id="ca" value="${esc(c?.address)}"></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="cv">Save</button></div>`);
  $('#cv', o).onclick = e => guard(e.target, async () => { const body = { name: $('#cn').value, phone: $('#cp2').value, address: $('#ca').value }; const r = await api(c ? '/customers/' + c.id : '/customers', { method: c ? 'PATCH' : 'POST', body }); closeModal(); toast('Saved', 'ok'); done ? done({ ...body, id: c?.id || r.id, balance: 0 }) : route(); });
}
async function ledger(id) {
  const d = await api(`/customers/${id}/ledger`);
  modal(`<h3>${esc(d.customer.name)} <span class="badge ${d.balance > 0 ? 'bad' : 'ok'}">Balance ${money(d.balance)}</span></h3><p class="mut">${esc(d.customer.phone)} ${esc(d.customer.address)}</p><h3 style="margin-top:12px;font-size:13px">Orders</h3><div class="tw"><table>${d.orders.map(o => `<tr><td><a target="_blank" href="${dl(o.id)}">${o.invoice_no}</a></td><td>${ldate(o.created_at)}</td><td class="r mono">${money(o.total)}</td><td class="r mono">paid ${money(o.paid)}</td><td>${o.status}</td></tr>`).join('') || '<tr><td class="mut">None</td></tr>'}</table></div><h3 style="margin-top:12px;font-size:13px">Payments received</h3><div class="tw"><table>${d.payments.map(p => `<tr><td>${ldate(p.created_at)}</td><td class="r mono">${money(p.amount)}</td><td>${p.method}</td><td>${esc(p.user)}</td></tr>`).join('') || '<tr><td class="mut">None</td></tr>'}</table></div><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" onclick="closeModal()">Close</button></div>`, true);
}
async function vCustomers() {
  const cs = await api('/customers'); $('#main').innerHTML = head('Customers', '', '<button class="btn pri" id="nc2">＋ Add customer</button>') + `<div class="card tw"><table id="ct"><tr><th>Name</th><th>Phone</th><th>Address</th><th class="r">Balance</th><th></th></tr>${cs.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td class="r mono">${c.balance > 0 ? `<span class="badge bad">${money(c.balance)}</span>` : '0.00'}</td><td class="r"><button class="btn sm" data-l="${c.id}">Ledger</button> <button class="btn sm" data-e="${c.id}">Edit</button></td></tr>`).join('')}</table></div>`;
  $('#nc2').onclick = () => custModal(null); $('#ct').onclick = e => { if (e.target.dataset.l) ledger(e.target.dataset.l); if (e.target.dataset.e) custModal(cs.find(c => c.id == e.target.dataset.e)); };
}
async function vCreditors() {
  const cs = await api('/creditors'), tot = cs.reduce((a, c) => a + c.balance, 0);
  $('#main').innerHTML = head('Creditors', 'Customers with outstanding balances') + `<div class="grid g3" style="margin-bottom:14px">${stat('Total outstanding', rs(tot))}${stat('Customers owing', cs.length)}</div><div class="card tw"><table id="kt"><tr><th>Customer</th><th>Phone</th><th>Last order</th><th class="r">Outstanding</th><th></th></tr>${cs.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${c.last_order ? ldate(c.last_order) : ''}</td><td class="r mono"><b>${money(c.balance)}</b></td><td class="r"><button class="btn sm" data-l="${c.id}">Ledger</button> <button class="btn sm pri" data-p="${c.id}">Record payment</button></td></tr>`).join('') || '<tr><td class="mut">No outstanding balances 🎉</td></tr>'}</table></div>`;
  $('#kt').onclick = e => { if (e.target.dataset.l) ledger(e.target.dataset.l); const id = e.target.dataset.p; if (!id) return; const c = cs.find(x => x.id == id);
    const o = modal(`<h3>Payment from ${esc(c.name)}</h3><p class="mut" style="margin-bottom:10px">Outstanding: ${rs(c.balance)}</p><div class="f"><label>Amount</label><input id="pa" type="number" step="0.01" value="${c.balance}"></div><div class="f"><label>Method</label><select id="pm2"><option>cash</option><option>card</option><option>transfer</option></select></div><div class="f"><label>Note</label><input id="pn"></div><div class="row"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="py">Save payment</button></div>`);
    $('#py', o).onclick = ev => guard(ev.target, async () => { await api('/payments', { method: 'POST', body: { customer_id: id, amount: $('#pa').value, method: $('#pm2').value, note: $('#pn').value } }); closeModal(); toast('Payment recorded', 'ok'); route(); }); };
}

// ───────── reports ─────────
async function vReports() {
  $('#main').innerHTML = head('Reports', 'Analytics calculated from live database records') + `<div class="card"><div class="row"><div><label>From</label><input type="date" id="rf"></div><div><label>To</label><input type="date" id="rt"></div><div class="row" style="align-self:end"><button class="btn pri" id="ra">Apply</button><button class="btn" data-q="0">Today</button><button class="btn" data-q="6">7 days</button><button class="btn" data-q="29">30 days</button><button class="btn" data-q="m">This month</button><button class="btn" data-q="y">This year</button></div><span class="sp"></span>${can('reports.export') ? '<div class="row" style="align-self:end"><a class="btn" id="rx">⬇ Excel</a><a class="btn" id="rp">⬇ PDF</a></div>' : ''}</div></div><div id="rbody"></div>`;
  let today = null; const run = async () => { const f = $('#rf').value, t = $('#rt').value, q = f && t ? `?from=${f}&to=${t}` : ''; const d = await api('/reports/summary' + q); today = d.today; $('#rf').value = d.range.from; $('#rt').value = d.range.to;
    const base = `/api/reports/export?from=${d.range.from}&to=${d.range.to}`; if ($('#rx')) { $('#rx').href = base + '&type=xlsx'; $('#rp').href = base + '&type=pdf'; } draw(d); };
  const dd = (n) => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  $('#ra').onclick = run; $$('[data-q]').forEach(b => b.onclick = () => { const q = b.dataset.q; $('#rt').value = today; $('#rf').value = q === 'm' ? today.slice(0, 8) + '01' : q === 'y' ? today.slice(0, 5) + '01-01' : dd(+q); run(); }); await run();
}
function draw(d) {
  const r = d.range_stats; $('#rbody').innerHTML = cards(d) + `<div class="grid g5" style="margin-bottom:14px">${stat('Revenue', rs(r.revenue))}${stat('Orders', r.orders, r.cancelled + ' cancelled')}${stat('Avg order', rs(r.avg_order))}${stat('Discounts', rs(r.discounts))}${stat('Outstanding credit', rs(d.outstanding), r.paid_orders + ' paid · ' + r.unpaid_orders + ' unpaid/partial')}</div>
  <div class="card"><div class="row"><h3 class="sp" style="margin:0">Sales trend</h3><div class="tabs" id="tb">${['day', 'week', 'month', 'year'].map((k, i) => `<button data-k="${k}" class="${i ? '' : 'on'}">${k[0].toUpperCase() + k.slice(1)}ly</button>`).join('').replace('Dayly', 'Daily')}</div></div><div class="chartbox"><canvas id="t1"></canvas></div></div>
  <div class="grid g2"><div class="card"><h3>Best-selling products</h3><div class="chartbox"><canvas id="t2"></canvas></div></div><div class="card"><h3>Payment methods</h3><div class="chartbox"><canvas id="t3"></canvas></div></div></div>
  <div class="grid g2"><div class="card"><h3>Lowest-selling products</h3><div class="tw"><table><tr><th>Product</th><th class="r">Qty</th><th class="r">Revenue</th></tr>${[...d.products].reverse().slice(0, 10).map(p => `<tr><td>${esc(p.name)}</td><td class="r">${qn(p.qty)}</td><td class="r mono">${money(p.revenue)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Employee & manager performance</h3><div class="tw"><table><tr><th>Name</th><th>Role</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">Discounts</th></tr>${d.employees.map(e => `<tr><td>${esc(e.name)}</td><td>${e.role}</td><td class="r">${e.orders}</td><td class="r mono">${money(e.revenue)}</td><td class="r mono">${money(e.discounts)}</td></tr>`).join('')}</table></div></div></div>
  <div class="card"><h3>Discount analysis (by product)</h3><div class="tw"><table><tr><th>Product</th><th class="r">Discount given</th><th class="r">Revenue</th></tr>${d.products.filter(p => p.discount > 0).sort((a, b) => b.discount - a.discount).slice(0, 15).map(p => `<tr><td>${esc(p.name)}</td><td class="r mono">${money(p.discount)}</td><td class="r mono">${money(p.revenue)}</td></tr>`).join('') || '<tr><td class="mut">No discounts in this period</td></tr>'}</table></div></div>`;
  const tr = k => chart('t1', { type: k === 'day' ? 'line' : 'bar', data: { labels: d.series[k].map(s => s.label), datasets: [{ label: 'Revenue', data: d.series[k].map(s => s.revenue), borderColor: '#2563eb', backgroundColor: k === 'day' ? '#2563eb22' : '#2563eb', fill: true, tension: .3, borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  tr('day'); $('#tb').onclick = e => { const k = e.target.dataset.k; if (!k) return; $$('#tb button').forEach(b => b.classList.toggle('on', b === e.target)); tr(k); };
  const top = d.products.filter(p => p.qty > 0).slice(0, 8); chart('t2', { type: 'bar', data: { labels: top.map(p => p.name.slice(0, 18)), datasets: [{ label: 'Qty', data: top.map(p => p.qty), backgroundColor: '#16a34a', borderRadius: 4 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
  chart('t3', { type: 'doughnut', data: { labels: d.payments.map(p => p.method), datasets: [{ data: d.payments.map(p => p.revenue), backgroundColor: palette }] } });
}

// ───────── users ─────────
async function vUsers() {
  const d = await api('/users'), owner = S.me.role === 'owner';
  $('#main').innerHTML = head('Users', owner ? 'Create managers and employees, control their permissions' : 'Manage your employees', '<button class="btn pri" id="nu">＋ Add user</button>') + `<div class="card tw"><table id="ut"><tr><th>Name</th><th>Username</th><th>Role</th><th>Last login</th><th>Status</th><th></th></tr>${d.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td><span class="badge ${u.role === 'owner' ? 'warn' : u.role === 'manager' ? 'pri' : ''}">${u.role}</span></td><td>${u.last_login ? ldate(u.last_login) : '—'}</td><td><span class="badge ${u.active ? 'ok' : 'bad'}">${u.active ? 'active' : 'disabled'}</span></td><td class="r">${u.role === 'owner' ? '' : `<button class="btn sm" data-e="${u.id}">Edit</button> <button class="btn sm ${u.active ? 'bad' : ''}" data-t="${u.id}">${u.active ? 'Deactivate' : 'Activate'}</button>`}</td></tr>`).join('')}</table></div>`;
  const form = u => { const role = u?.role || 'employee', mine = owner ? d.all : d.all.filter(p => S.perms.includes(p)), cur = u ? u.permissions : d.defaults[role];
    const o = modal(`<h3>${u ? 'Edit ' + esc(u.name) : 'New user'}</h3><div class="grid g2"><div class="f"><label>Full name</label><input id="un" value="${esc(u?.name)}"></div><div class="f"><label>Username</label><input id="uu" value="${esc(u?.username)}" ${u ? 'disabled' : ''}></div><div class="f"><label>${u ? 'Reset password (optional)' : 'Password (min 8)'}</label><input id="up" type="password" autocomplete="new-password"></div>
    <div class="f"><label>Role</label><select id="ur" ${owner ? '' : 'disabled'}><option value="employee" ${role === 'employee' ? 'selected' : ''}>Employee</option>${owner ? `<option value="manager" ${role === 'manager' ? 'selected' : ''}>Manager</option>` : ''}</select></div></div>
    <label style="margin-top:6px">Permissions (enforced by the server)</label><div class="perms" id="pp"></div><div class="row" style="margin-top:16px"><span class="sp"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="us">Save</button></div>`, true);
    const paint = (list) => { const r = $('#ur').value; $('#pp').innerHTML = mine.filter(p => p !== 'users.manage' || r === 'manager').map(p => `<label><input type="checkbox" value="${p}" ${list.includes(p) ? 'checked' : ''}>${PL[p]}</label>`).join(''); };
    paint(cur); $('#ur').onchange = () => paint(d.defaults[$('#ur').value]);
    $('#us', o).onclick = e => guard(e.target, async () => { const perms = $$('#pp input:checked').map(c => c.value), body = { name: $('#un').value, permissions: perms, role: $('#ur').value }; if ($('#up').value) body.password = $('#up').value;
      if (u) await api('/users/' + u.id, { method: 'PATCH', body }); else await api('/users', { method: 'POST', body: { ...body, username: $('#uu').value, password: $('#up').value } }); closeModal(); toast('User saved', 'ok'); route(); }); };
  $('#nu').onclick = () => form(); $('#ut').onclick = async e => { const t = e.target.dataset.t, ed = e.target.dataset.e; if (ed) form(d.users.find(u => u.id == ed)); if (t) { const u = d.users.find(x => x.id == t); if (!confirm(`${u.active ? 'Deactivate' : 'Activate'} ${u.name}?`)) return; await api('/users/' + t, { method: 'PATCH', body: { active: !u.active } }).catch(er => toast(er.message, 'err')); route(); } };
}
async function vLogs() {
  $('#main').innerHTML = head('Activity Log', 'Logins, orders, price & discount changes, user changes', '<input id="lq" placeholder="Search…" style="max-width:240px">') + '<div class="card tw"><table id="lt"></table></div>';
  const load = async () => { const l = await api('/logs?q=' + encodeURIComponent($('#lq').value)); $('#lt').innerHTML = '<tr><th>When</th><th>User</th><th>Action</th><th>Detail</th><th>IP</th></tr>' + l.map(x => `<tr><td>${ldate(x.created_at)}</td><td>${esc(x.username)}</td><td><span class="badge ${/failed|cancel|deactivate/.test(x.action) ? 'bad' : ''}">${esc(x.action)}</span></td><td>${esc(x.detail)}</td><td class="mut">${esc(x.ip)}</td></tr>`).join(''); };
  let tm; $('#lq').oninput = () => { clearTimeout(tm); tm = setTimeout(load, 300); }; await load();
}

// ───────── settings (owner) ─────────
async function vSettings() {
  const c = (await api('/me')).settings; S.cfg = c; const f = (id, l, v, t = 'text') => `<div class="f"><label>${l}</label><input id="${id}" type="${t}" value="${esc(v)}"></div>`;
  $('#main').innerHTML = head('Settings', 'Business details used on invoices') + `<div class="grid g2"><div class="card"><h3>Business</h3>${f('s1', 'Business name', c.business_name)}${f('s2', 'Address', c.business_address)}${f('s3', 'Phone', c.business_phone)}${f('s4', 'Route / branch name (shown on 57mm receipt)', c.route_name)}${f('s5', 'Receipt footer', c.receipt_footer)}<div class="grid g2">${f('s6', 'Time zone offset (minutes from UTC; Sri Lanka = 330)', c.tz_offset, 'number')}${f('s7', 'Low-stock warning below', c.low_stock, 'number')}</div>
  <div class="f"><label>Logo (PNG or JPEG — resized automatically)</label><input type="file" id="s8" accept="image/png,image/jpeg">${c.logo ? `<img src="${esc(c.logo)}" style="height:48px;margin-top:8px"> <button class="btn sm bad" id="s9">Remove logo</button>` : ''}</div><button class="btn pri" id="sv">Save settings</button></div>
  <div class="card"><h3>Data safety</h3><p class="mut" style="margin-bottom:10px">Everything (orders, A4 invoice PDFs, products, users) is stored in your cloud PostgreSQL database, which keeps its own backups and history — see your database provider's dashboard to restore. As an extra safety copy you can download all business data here.</p><a class="btn pri" href="/api/export">⬇ Download full data export (JSON)</a><p class="mut" style="margin-top:10px;font-size:12px">Invoice PDFs already issued are never changed when you edit business details, so old invoices stay exactly as they were printed.</p></div></div>`;
  const save = async extra => { const b = { business_name: $('#s1').value, business_address: $('#s2').value, business_phone: $('#s3').value, route_name: $('#s4').value, receipt_footer: $('#s5').value, tz_offset: $('#s6').value, low_stock: $('#s7').value, ...extra }; S.cfg = await api('/settings', { method: 'PATCH', body: b }); toast('Settings saved', 'ok'); shell(); };
  $('#sv').onclick = e => guard(e.target, () => save()); const rm = $('#s9'); if (rm) rm.onclick = async () => { S.cfg = await api('/settings/logo', { method: 'DELETE' }); toast('Logo removed'); shell(); };
  $('#s8').onchange = async e => { const f2 = e.target.files[0]; if (!f2) return; try { S.cfg = await upload('/settings/logo', await shrink(f2, 400, 'image/png')); toast('Logo saved', 'ok'); shell(); } catch (er) { toast(er.message, 'err'); } };
}
boot();
