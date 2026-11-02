import { createStore } from 'zustand/vanilla';

export const appStore = createStore((set, get) => ({
  status: {},
  page: 'today',
  planDay: 'today',
  meetingEditor: false,
  selectedMeeting: null,
  meetingDraft: '',
  snoozeMinutes: 5,
  reflectionDraft: null,
  todayReflectionDraft: null,
  planDrafts: {},
  planBounds: {},
  dirtyInputs: new Set(),
  drag: null,
  error: null,
  pendingCommands: 0,
  pendingPlanKey: null,
  renderDeferred: false,
  setUI: patch => set(patch),
  setPage: page => set({ page }),
  selectPlanDay: planDay => set({ planDay }),
  savePlanDraft: (dayKey, draft) => set(state => ({ planDrafts: { ...state.planDrafts, [dayKey]: draft } })),
  savePlanBounds: (dayKey, bounds) => set(state => ({ planBounds: { ...state.planBounds, [dayKey]: bounds } })),
  clearPlanDraft: dayKey => set(state => {
    const planDrafts = { ...state.planDrafts };
    delete planDrafts[dayKey];
    return { planDrafts };
  }),
  deferRender: renderDeferred => set({ renderDeferred }),
  markDirty: id => set(state => ({ dirtyInputs: new Set([...state.dirtyInputs, id]) })),
  clearDirty: id => set(state => ({ dirtyInputs: id ? new Set([...state.dirtyInputs].filter(item => item !== id)) : new Set() })),
  receive: snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const previous = get().status;
    if (previous.publicationEpoch != null && snapshot.publicationEpoch != null &&
      (snapshot.publicationEpoch < previous.publicationEpoch ||
        (snapshot.publicationEpoch === previous.publicationEpoch && snapshot.publicationNumber <= previous.publicationNumber))) return false;
    const profileChanged = previous.profile && previous.profile !== snapshot.profile;
    const dayChanged = previous.todayKey && previous.todayKey !== snapshot.todayKey;
    set({ status: snapshot, page: snapshot.page || get().page,
      ...(dayChanged ? { todayReflectionDraft: null, dirtyInputs: new Set([...get().dirtyInputs].filter(id => id !== 'today-reflection-input')) } : {}),
      ...(profileChanged ? { planDay: 'today', planDrafts: {}, planBounds: {}, dirtyInputs: new Set(), reflectionDraft: null, todayReflectionDraft: null } : {}) });
    return true;
  },
  async refresh() { get().receive(await window.focusIslands.status()); },
  async command(name, value) {
    set(state => ({ pendingCommands: state.pendingCommands + 1, error: null }));
    try {
      const result = await window.focusIslands.action(name, value);
      if (result && typeof result === 'object' && 'phase' in result) get().receive(result);
      else await get().refresh();
      return result;
    } catch (error) {
      set({ error: error.message || String(error) });
      throw error;
    } finally {
      set(state => ({ pendingCommands: state.pendingCommands - 1 }));
    }
  },
}));
