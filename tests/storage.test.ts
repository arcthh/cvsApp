import { afterEach, describe, it, expect, vi } from "vitest";
import { initialState } from "../src/lib/seed";
import { demoTrip } from "../src/lib/legacy-demo";
import { localRepository, STORAGE_KEY } from "../src/services/storage";
afterEach(() => vi.unstubAllGlobals());
function saved(trips: ReturnType<typeof demoTrip>[]) {
  const data = { ...initialState(), trips };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === STORAGE_KEY ? JSON.stringify(data) : null,
  });
  return localRepository.load();
}
describe("empty startup and legacy sample cleanup", () => {
  it("starts with no sample trips, coupons, or rewards", () => {
    expect(initialState().trips).toEqual([]);
    expect(initialState().coupons).toEqual([]);
    expect(initialState().wallet).toEqual([]);
  });
  it("removes unchanged legacy sample trips", () => {
    expect(saved([demoTrip()]).trips).toEqual([]);
  });
  it("preserves renamed or customized trips", () => {
    const named = { ...demoTrip(), name: "My real trip" };
    const edited = demoTrip();
    edited.products[0].unitPrice = 899;
    expect(saved([named, edited]).trips).toHaveLength(2);
  });
  it("preserves completed history", () => {
    expect(saved([{ ...demoTrip(), status: "completed" }]).trips).toHaveLength(
      1,
    );
  });
});
