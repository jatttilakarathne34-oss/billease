'use strict';
const PDFDocument = require('pdfkit');
// PDFKit loads its built-in fonts through an alias that serverless bundlers (Vercel) cannot see, so the files would be left out and every PDF would fail.
// Requiring them explicitly makes the bundler include them. Fonts used: Helvetica, Helvetica-Bold, Helvetica-Oblique.
require('pdfkit/standard-fonts/Helvetica'); require('pdfkit/standard-fonts/HelveticaBold'); require('pdfkit/standard-fonts/HelveticaOblique');
const m = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const getLogo = S => S.logo_buf || logoBuf(S.logo);
const logoBuf = s => { const x = /^data:image\/(png|jpeg);base64,(.+)$/.exec(s || ''); return x ? Buffer.from(x[2], 'base64') : null; };
function local(utc, off) {
  const d = new Date((utc instanceof Date ? utc : new Date(String(utc).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(utc)) ? '' : 'Z'))).getTime() + off * 60000);
  const h = d.getUTCHours(), mi = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: d.toISOString().slice(0, 10), time: `${h % 12 || 12}:${mi} ${h >= 12 ? 'PM' : 'AM'}` };
}
const q = v => (Math.round(v * 1000) / 1000).toString();

// ---------- A4 (formal business invoice layout) ----------
function a4(o, S) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: o.invoice_no, Author: S.business_name || 'Business' } });
  const off = parseInt(S.tz_offset || '330'), t = local(o.created_at, off), lg = getLogo(S);
  const L = 40, R = 555, W = R - L, GRAY = '#666666';
  const font = (b, sz, c = '#000000') => doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz).fillColor(c);
  const clip = (s, w) => { s = String(s ?? ''); if (doc.widthOfString(s) <= w) return s; while (s.length > 1 && doc.widthOfString(s + '...') > w) s = s.slice(0, -1); return s.trimEnd() + '...'; };
  const one = (s, x, y, w, al = 'left') => doc.text(clip(s, w), x, y, { width: w + 2, align: al, lineBreak: false });
  const lines = (s, max) => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, max);
  const wrapped = (s, x, y, w, h) => { doc.text(String(s), x, y, { width: w, height: h, ellipsis: true }); return doc.y; };
  const walkin = !o.customer_name || o.customer_name === 'Walk-in Customer';

  // header: company (left), INVOICE title
  let tx = L; if (lg) { try { doc.image(lg, L, 34, { fit: [46, 46] }); tx = L + 54; } catch {} }
  font(1, 13); one(S.business_name || 'Business', tx, 38, 235);
  font(0, 7, GRAY); let ay = 56; for (const ln of [...lines(S.business_address, 3), S.business_phone, S.business_email].filter(Boolean)) ay = wrapped(ln, tx, ay, 235, 18) + 1;
  font(1, 15); one(o.title || 'INVOICE', 313, 38, 240);

  // recipient (left) + grey info box (right)
  font(1, 9); one('Recipient:', L, 128, 240); font(0, 9.5); one(walkin ? 'Walk-in Customer' : o.customer_name, L, 142, 240);
  let ry = 156; font(0, 9); if (o.customer_phone) { one(o.customer_phone, L, ry, 240); ry += 12; } if (o.customer_address) doc.text(o.customer_address, L, ry, { width: 240 });
  const cn = !!o.title, METH = { credit_note: 'Credit to account', cash: 'Cash', card: 'Card', transfer: 'Bank transfer' }, cap = s => METH[s] || (s[0].toUpperCase() + s.slice(1)), cust = o.customer_id ? String(o.customer_id).padStart(4, '0') : '-';
  const rows = cn ? [['Date', `${t.date}  ${t.time}`], ['Credit note number', o.invoice_no], ['Against invoice', o.against], ['Customer number', cust], ['Processed by', o.employee], ['Refund method', cap(o.payment_method)]]
    : [['Invoice date', `${t.date}  ${t.time}`], ['Invoice number', o.invoice_no], ['Customer number', cust], ['Served by', o.employee], ['Payment method', cap(o.payment_method)]];
  const bx = 311, bw = R - bx, by = 118; doc.rect(bx, by, bw, rows.length * 13 + 12).fill('#efefef');
  rows.forEach(([k, v], i) => { font(0, 9); one(k, bx, by + 8 + i * 13, 122, 'right'); font(i === 1 ? 1 : 0, 9); one(v, bx + 130, by + 8 + i * 13, bw - 134); });

  // greeting
  font(0, 9.5); one(`Dear ${walkin ? 'Customer' : o.customer_name},`, L, 216, W); one(cn ? 'We hereby credit you for the following returned products:' : 'Thank you for your order. We hereby invoice you for the following products:', L, 238, W);

  // items table: grey header, ruled columns, tall frame
  const X = [L, 255, 310, 390, 465, R], TOP = 268, ROW = 15, MINB = 560, MAXB = 700;
  const footer = () => {
    const y = 772; doc.lineWidth(0.8).strokeColor('#555555').moveTo(L, y).lineTo(R, y).stroke();
    const cols = [[S.business_name || 'Business', ...lines(S.business_address, 3)]];
    if (S.bank_details) cols.push(['Bank details', ...String(S.bank_details).split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 4)]);
    const ct = [S.business_phone && 'Tel.: ' + S.business_phone, S.business_email && 'E-mail: ' + S.business_email].filter(Boolean); if (ct.length) cols.push(['Contact information', ...ct]);
    const cw = W / cols.length;
    cols.forEach((c, i) => { let cy = y + 6; font(1, 7.5); one(c[0], L + i * cw, cy, cw - 10); cy += 11; font(0, 7, '#333333'); for (const ln of c.slice(1)) cy = wrapped(ln, L + i * cw, cy, cw - 10, 18) + 0.5; });
  };
  const frame = (top, bottom) => { doc.lineWidth(0.8).strokeColor('#000000').rect(L, top, W, bottom - top).stroke(); for (const x of X.slice(1, -1)) doc.moveTo(x, top).lineTo(x, bottom).stroke(); };
  const head = y => {
    doc.rect(L, y, W, 15).fill('#bfbfbf'); font(1, 8.5);
    one('Description', L + 4, y + 4, X[1] - L - 8); [['Quantity', 1], ['Price (Rs.)/unit', 2], ['Discount', 3], ['Total (Rs.)', 4]].forEach(([h, i]) => one(h, X[i], y + 4, X[i + 1] - X[i] - 5, 'right'));
  };
  let y = TOP, top = TOP; head(y); y += 15;
  for (const i of o.items) {
    if (y + ROW > MAXB) { frame(top, y); footer(); doc.addPage(); top = y = 50; head(y); y += 15; }
    font(0, 8.5, i.is_return ? '#b91c1c' : '#000000');
    one((i.is_return ? '[RETURN] ' : '') + i.name, L + 4, y + 4, X[1] - L - 8); one(q(i.qty), X[1], y + 4, X[2] - X[1] - 5, 'right'); one(m(i.unit_price), X[2], y + 4, X[3] - X[2] - 5, 'right');
    one(i.discount_amt ? `${q(i.discount_pct)}%  ${m(i.discount_amt)}` : '-', X[3], y + 4, X[4] - X[3] - 5, 'right'); one(m(i.line_total), X[4], y + 4, X[5] - X[4] - 5, 'right'); y += ROW;
  }
  const bottom = Math.max(y, top === TOP ? MINB : y); frame(top, bottom); y = bottom + 14;

  // totals (right)
  if (y + 150 > 760) { footer(); doc.addPage(); y = 50; }
  const tr = (l, v, b, sz = 9.5, c = '#000000') => { font(b, sz, c); one(l, 330, y, 130); one(v, 455, y, R - 455, 'right'); y += sz + 5; };
  const net = o.subtotal - o.discount_total;
  const bill = o.bill_discount_amt || 0, prodDisc = o.discount_total - bill;
  if (o.discount_total > 0.005) { tr('Subtotal', m(o.subtotal)); if (prodDisc > 0.005) tr('Discount', '- ' + m(prodDisc)); if (bill > 0.005) tr(`Bill discount (${q(o.bill_discount_pct)}%)`, '- ' + m(bill), 0, 9.5, '#166534'); }
  tr('Net amount', m(net), 1); tr('Sales tax', m(o.tax_total), 1);
  doc.lineWidth(0.8).strokeColor('#000000').moveTo(330, y).lineTo(R, y).stroke().moveTo(330, y + 2).lineTo(R, y + 2).stroke(); y += 9;
  tr(cn ? 'Credit total (Rs.)' : 'Invoice total (Rs.)', m(o.total), 1, 11.5); y += 2;
  if (!cn) tr('Paid', m(o.paid)); if (!cn && o.total - o.paid > 0.005) tr('Balance due', m(o.total - o.paid), 1, 9.5, '#b91c1c'); if (!cn && o.prev_outstanding > 0.005) tr('Previous outstanding', m(o.prev_outstanding));

  // closing
  y = Math.max(y + 22, 700); if (y + 36 > 764) { footer(); doc.addPage(); y = 60; }
  if (o.note) { font(0, 8.5, GRAY); one('Note: ' + o.note, L, y - 22, 300); }
  font(0, 9.5); one('Thank you for your business', L, y, W); one(S.business_name || '', L, y + 22, W);
  footer();
  if (o.status === 'cancelled') { doc.save().rotate(-30, { origin: [300, 420] }).opacity(0.18).font('Helvetica-Bold').fontSize(90).fillColor('#dc2626').text('CANCELLED', 40, 380, { width: 520, align: 'center', lineBreak: false }).restore(); }
  doc.end(); return doc;
}

