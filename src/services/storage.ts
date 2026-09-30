import { stateSchema, type AppState } from "@/lib/models";
import { demoTrip } from "@/lib/legacy-demo";
import { initialState } from "@/lib/seed";
export const STORAGE_KEY = "cvsapp:v1";
// A repository boundary keeps localStorage out of UI/business services. Replace this
// interface with an authenticated API adapter when introducing a server database.
export interface StateRepository {
  load(): AppState;
  save(state: AppState): void;
}
export const localRepository: StateRepository = {
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const state = stateSchema.parse(JSON.parse(raw));
    const legacy = demoTrip();
    // Only remove untouched generated sample content, never renamed/customized trips
    // or completed records. Transaction ordering alone doesn't customize sample data.
    state.trips = state.trips.filter(
      (trip) =>
        !(
          trip.status === "planned" &&
          trip.name === legacy.name &&
          trip.notes === legacy.notes &&
          trip.startingExtraBucks === legacy.startingExtraBucks &&
          trip.taxRate === 0 &&
          trip.store === legacy.store &&
          trip.location === legacy.location &&
          JSON.stringify(trip.products) === JSON.stringify(legacy.products) &&
          JSON.stringify(trip.coupons) === JSON.stringify(legacy.coupons) &&
          JSON.stringify(trip.groups) === JSON.stringify(legacy.groups)
        ),
    );
    return state;
  },
  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSchema.parse(state)));
  },
};
