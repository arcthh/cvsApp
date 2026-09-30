import { describe, it, expect } from "vitest";
import {
  productSchema,
  couponSchema,
  dealGroupSchema,
  tripSchema,
} from "../src/lib/models";
import {
  calculateTrip,
  calculateBOGODiscount,
} from "../src/services/calculations";
import { optimizeTrip, candidateBlocks } from "../src/services/optimizer";
import { toCents } from "../src/lib/money";
const p = (id: string, price: number, quantity = 1) =>
  productSchema.parse({ id, name: id, unitPrice: price, quantity });
const trip = (overrides: Record<string, unknown> = {}) =>
  tripSchema.parse({
    id: "trip",
    name: "Test",
    date: "2026-09-30",
    startingExtraBucks: 0,
    products: [p("a", 1000)],
    coupons: [],
    groups: [],
    transactions: [{ id: "t", name: "A", productIds: ["a"] }],
    createdAt: "2026-09-30",
    ...overrides,
  });
describe("cent-safe calculations", () => {
  it("converts decimals without float truncation", () => {
    expect(toCents("1.01")).toBe(101);
    expect(() => toCents("-1")).toThrow();
    expect(() => toCents("1.001")).toThrow();
  });
  it("handles zero EB", () => {
    expect(calculateTrip(trip()).oop).toBe(1000);
  });
  it("caps EB, preserves change and never covers tax", () => {
    const c = calculateTrip(trip({ startingExtraBucks: 2000, taxRate: 8.25 }));
    expect(c.oop).toBe(83);
    expect(c.extraBucksUsed).toBe(1000);
    expect(c.endingExtraBucks).toBe(1000);
  });
  it("handles BOGO 40% and 50% with uneven unit count", () => {
    expect(calculateBOGODiscount([p("a", 469, 2)], 40)).toBe(188);
    expect(calculateBOGODiscount([p("a", 379, 3)], 50)).toBe(190);
  });
  it("discounts the lower price in a mixed BOGO pair", () => {
    expect(calculateBOGODiscount([p("a", 900), p("b", 500)], 50)).toBe(250);
  });
  it("rejects unmet threshold coupons", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "$5 off $30",
      type: "crt",
      value: 500,
      minimumSpend: 3000,
      quantity: 1,
    });
    const r = calculateTrip(trip({ coupons: [c] }));
    expect(r.oop).toBe(1000);
    expect(r.warnings.join()).toContain("threshold");
  });
  it("earns spend $25 get $8 only when qualified", () => {
    const g = dealGroupSchema.parse({
      id: "g",
      name: "Laundry",
      productIds: ["a"],
      minimumSpend: 2500,
      extraBucksReward: 800,
    });
    expect(
      calculateTrip(trip({ products: [p("a", 2597)], groups: [g] }))
        .extraBucksEarned,
    ).toBe(800);
    expect(
      calculateTrip(trip({ products: [p("a", 2499)], groups: [g] }))
        .extraBucksEarned,
    ).toBe(0);
  });
  it("does not spend the rewards earned by the same transaction", () => {
    const g = dealGroupSchema.parse({
      id: "g",
      name: "Reward",
      productIds: ["a"],
      extraBucksReward: 700,
    });
    expect(calculateTrip(trip({ groups: [g] })).oop).toBe(1000);
  });
  it("never discounts unrelated products or creates negative OOP", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "Big coupon",
      type: "dollar",
      value: 9000,
      productIds: ["a"],
      quantity: 1,
    });
    const r = calculateTrip(
      trip({
        products: [p("a", 100), p("b", 500)],
        transactions: [{ id: "t", name: "T", productIds: ["a", "b"] }],
        coupons: [c],
      }),
    );
    expect(r.oop).toBe(500);
  });
  it("ignores expired coupons", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "Expired",
      type: "dollar",
      value: 500,
      quantity: 1,
      expirationDate: "2026-09-29",
    });
    expect(calculateTrip(trip({ coupons: [c] })).oop).toBe(1000);
  });
  it("blocks duplicate products and locked group splits", () => {
    const g = dealGroupSchema.parse({
      id: "g",
      name: "Locked",
      productIds: ["a", "b"],
    });
    const t = trip({
      products: [p("a", 1000), p("b", 1000)],
      groups: [g],
      transactions: [
        { id: "1", name: "A", productIds: ["a"] },
        { id: "2", name: "B", productIds: ["b"] },
      ],
    });
    expect(calculateTrip(t).errors.join()).toContain("must stay together");
  });
  it("prevents manufacturer coupons occupying the same unit", () => {
    const coupons = ["1", "2"].map((id) =>
      couponSchema.parse({
        id,
        name: id,
        type: "manufacturer",
        stackingClass: "manufacturer",
        value: 500,
        quantity: 1,
        productIds: ["a"],
      }),
    );
    const c = calculateTrip(trip({ coupons }));
    expect(c.oop).toBe(500);
    expect(c.warnings.join()).toContain("stacking conflict");
  });
  it("checks thresholds after coupons when configured", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "Discount",
      type: "dollar",
      value: 500,
      quantity: 1,
    });
    const g = dealGroupSchema.parse({
      id: "g",
      name: "Deal",
      productIds: ["a"],
      minimumSpend: 1000,
      thresholdBasis: "after-coupons",
      extraBucksReward: 800,
    });
    expect(
      calculateTrip(trip({ coupons: [c], groups: [g] })).extraBucksEarned,
    ).toBe(0);
  });
  it("blocks EB on excluded products", () => {
    const a = { ...p("a", 1000), rewardEligible: false };
    expect(
      calculateTrip(trip({ products: [a], startingExtraBucks: 900 })).oop,
    ).toBe(1000);
  });
});
describe("optimizer", () => {
  const fixture = () =>
    trip({
      startingExtraBucks: 900,
      products: [p("poise", 898), p("soap", 568), p("laundry", 2597)],
      groups: [
        dealGroupSchema.parse({
          id: "p",
          name: "Poise",
          productIds: ["poise"],
          extraBucksReward: 700,
        }),
        dealGroupSchema.parse({
          id: "s",
          name: "Soap",
          productIds: ["soap"],
          extraBucksReward: 300,
        }),
        dealGroupSchema.parse({
          id: "l",
          name: "Laundry",
          productIds: ["laundry"],
          extraBucksReward: 800,
        }),
      ],
      transactions: [
        { id: "s", name: "Soap", productIds: ["soap"] },
        { id: "l", name: "Laundry", productIds: ["laundry"] },
        { id: "p", name: "Poise", productIds: ["poise"] },
      ],
    });
  it("improves order and rolls multiple rewards", () => {
    const t = fixture(),
      r = optimizeTrip(t);
    expect(r.calculation.oop).toBeLessThan(calculateTrip(t).oop);
    expect(r.calculation.extraBucksEarned).toBe(1800);
    expect(r.calculation.errors).toEqual([]);
    expect(r.exact).toBe(true);
  });
  it("minimizes leftover EB while preserving rewards", () => {
    const t = fixture(),
      r = optimizeTrip(t, "min-leftover");
    expect(r.calculation.endingExtraBucks).toBe(432);
    expect(
      r.calculation.transactions.every(
        (x) => x.oop >= 0 && x.endingExtraBucks >= 0,
      ),
    ).toBe(true);
  });
  it("merges overlapping locks transitively", () => {
    const t = trip({
      products: [p("a", 100), p("b", 100), p("c", 100)],
      groups: [
        dealGroupSchema.parse({ id: "1", name: "1", productIds: ["a", "b"] }),
        dealGroupSchema.parse({ id: "2", name: "2", productIds: ["b", "c"] }),
      ],
    });
    expect(candidateBlocks(t)).toHaveLength(1);
  });
  it("handles empty trips", () => {
    expect(
      optimizeTrip(trip({ products: [], transactions: [] })).calculation.oop,
    ).toBe(0);
  });
});