// ---------- 57mm thermal (matches the Alankulama-style receipt) ----------
function thermalDraw(doc, o, S) {
  const M = 6, W = 161.4 - 2 * M, off = parseInt(S.tz_offset || '330'), t = local(o.created_at, off);
  const line = () => { const y = doc.y + 3; doc.moveTo(M, y).lineTo(M + W, y).dash(2, { space: 2 }).lineWidth(0.8).strokeColor('#000').stroke().undash(); doc.y = y + 6; };
  const pair = (l, r, b, sz) => { const y = doc.y; doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz || 9.5).fillColor('#000'); doc.text(l, M, y, { width: W, lineBreak: false }); doc.text(r, M, y, { width: W, align: 'right', lineBreak: false }); doc.y = y + (sz || 9.5) + 3.5; };
  const txt = (s, o2 = {}) => doc.font(o2.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(o2.sz || 9.5).fillColor('#000').text(s, M, doc.y, { width: W, align: o2.al || 'left' });
  doc.y = 8;
  const lg = getLogo(S); if (lg) { try { doc.image(lg, M + W / 2 - 20, doc.y, { fit: [40, 40] }); doc.y += 44; } catch {} }
  txt(S.business_name || 'Business', { b: 1, sz: 14, al: 'center' });
  if (S.business_address) txt(S.business_address, { sz: 9, al: 'center' });
  if (S.business_phone) txt(S.business_phone, { sz: 9, al: 'center' });
  line();
  const cn = !!o.title; txt(o.title || 'SALES INVOICE', { b: 1, sz: 11, al: 'center' }); doc.y += 3;
  txt(`${cn ? 'CN No' : 'INV REF No'} : ${o.invoice_no}`); if (cn && o.against) txt(`Invoice : ${o.against}`); txt(`${t.date} ${t.time}`);
  txt(`Rep      : ${o.employee}`); if (S.route_name) txt(`Route   : ${S.route_name}`);
  txt(`Customer : ${(o.customer_name || 'Walk-in').toUpperCase()}`);
  line();
  pair('Item', 'Amount', true); line();
  o.items.forEach(i => {
    txt((i.is_return ? '[RET] ' : '') + i.name.toUpperCase(), { b: 1 });
    pair(`   ${m(i.unit_price)} x ${q(i.qty)}`, m(i.line_total));
    if (i.discount_amt) pair(`   Disc ${q(i.discount_pct)}%`, '-' + m(i.discount_amt), false, 8.5);
  });
  line();
  const bill = o.bill_discount_amt || 0; pair('Gross Amount :', m(o.subtotal)); pair('Discount :', m(o.discount_total - bill)); if (bill > 0.005) pair(`Bill disc ${q(o.bill_discount_pct)}% :`, m(bill));
  if (o.tax_total) pair('Tax :', m(o.tax_total));
  line();
  if (cn) { pair('Credit Total :', m(o.total), true, 11); pair('Refund :', ({ credit_note: 'TO ACCOUNT', cash: 'CASH', card: 'CARD', transfer: 'TRANSFER' })[o.payment_method] || o.payment_method.toUpperCase()); }
  else { pair('Net Amount :', m(o.total), true, 11); pair('Outstanding :', m(o.prev_outstanding));
  pair('Net Payable :', m(o.total + o.prev_outstanding), true, 11); pair('Paid Amount :', m(o.paid));
  pair('Payment :', o.payment_method.toUpperCase()); }
  line();
  if (o.status === 'cancelled') txt('*** CANCELLED ***', { b: 1, sz: 12, al: 'center' });
  txt(S.receipt_footer || 'Thank you!', { sz: 9, al: 'center' }); txt('powered by BillEase', { sz: 7.5, al: 'center' });
  return doc.y + 14;
}
function thermal(o, S) {
  const probe = new PDFDocument({ size: [161.4, 6000], margin: 0 }); probe.on('data', () => {});
  const h = Math.ceil(thermalDraw(probe, o, S)); probe.end();
  const doc = new PDFDocument({ size: [161.4, h], margin: 0, info: { Title: o.invoice_no } });
  thermalDraw(doc, o, S); doc.end(); return doc;
}
function invoicePDF(o, S, format) { return format === 'thermal' ? thermal(o, S) : a4(o, S); }

