import { describe, test, expect } from "bun:test";
import { vectorize, quantize, DIMS } from "../src/vectorizer";
import { SENTINEL_INT16, QUANT_SCALE } from "../src/config";
import type { TransactionPayload } from "../src/types";

const basePayload: TransactionPayload = {
  id: "tx-test",
  transaction: { amount: 100, installments: 1, requested_at: "2026-03-09T12:00:00Z" },
  customer: { avg_amount: 100, tx_count_24h: 1, known_merchants: ["MERC-001"] },
  merchant: { id: "MERC-001", mcc: "5411", avg_amount: 100 },
  terminal: { is_online: false, card_present: true, km_from_home: 10 },
  last_transaction: null,
};

describe("vectorizer", () => {
  test("produces 14 dimensions", () => {
    const buf = new Float64Array(DIMS);
    vectorize(basePayload, buf);
    expect(buf.length).toBe(14);
  });

  test("dim 0: amount normalized by 10000", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, amount: 5000 } }, buf);
    expect(buf[0]).toBeCloseTo(0.5, 6);
  });

  test("dim 0: amount clamped at 1.0", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, amount: 15000 } }, buf);
    expect(buf[0]).toBe(1.0);
  });

  test("dim 1: installments normalized by 12", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, installments: 6 } }, buf);
    expect(buf[1]).toBeCloseTo(0.5, 6);
  });

  test("dim 2: amount_vs_avg ratio", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      transaction: { ...basePayload.transaction, amount: 500 },
      customer: { ...basePayload.customer, avg_amount: 100 },
    }, buf);
    // (500/100)/10 = 0.5
    expect(buf[2]).toBeCloseTo(0.5, 6);
  });

  test("dim 2: amount_vs_avg clamped at 1.0", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      transaction: { ...basePayload.transaction, amount: 15000 },
      customer: { ...basePayload.customer, avg_amount: 100 },
    }, buf);
    // (15000/100)/10 = 15 → clamp to 1.0
    expect(buf[2]).toBe(1.0);
  });

  test("dim 3: hour_of_day / 23", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, requested_at: "2026-03-09T23:00:00Z" } }, buf);
    expect(buf[3]).toBeCloseTo(23 / 23, 6);
  });

  test("dim 4: day_of_week Monday=0", () => {
    const buf = new Float64Array(DIMS);
    // 2026-03-09 is a Monday
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, requested_at: "2026-03-09T12:00:00Z" } }, buf);
    expect(buf[4]).toBeCloseTo(0, 6);
  });

  test("dim 4: day_of_week Sunday=6/6=1.0", () => {
    const buf = new Float64Array(DIMS);
    // 2026-03-15 is a Sunday
    vectorize({ ...basePayload, transaction: { ...basePayload.transaction, requested_at: "2026-03-15T12:00:00Z" } }, buf);
    expect(buf[4]).toBeCloseTo(1.0, 6);
  });

  test("dim 5,6: sentinel -1 when last_transaction is null", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, last_transaction: null }, buf);
    expect(buf[5]).toBe(-1);
    expect(buf[6]).toBe(-1);
  });

  test("dim 5: minutes_since_last_tx normalized", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      transaction: { ...basePayload.transaction, requested_at: "2026-03-09T12:00:00Z" },
      last_transaction: { timestamp: "2026-03-09T00:00:00Z", km_from_current: 0 },
    }, buf);
    // 12 hours = 720 minutes, 720/1440 = 0.5
    expect(buf[5]).toBeCloseTo(0.5, 4);
  });

  test("dim 5: leap day boundary keeps UTC minute diff", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      transaction: { ...basePayload.transaction, requested_at: "2024-03-01T00:00:00Z" },
      last_transaction: { timestamp: "2024-02-29T23:00:00Z", km_from_current: 0 },
    }, buf);
    expect(buf[5]).toBeCloseTo(60 / 1440, 6);
  });

  test("dim 5: year boundary keeps UTC minute diff", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      transaction: { ...basePayload.transaction, requested_at: "2026-01-01T00:30:00Z" },
      last_transaction: { timestamp: "2025-12-31T23:30:00Z", km_from_current: 0 },
    }, buf);
    expect(buf[5]).toBeCloseTo(60 / 1440, 6);
  });

  test("dim 6: km_from_last_tx normalized", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      last_transaction: { timestamp: "2026-03-09T11:00:00Z", km_from_current: 500 },
    }, buf);
    expect(buf[6]).toBeCloseTo(0.5, 4);
  });

  test("dim 7: km_from_home normalized", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, terminal: { ...basePayload.terminal, km_from_home: 500 } }, buf);
    expect(buf[7]).toBeCloseTo(0.5, 4);
  });

  test("dim 8: tx_count_24h normalized", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, customer: { ...basePayload.customer, tx_count_24h: 10 } }, buf);
    expect(buf[8]).toBeCloseTo(0.5, 6);
  });

  test("dim 9: is_online", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, terminal: { ...basePayload.terminal, is_online: true } }, buf);
    expect(buf[9]).toBe(1);
  });

  test("dim 10: card_present", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, terminal: { ...basePayload.terminal, card_present: false } }, buf);
    expect(buf[10]).toBe(0);
  });

  test("dim 11: unknown_merchant when not in known list", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      merchant: { ...basePayload.merchant, id: "MERC-999" },
      customer: { ...basePayload.customer, known_merchants: ["MERC-001"] },
    }, buf);
    expect(buf[11]).toBe(1);
  });

  test("dim 11: known_merchant when in list", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      ...basePayload,
      merchant: { ...basePayload.merchant, id: "MERC-001" },
      customer: { ...basePayload.customer, known_merchants: ["MERC-001"] },
    }, buf);
    expect(buf[11]).toBe(0);
  });

  test("dim 12: mcc_risk from mapping", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, merchant: { ...basePayload.merchant, mcc: "7802" } }, buf);
    expect(buf[12]).toBe(0.75);
  });

  test("dim 12: mcc_risk default 0.5 for unknown mcc", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, merchant: { ...basePayload.merchant, mcc: "9999" } }, buf);
    expect(buf[12]).toBe(0.5);
  });

  test("dim 13: merchant_avg_amount normalized", () => {
    const buf = new Float64Array(DIMS);
    vectorize({ ...basePayload, merchant: { ...basePayload.merchant, avg_amount: 5000 } }, buf);
    expect(buf[13]).toBeCloseTo(0.5, 6);
  });
});

