import { describe, expect, it } from "vitest";
import { assertSafeTestUrl } from "./test-db";

describe("assertSafeTestUrl", () => {
  it("aceita banco _test local", () => {
    expect(() => assertSafeTestUrl("postgresql://postgres:postgres@localhost:54329/ecomerce_test")).not.toThrow();
    expect(() => assertSafeTestUrl("postgresql://u:p@127.0.0.1:5432/x_test")).not.toThrow();
  });
  it("rejeita host remoto", () => {
    expect(() => assertSafeTestUrl("postgresql://u:p@db.prod.com:5432/ecomerce_test")).toThrow(/insegura/);
  });
  it("rejeita banco sem _test", () => {
    expect(() => assertSafeTestUrl("postgresql://u:p@localhost:5432/ecomerce")).toThrow(/insegura/);
  });
});
