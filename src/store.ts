import { create } from "zustand";
import { driver, errorMessage, type ListFieldsResult, type OpenResult } from "./api/driver";

export type View = "browser" | "changes" | "nilReport";

interface EditorState {
  filePath: string | null;
  openInfo: OpenResult | null;
  loadingOpen: boolean;

  filterPath: string;
  filterType: string;
  page: number;
  listResult: ListFieldsResult | null;
  loadingList: boolean;

  pendingCount: number;
  view: View;
  selectedIndex: number | null;
  error: string | null;

  openFile: (path: string, scripts?: string[]) => Promise<void>;
  closeFile: () => Promise<void>;
  refreshList: () => Promise<void>;
  setFilterPath: (value: string) => void;
  setFilterType: (value: string) => void;
  setPage: (page: number) => void;
  selectField: (index: number | null) => void;
  refreshPendingCount: () => Promise<void>;
  setView: (view: View) => void;
  setError: (message: string | null) => void;
  /** Se llama cuando set_field devuelve structuralRebuild:true: cualquier
   * indice de campo emitido antes queda invalido (ver plan §2), asi que hay
   * que cerrar el detalle y re-pedir la pagina actual desde cero. */
  onStructuralRebuild: (newFieldCount: number) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  filePath: null,
  openInfo: null,
  loadingOpen: false,

  filterPath: "",
  filterType: "",
  page: 0,
  listResult: null,
  loadingList: false,

  pendingCount: 0,
  view: "browser",
  selectedIndex: null,
  error: null,

  async openFile(path, scripts = []) {
    set({ loadingOpen: true, error: null });
    try {
      const info = await driver.openSave(path, scripts, true, 150);
      set({
        filePath: path,
        openInfo: info,
        loadingOpen: false,
        filterPath: "",
        filterType: "",
        page: 0,
        pendingCount: 0,
        selectedIndex: null,
        view: "browser",
      });
      await get().refreshList();
    } catch (e) {
      set({ loadingOpen: false, error: errorMessage(e) });
    }
  },

  async closeFile() {
    try {
      await driver.closeSave();
    } finally {
      set({
        filePath: null,
        openInfo: null,
        listResult: null,
        pendingCount: 0,
        selectedIndex: null,
        filterPath: "",
        filterType: "",
        page: 0,
      });
    }
  },

  async refreshList() {
    const { filterPath, filterType, page } = get();
    set({ loadingList: true });
    try {
      const result = await driver.listFields(filterPath, filterType || null, page);
      set({ listResult: result, pendingCount: result.pendingCount, loadingList: false });
    } catch (e) {
      set({ loadingList: false, error: errorMessage(e) });
    }
  },

  setFilterPath(value) {
    set({ filterPath: value, page: 0 });
    void get().refreshList();
  },

  setFilterType(value) {
    set({ filterType: value, page: 0 });
    void get().refreshList();
  },

  setPage(page) {
    set({ page });
    void get().refreshList();
  },

  selectField(index) {
    set({ selectedIndex: index });
  },

  async refreshPendingCount() {
    try {
      const result = await driver.listChanges();
      set({ pendingCount: result.count });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  setView(view) {
    set({ view });
  },

  setError(message) {
    set({ error: message });
  },

  async onStructuralRebuild(newFieldCount) {
    set((state) => ({
      selectedIndex: null,
      openInfo: state.openInfo ? { ...state.openInfo, fieldCount: newFieldCount } : state.openInfo,
    }));
    await get().refreshList();
  },
}));
