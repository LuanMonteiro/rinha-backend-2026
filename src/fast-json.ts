import {
  MCC_RISK,
  MAX_AMOUNT,
  MAX_INSTALLMENTS,
  AMOUNT_VS_AVG_RATIO,
  MAX_MINUTES,
  MAX_KM,
  MAX_TX_COUNT_24H,
  MAX_MERCHANT_AVG_AMOUNT,
} from "./config";

// Pré-convertidos como Buffer no load-time: zero alocações no hot path
const K_TRANS_AMOUNT = Buffer.from([34, 97, 109, 111, 117, 110, 116, 34, 58]); // '"amount":'
const K_TRANS_INST = Buffer.from([34, 105, 110, 115, 116, 97, 108, 108, 109, 101, 110, 116, 115, 34, 58]); // '"installments":'
const K_TRANS_REQ = Buffer.from([34, 114, 101, 113, 117, 101, 115, 116, 101, 100, 95, 97, 116, 34, 58, 34]); // '"requested_at":"'
const K_CUST_AVG = Buffer.from([34, 97, 118, 103, 95, 97, 109, 111, 117, 110, 116, 34, 58]); // '"avg_amount":'
const K_CUST_TX24 = Buffer.from([34, 116, 120, 95, 99, 111, 117, 110, 116, 95, 50, 52, 104, 34, 58]); // '"tx_count_24h":'
const K_CUST_KNOWN = Buffer.from([34, 107, 110, 111, 119, 110, 95, 109, 101, 114, 99, 104, 97, 110, 116, 115, 34, 58, 91]); // '"known_merchants":['
const K_MERCH_ID = Buffer.from([34, 105, 100, 34, 58, 34]); // '"id":"'
const K_MERCH_MCC = Buffer.from([34, 109, 99, 99, 34, 58, 34]); // '"mcc":"'
const K_MERCH_AVG = Buffer.from([34, 97, 118, 103, 95, 97, 109, 111, 117, 110, 116, 34, 58]); // '"avg_amount":'
const K_TERM_ONLINE = Buffer.from([34, 105, 115, 95, 111, 110, 108, 105, 110, 101, 34, 58]); // '"is_online":'
const K_TERM_PRESENT = Buffer.from([34, 99, 97, 114, 100, 95, 112, 114, 101, 115, 101, 110, 116, 34, 58]); // '"card_present":'
const K_TERM_KM_HOME = Buffer.from([34, 107, 109, 95, 102, 114, 111, 109, 95, 104, 111, 109, 101, 34, 58]); // '"km_from_home":'
const K_LAST_TX = Buffer.from([34, 108, 97, 115, 116, 95, 116, 114, 97, 110, 115, 97, 99, 116, 105, 111, 110, 34, 58]); // '"last_transaction":'
const K_LAST_TS = Buffer.from([34, 116, 105, 109, 101, 115, 116, 97, 109, 112, 34, 58, 34]); // '"timestamp":"'
const K_LAST_KM = Buffer.from([34, 107, 109, 95, 102, 114, 111, 109, 95, 99, 117, 114, 114, 101, 110, 116, 34, 58]); // '"km_from_current":'
const K_MERCHANT_OBJ = Buffer.from([34, 109, 101, 114, 99, 104, 97, 110, 116, 34, 58]); // '"merchant":'

function skipWhitespace(buf: Uint8Array, i: number): number {
  while (i < buf.length) {
    const c = buf[i];
    if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break;
    i++;
  }
  return i;
}

const pRes = { val: 0, end: 0 };
function parseNumber(buf: Uint8Array, start: number): void {
  let i = skipWhitespace(buf, start);
  let sign = 1;
  if (buf[i] === 45) {
    sign = -1;
    i++;
  }

  if (i >= buf.length || buf[i] < 48 || buf[i] > 57) {
    throw new Error("expected number");
  }

  let val = 0;
  while (i < buf.length && buf[i] >= 48 && buf[i] <= 57) {
    val = val * 10 + (buf[i] - 48);
    i++;
  }

  if (buf[i] === 46) {
    i++;
    if (i >= buf.length || buf[i] < 48 || buf[i] > 57) {
      throw new Error("expected fractional digits");
    }
    let frac = 0.1;
    while (i < buf.length && buf[i] >= 48 && buf[i] <= 57) {
      val += (buf[i] - 48) * frac;
      frac *= 0.1;
      i++;
    }
  }

  pRes.val = val * sign;
  pRes.end = i;
}

