import { optimizeTrip } from "./optimizer";
import type { Trip, OptimizationMode } from "@/lib/models";
self.onmessage = (
  event: MessageEvent<{ trip: Trip; mode: OptimizationMode }>,
) => {
  try {
    self.postMessage({
      result: optimizeTrip(event.data.trip, event.data.mode),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Optimization failed.",
    });
  }
};
