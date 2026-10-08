/* =========================================================
   Utilitas server: error HTTP, id, validasi, tanggal
   ========================================================= */

const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* Bungkus handler async agar error otomatis diteruskan ke error handler */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function assert(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}

/* Id berprefiks, mis. U3F9A12C04B (huruf besar + angka) */
function makeId(prefix) {
  return `${prefix}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

/* ---------- Validasi ---------- */

const str = (value) => (typeof value === 'string' ? value.trim() : '');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const oneOf = (value, list) => list.includes(value);

/* ---------- Tanggal & waktu (mengikuti APP_TIMEZONE) ---------- */

function zoneParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const todayISO = () => zoneParts().date;
const nowHHMM = () => zoneParts().time;

/* Geser tanggal ISO sebanyak n hari (aman terhadap zona waktu) */
function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

module.exports = {
  HttpError, asyncHandler, assert, makeId,
  str, isValidDate, oneOf, HHMM,
  todayISO, nowHHMM, shiftISO
};

/* Susun klausa SET dinamis dari objek { kolom: nilai }. Nilai undefined dilewati. */
function buildSet(fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  return {
    sql: entries.map(([column]) => `${column} = ?`).join(', '),
    params: entries.map(([, value]) => value),
    empty: entries.length === 0
  };
}

module.exports.buildSet = buildSet;