const MONTH_DAYS_BEFORE = new Int16Array([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]);

function twoDigits(buf: Uint8Array, i: number): number {
  return (buf[i] - 48) * 10 + (buf[i + 1] - 48);
}

function fourDigits(buf: Uint8Array, i: number): number {
  return (buf[i] - 48) * 1000 + (buf[i + 1] - 48) * 100 + (buf[i + 2] - 48) * 10 + (buf[i + 3] - 48);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysBeforeYear(year: number): number {
  const y = year - 1;
  return y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function isoUtcDayNumber(buf: Uint8Array, start: number): number {
  const year = fourDigits(buf, start);
  const month = twoDigits(buf, start + 5);
  const day = twoDigits(buf, start + 8);

  let days = daysBeforeYear(year) + MONTH_DAYS_BEFORE[month - 1] + day - 1;
  if (month > 2 && isLeapYear(year)) days++;

  return days;
}

function mccToNumber(buf: Uint8Array, start: number): number {
  if (start + 3 >= buf.length) throw new Error("invalid mcc");
  const a = buf[start] - 48;
  const b = buf[start + 1] - 48;
  const c = buf[start + 2] - 48;
  const d = buf[start + 3] - 48;
  if (a < 0 || a > 9 || b < 0 || b > 9 || c < 0 || c > 9 || d < 0 || d > 9) {
    throw new Error("invalid mcc");
  }
  return a * 1000 + b * 100 + c * 10 + d;
}

function bytesEqualRange(buf: Uint8Array, aStart: number, bStart: number, len: number): boolean {
  for (let i = 0; i < len; i++) {
    if (buf[aStart + i] !== buf[bStart + i]) return false;
  }
  return true;
}

export function asBufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function fastVectorizeAndQuantize(buf: Buffer, out: Int16Array): void {
  let p = 0;
  let norm = 0;

  // Transaction Amount
  p = buf.indexOf(K_TRANS_AMOUNT, p);
  if (p === -1) return;
  parseNumber(buf, p + K_TRANS_AMOUNT.length);
  const amount = pRes.val;
  norm = amount / MAX_AMOUNT;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[0] = (norm * 32000 + 0.5) | 0;
  p = pRes.end;

  // Installments
  p = buf.indexOf(K_TRANS_INST, p);
  if (p === -1) return;
  parseNumber(buf, p + K_TRANS_INST.length);
  norm = pRes.val / MAX_INSTALLMENTS;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[1] = (norm * 32000 + 0.5) | 0;
  p = pRes.end;

  // Requested At
  p = buf.indexOf(K_TRANS_REQ, p);
  if (p === -1) return;
  const reqAtPos = p + K_TRANS_REQ.length;
  const reqDayNum = isoUtcDayNumber(buf, reqAtPos);
  const reqHour = twoDigits(buf, reqAtPos + 11);
  const reqMinutes = reqDayNum * 1440 + reqHour * 60 + twoDigits(buf, reqAtPos + 14);
  
  norm = reqHour / 23;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[3] = (norm * 32000 + 0.5) | 0;
  
  norm = (reqDayNum % 7) / 6;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[4] = (norm * 32000 + 0.5) | 0;
  p = reqAtPos + 20;

  // Customer Avg
  p = buf.indexOf(K_CUST_AVG, p);
  if (p === -1) return;
  parseNumber(buf, p + K_CUST_AVG.length);
  const custAvg = pRes.val;
  norm = (amount / custAvg) / AMOUNT_VS_AVG_RATIO;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[2] = (norm * 32000 + 0.5) | 0;
  p = pRes.end;

  // TX 24h
  p = buf.indexOf(K_CUST_TX24, p);
  if (p === -1) return;
  parseNumber(buf, p + K_CUST_TX24.length);
  norm = pRes.val / MAX_TX_COUNT_24H;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[8] = (norm * 32000 + 0.5) | 0;
  const pAfterTx24 = pRes.end;

  // Merchant
  p = buf.indexOf(K_MERCHANT_OBJ, pAfterTx24);
  if (p === -1) return;
  p = buf.indexOf(K_MERCH_ID, p);
  const merchIdStart = p + K_MERCH_ID.length;
  const merchIdEnd = buf.indexOf(34, merchIdStart);
  const merchIdLen = merchIdEnd - merchIdStart;

  p = buf.indexOf(K_MERCH_MCC, merchIdEnd);
  const mcc = mccToNumber(buf, p + K_MERCH_MCC.length);
  norm = MCC_RISK[mcc] ?? 0.5;
  out[12] = (norm * 32000 + 0.5) | 0;

  p = buf.indexOf(K_MERCH_AVG, p);
  parseNumber(buf, p + K_MERCH_AVG.length);
  norm = pRes.val / MAX_MERCHANT_AVG_AMOUNT;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[13] = (norm * 32000 + 0.5) | 0;
  const pAfterMerch = pRes.end;

  // Known Merchants
  p = buf.indexOf(K_CUST_KNOWN, pAfterTx24);
  const knownStart = p + K_CUST_KNOWN.length;
  const pKnownEnd = buf.indexOf(93, p);
  let found = false;
  let i = knownStart;
  while (i < pKnownEnd) {
    if (buf[i] === 34) {
      const itemStart = i + 1;
      let itemEnd = itemStart;
      while (itemEnd < pKnownEnd && buf[itemEnd] !== 34) itemEnd++;
      if (itemEnd < pKnownEnd) {
        if (itemEnd - itemStart === merchIdLen && bytesEqualRange(buf, itemStart, merchIdStart, merchIdLen)) {
          found = true;
          break;
        }
        i = itemEnd + 1;
        continue;
      }
      break;
    }
    i++;
  }
  out[11] = found ? 0 : 32000;

  // Terminal
  p = buf.indexOf(K_TERM_ONLINE, pAfterMerch);
  out[9] = buf[p + K_TERM_ONLINE.length] === 116 ? 32000 : 0;
  p = buf.indexOf(K_TERM_PRESENT, p);
  out[10] = buf[p + K_TERM_PRESENT.length] === 116 ? 32000 : 0;
  p = buf.indexOf(K_TERM_KM_HOME, p);
  parseNumber(buf, p + K_TERM_KM_HOME.length);
  norm = pRes.val / MAX_KM;
  if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
  out[7] = (norm * 32000 + 0.5) | 0;
  const pAfterTerm = pRes.end;

  // Last Transaction
  p = buf.indexOf(K_LAST_TX, pAfterTerm);
  const lastTxValue = skipWhitespace(buf, p + K_LAST_TX.length);
  if (buf[lastTxValue] === 110) { // 'n' of null
    out[5] = -32000;
    out[6] = -32000;
  } else {
    p = buf.indexOf(K_LAST_TS, p);
    const lastDayNum = isoUtcDayNumber(buf, p + K_LAST_TS.length);
    const lastMinutes = lastDayNum * 1440 + twoDigits(buf, p + K_LAST_TS.length + 11) * 60 + twoDigits(buf, p + K_LAST_TS.length + 14);
    norm = (reqMinutes - lastMinutes) / MAX_MINUTES;
    if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
    out[5] = (norm * 32000 + 0.5) | 0;
    p = buf.indexOf(K_LAST_KM, p);
    parseNumber(buf, p + K_LAST_KM.length);
    norm = pRes.val / MAX_KM;
    if (norm > 1) norm = 1; else if (norm < 0) norm = 0;
    out[6] = (norm * 32000 + 0.5) | 0;
  }
}
