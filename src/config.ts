// Normalization constants from normalization.json
export const MAX_AMOUNT = 10000;
export const MAX_INSTALLMENTS = 12;
export const AMOUNT_VS_AVG_RATIO = 10;
export const MAX_MINUTES = 1440;
export const MAX_KM = 1000;
export const MAX_TX_COUNT_24H = 20;
export const MAX_MERCHANT_AVG_AMOUNT = 10000;

// MCC risk mapping from mcc_risk.json
export const MCC_RISK: Record<string, number> = {
  "5411": 0.15,
  "5812": 0.30,
  "5912": 0.20,
  "5944": 0.45,
  "7801": 0.80,
  "7802": 0.75,
  "7995": 0.85,
  "4511": 0.35,
  "5311": 0.25,
  "5999": 0.50,
};

// Quantization
export const QUANT_SCALE = 32000;
export const SENTINEL_FLOAT = -1.0;
export const SENTINEL_INT16 = -32000;

// KNN parameters
export const KNN_K = 5;
export const FRAUD_THRESHOLD = 0.6;

export const PROD_DIM_BINS: readonly [number, number][] = [
  [1, 128],
  [6, 32],
  [5, 8],
] as const;

// Binary format
export const MAGIC = 0x524e4232; // "RNB2"

export function clamp(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
