import { loadDataset } from "./loader";
import { asBufferView, fastVectorizeAndQuantize } from "./fast-json";
import { resolveStrategy, runStrategy, type SearchStrategy } from "./search/strategy-runner";
import { buildGridV2, type GridIndexV2 } from "./grid-v2";
import { FRAUD_THRESHOLD } from "./config";
import type { LoadedDataset } from "./types";
import { unlinkSync, chmodSync } from "fs";
import { BodyResponseCache } from "./body-response-cache";

let ready = false;
let ds: LoadedDataset;
let grid: GridIndexV2 | null = null;

// Pre-allocated buffers for zero-allocation hot path
const int16Buf = new Int16Array(14);

const strategy: SearchStrategy = resolveStrategy(process.env.SEARCH_STRATEGY);

const RESPONSE_HEADERS = { "Content-Type": "application/json" };
const FRAUD_SCORES = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
const PREBUILT_STRINGS = FRAUD_SCORES.map(
  (fraudScore) => `{"approved":${fraudScore < FRAUD_THRESHOLD},"fraud_score":${fraudScore}}`,
);

const RESPONSE_INIT = { headers: RESPONSE_HEADERS };
const responseCache = new BodyResponseCache(Number(process.env.RESPONSE_CACHE_MAX || 4096));


const socketPath = process.env.API_SOCKET;
if (socketPath) {
  try {
    unlinkSync(socketPath);
  } catch (e) { }
}

const serverOpts: any = {
  port: socketPath ? undefined : (Number(process.env.BACKEND_PORT) || 9998),
  unix: socketPath || undefined,
  async fetch(req: Request) {
    const url = req.url;
    const pathIdx = url.lastIndexOf("/");
    const path = url.slice(pathIdx);

    if (path === "/fraud-score" && req.method === "POST") {
      if (!ready) return new Response("not ready", { status: 503 });

      const body = await req.bytes();
      const cached = responseCache.get(body);
      if (cached !== undefined) {
        return new Response(cached, RESPONSE_INIT);
      }

      fastVectorizeAndQuantize(asBufferView(body), int16Buf);
      const fraudCount = runStrategy(strategy, int16Buf, ds, grid);
      const responseBody = PREBUILT_STRINGS[fraudCount];
      responseCache.set(body, responseBody);

      return new Response(responseBody, RESPONSE_INIT);
    }

    if (path === "/ready") {
      return new Response(ready ? "ok" : "not ready", { status: ready ? 200 : 503 });
    }

    return new Response("not found", { status: 404 });
  },
};
// Startup
ds = loadDataset();

const dimBins = new Map<number, number>();
dimBins.set(0, 16);  // amount
dimBins.set(12, 8);  // mcc_risk (muito seletivo)
dimBins.set(6, 8);   // km_from_current

const gridStart = performance.now();
grid = strategy === "S0" ? null : buildGridV2(ds, dimBins);
console.log(`Grid built in ${(performance.now() - gridStart).toFixed(0)}ms`);

const server = Bun.serve(serverOpts);
if (socketPath) {
  try {
    chmodSync(socketPath, 0o666);
  } catch (e) {
    console.error("Failed to chmod socket:", e);
  }
}

ready = true;
console.log(`API server starting on ${socketPath ? "socket " + socketPath : "port " + server.port}...`);
console.log("Ready to serve requests");
