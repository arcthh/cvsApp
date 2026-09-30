import { tripSchema, type Trip, type AppState } from "./models";
import { today, uid } from "./money";

export const blankTrip = (): Trip =>
  tripSchema.parse({
    id: uid(),
    name: "New shopping trip",
    date: today(),
    startingExtraBucks: 0,
    products: [],
    coupons: [],
    groups: [],
    transactions: [],
    createdAt: new Date().toISOString(),
  });
export const initialState = (): AppState => ({
  version: 1,
  trips: [],
  coupons: [],
  wallet: [],
  beginner: true,
});
