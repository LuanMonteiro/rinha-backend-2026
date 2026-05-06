import { describe, expect, test } from "bun:test";
import { BodyResponseCache, hashBody } from "../src/body-response-cache";

describe("BodyResponseCache", () => {
  test("returns cached response for identical bytes", () => {
    const cache = new BodyResponseCache(8);
    const body = new TextEncoder().encode('{"id":"a"}');

    expect(cache.get(body)).toBeUndefined();
    cache.set(body, "A");
    expect(cache.get(body)).toBe("A");
    expect(cache.get(new TextEncoder().encode('{"id":"a"}'))).toBe("A");
  });

  test("does not treat different bytes as a hit", () => {
    const cache = new BodyResponseCache(8);
    cache.set(new TextEncoder().encode('{"id":"a"}'), "A");
    expect(cache.get(new TextEncoder().encode('{"id":"b"}'))).toBeUndefined();
  });

  test("evicts oldest entries when max size is exceeded", () => {
    const enc = new TextEncoder();
    const cache = new BodyResponseCache(2);
    cache.set(enc.encode("a"), "A");
    cache.set(enc.encode("b"), "B");
    cache.set(enc.encode("c"), "C");

    expect(cache.size()).toBe(2);
    expect(cache.get(enc.encode("a"))).toBeUndefined();
    expect(cache.get(enc.encode("b"))).toBe("B");
    expect(cache.get(enc.encode("c"))).toBe("C");
  });

  test("hash is deterministic", () => {
    const enc = new TextEncoder();
    expect(hashBody(enc.encode("same"))).toBe(hashBody(enc.encode("same")));
  });
});