describe("documented example vectors", () => {
  test("tx-1329056812 (legit) matches expected vector", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      id: "tx-1329056812",
      transaction: { amount: 41.12, installments: 2, requested_at: "2026-03-11T18:45:53Z" },
      customer: { avg_amount: 82.24, tx_count_24h: 3, known_merchants: ["MERC-003", "MERC-016"] },
      merchant: { id: "MERC-016", mcc: "5411", avg_amount: 60.25 },
      terminal: { is_online: false, card_present: true, km_from_home: 29.2331036248 },
      last_transaction: null,
    }, buf);

    const expected = [0.0041, 0.1667, 0.05, 0.7826, 0.3333, -1, -1, 0.0292, 0.15, 0, 1, 0, 0.15, 0.006];
    for (let i = 0; i < DIMS; i++) {
      expect(buf[i]).toBeCloseTo(expected[i], 3);
    }
  });

  test("tx-3330991687 (fraud) matches expected vector", () => {
    const buf = new Float64Array(DIMS);
    vectorize({
      id: "tx-3330991687",
      transaction: { amount: 9505.97, installments: 10, requested_at: "2026-03-14T05:15:12Z" },
      customer: { avg_amount: 81.28, tx_count_24h: 20, known_merchants: ["MERC-008", "MERC-007", "MERC-005"] },
      merchant: { id: "MERC-068", mcc: "7802", avg_amount: 54.86 },
      terminal: { is_online: false, card_present: true, km_from_home: 952.27 },
      last_transaction: null,
    }, buf);

    const expected = [0.9506, 0.8333, 1.0, 0.2174, 0.8333, -1, -1, 0.9523, 1.0, 0, 1, 1, 0.75, 0.0055];
    for (let i = 0; i < DIMS; i++) {
      expect(buf[i]).toBeCloseTo(expected[i], 3);
    }
  });
});

describe("quantize", () => {
  test("quantizes normal values", () => {
    const floats = new Float64Array([0.5, 0.0, 1.0, 0.25]);
    const out = new Int16Array(4);
    quantize(floats, out);
    expect(out[0]).toBe(16000);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(32000);
    expect(out[3]).toBe(8000);
  });

  test("quantizes sentinel -1 to -32000", () => {
    const floats = new Float64Array([-1, 0.5, -1]);
    const out = new Int16Array(3);
    quantize(floats, out);
    expect(out[0]).toBe(SENTINEL_INT16);
    expect(out[1]).toBe(16000);
    expect(out[2]).toBe(SENTINEL_INT16);
  });
});
