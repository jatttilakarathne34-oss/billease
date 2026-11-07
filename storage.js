'use strict';
// File storage for product photos and the business logo.
//  - BLOB_READ_WRITE_TOKEN present  -> Vercel Blob (PUBLIC store), files served from Vercel's CDN
//  - otherwise                      -> PostgreSQL table "images", served by /api/images/:id
const crypto = require('crypto');
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const blob = () => require('@vercel/blob');
function sniff(b) { // decide the type from the file's real bytes, never from the header the client sent
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
async function saveImage(D, buf, folder) {
  const type = sniff(buf);
  if (useBlob()) {
    const r = await blob().put(`${folder}/${Date.now()}.${EXT[type]}`, buf, { access: 'public', addRandomSuffix: true, contentType: type, token: process.env.BLOB_READ_WRITE_TOKEN });
    return { url: r.url, driver: 'blob' };
  }
  const id = crypto.randomBytes(16).toString('hex');
  await D.run('INSERT INTO images(id,content_type,data,size) VALUES(@id,@t,@d,@s)', { id, t: type, d: buf, s: buf.length });
  return { url: '/api/images/' + id, driver: 'db' };
}
async function removeImage(D, url) { // best effort; never blocks the request
  try {
    if (!url) return;
    if (url.startsWith('/api/images/')) await D.run('DELETE FROM images WHERE id=@id', { id: url.slice(12) });
    else if (BLOB_URL.test(url) && useBlob()) await blob().del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (e) { console.error('[removeImage]', e.message); }
}
const logoCache = new Map();
async function imageBytes(D, v) { // used to place the logo on PDF invoices
  try {
    if (!v) return null;
    if (v.startsWith('/api/images/')) { const r = await D.get('SELECT data FROM images WHERE id=@id', { id: v.slice(12) }); return r ? Buffer.from(r.data) : null; }
    if (BLOB_URL.test(v)) {
      if (logoCache.has(v)) return logoCache.get(v);
      const r = await fetch(v, { signal: AbortSignal.timeout(4000) }); if (!r.ok) return null;
      const b = Buffer.from(await r.arrayBuffer()); if (logoCache.size > 20) logoCache.clear(); logoCache.set(v, b); return b;
    }
  } catch (e) { console.error('[imageBytes]', e.message); }
  return null;
}
module.exports = { sniff, saveImage, removeImage, imageBytes, useBlob, BLOB_URL };