describe("planner refinements", () => {
  it("splits independent quantities to reduce the largest payment", () => {
    const result = optimizeTrip(
      trip({ products: [p("a", 1000, 3)] }),
      "lowest-individual",
    );
    expect(result.products).toHaveLength(3);
    expect(result.calculation.oop).toBe(3000);
    expect(Math.max(...result.calculation.transactions.map((t) => t.oop))).toBe(
      1000,
    );
  });
  it("does not split quantities protected by a coupon", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "$3 off 2",
      type: "dollar",
      value: 300,
      quantity: 1,
      minimumQuantity: 2,
      productIds: ["a"],
    });
    expect(
      optimizeTrip(
        trip({ products: [p("a", 1000, 3)], coupons: [c] }),
        "lowest-individual",
      ).products,
    ).toHaveLength(1);
  });
  it("keeps allocated product totals consistent with the transaction", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "Shared",
      type: "dollar",
      value: 300,
      quantity: 1,
    });
    const result = calculateTrip(
      trip({
        startingExtraBucks: 800,
        products: [p("a", 500), p("b", 600)],
        coupons: [c],
        transactions: [{ id: "t", name: "t", productIds: ["a", "b"] }],
      }),
    );
    expect(
      result.transactions[0].productCosts.reduce(
        (s, p) => s + p.afterCoupons,
        0,
      ),
    ).toBe(800);
    expect(
      result.transactions[0].productCosts.reduce(
        (s, p) => s + p.afterExtraBucks,
        0,
      ),
    ).toBe(0);
  });
  it("does not treat normal coupon consumption as a later warning", () => {
    const c = couponSchema.parse({
      id: "c",
      name: "One use",
      type: "dollar",
      value: 100,
      quantity: 1,
    });
    const result = calculateTrip(
      trip({
        products: [p("a", 500), p("b", 500)],
        coupons: [c],
        transactions: [
          { id: "a", name: "a", productIds: ["a"] },
          { id: "b", name: "b", productIds: ["b"] },
        ],
      }),
    );
    expect(result.oop).toBe(900);
    expect(result.warnings).toEqual([]);
  });
});
