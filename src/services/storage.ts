import { stateSchema, type AppState } from "@/lib/models";
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
    return raw ? stateSchema.parse(JSON.parse(raw)) : initialState();
  },
  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSchema.parse(state)));
  },
};