// ---------- Report PDF ----------
function reportPDF(d, S) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Sales Report' } });
  doc.font('Helvetica-Bold').fontSize(20).text(S.business_name || 'Business');
  doc.font('Helvetica').fontSize(11).fillColor('#555').text(`Sales Report: ${d.range.from} to ${d.range.to}`).moveDown(1);
  const kv = (k, v) => { const y = doc.y; doc.fillColor('#111').font('Helvetica').fontSize(10.5).text(k, 40, y, { width: 250 }).font('Helvetica-Bold').text(v, 300, y, { width: 255, align: 'right' }); doc.moveDown(0.3); };
  const r = d.range_stats;
  kv('Total revenue (net of returns)', 'Rs. ' + m(r.revenue)); kv('Returns / credit notes', 'Rs. ' + m(r.returns_total || 0)); kv('Orders', String(r.orders)); kv('Average order value', 'Rs. ' + m(r.avg_order));
  kv('Total discounts', 'Rs. ' + m(r.discounts)); kv('  of which automatic bill discounts', 'Rs. ' + m(r.bill_discounts || 0)); kv('Tax collected', 'Rs. ' + m(r.tax));
  kv('Paid orders / Unpaid-partial orders', `${r.paid_orders} / ${r.unpaid_orders}`); kv('Outstanding creditor balance', 'Rs. ' + m(d.outstanding));
  const table = (title, cols, rows) => {
    doc.moveDown(1).font('Helvetica-Bold').fontSize(12).fillColor('#1d4ed8').text(title).moveDown(0.3);
    const w = 515 / cols.length; const hdr = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111'); cols.forEach((c, i) => doc.text(c, 40 + i * w, hdr, { width: w - 4, align: i ? 'right' : 'left' }));
    doc.y = hdr + 14;
    rows.forEach(rw => { if (doc.y > 770) doc.addPage(); const y = doc.y; doc.font('Helvetica').fontSize(9); rw.forEach((c, i) => doc.text(String(c), 40 + i * w, y, { width: w - 4, align: i ? 'right' : 'left', lineBreak: false, ellipsis: true })); doc.y = y + 13; });
  };
  table('Payment methods', ['Method', 'Orders', 'Revenue'], d.payments.map(p => [p.method, p.orders, m(p.revenue)]));
  table('Best-selling products', ['Product', 'Qty', 'Revenue', 'Discount'], d.products.slice(0, 15).map(p => [p.name, q(p.qty), m(p.revenue), m(p.discount)]));
  table('Employee performance', ['Name', 'Role', 'Orders', 'Revenue', 'Discounts'], d.employees.map(e => [e.name, e.role, e.orders, m(e.revenue), m(e.discounts)]));
  table('Sales by day', ['Date', 'Orders', 'Revenue'], d.series.day.map(s => [s.label, s.orders, m(s.revenue)]));
  doc.end(); return doc;
}
module.exports = { invoicePDF, reportPDF };
