/*
 * IDPlus (Enmity) — SafeMinimal build
 * - Never touches Enmity UI components in Settings.
 * - Uses only plain React/ReactNative ("View", "Text", "TouchableOpacity", "TextInput").
 * - Clipboard rewrite is OFF until you tap "Start".
 * - If TextInput isn't available on your build, it still won't crash (just shows read-only).
 */

(function () {
  const get = (obj, path, dflt) => {
    try { return path.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj) ?? dflt; }
    catch { return dflt; }
  };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const deepClone = (x) => { try { return JSON.parse(JSON.stringify(x)); } catch { return x; } };

  const api = {
    enmity()      { return get(window, "enmity", {}); },
    register(fn)  { return get(window, "enmity.plugins.registerPlugin", null)?.(fn); },
    patcher()     { return get(window, "enmity.patcher", null); },
    settings()    { return get(window, "enmity.settings", null); },
    toasts()      { return get(window, "enmity.modules.common.Toasts", null); },
    clipboard()   { return get(window, "enmity.modules.common.Clipboard", null); },
    react()       { return get(window, "enmity.modules.common.React", null); },
    rn()          { return get(window, "enmity.modules.common.ReactNative", null); },
    showToast(msg){ try { this.toasts()?.open?.({ content: String(msg), source: "ic_warning_24px" }); } catch {} }
  };

  const meta = {
    name: "IDPlus (SafeMinimal)",
    id:   "idplus.safe.minimal",
    version: "1.0.0",
    description: "Crash-proof settings (plain RN). Clipboard rewrite starts only after Start.",
    authors: [{ name: "you" }]
  };

  // Runtime state (in-memory)
  const state = {
    running: false,
    _patcher: null,
    storeKey: "idplus.safe.minimal"
  };

  // Defaults for settings
  const defaults = {
    enabled: true,         // apply rewriting after Start
    startDelayMs: 600,     // wait a bit before patching
    mappings: [
      // { oldId: "1335468449299955742", newId: "1335468449299955741" }
    ]
  };

  // Settings store (Enmity) with fallback memory store
  function getStore() {
    const s = api.settings()?.makeStore?.(state.storeKey);
    if (!s) {
      // fallback store if Enmity settings are unavailable
      if (!state.localStore) state.localStore = deepClone(defaults);
      return {
        get: (k, d) => (k in state.localStore ? state.localStore[k] : d),
        set: (k, v) => { state.localStore[k] = v; }
      };
    }
    if (typeof s.get("enabled") !== "boolean") s.set("enabled", defaults.enabled);
    if (typeof s.get("startDelayMs") !== "number") s.set("startDelayMs", defaults.startDelayMs);
    if (!Array.isArray(s.get("mappings"))) s.set("mappings", deepClone(defaults.mappings));
    return s;
  }

  // ---------- Rewriter ----------
  const SNOWFLAKE_RE = /^\d{17,21}$/;
  function buildIdMap(store) {
    const m = new Map();
    (store.get("mappings") || []).forEach(it => {
      if (it?.oldId && it?.newId) m.set(String(it.oldId), String(it.newId));
    });
    return m;
  }
  function mapId(id, m) {
    const k = String(id ?? "");
    return m.get(k) ?? k;
  }
  function rewriteOneDiscordUrl(u, idMap) {
    try {
      const url = new URL(String(u));
      const host = (url.hostname || "").toLowerCase();
      if (!/^(?:www\.|ptb\.|canary\.)?discord\.com$/.test(host)) return u;
      const parts = (url.pathname || "").split("/").filter(Boolean);
      if (parts[0] === "channels") {
        if (parts[1]) parts[1] = mapId(parts[1], idMap);
        if (parts[2]) parts[2] = mapId(parts[2], idMap);
        if (parts[3]) parts[3] = mapId(parts[3], idMap);
      } else if (parts[0] === "users" && parts[1]) {
        parts[1] = mapId(parts[1], idMap);
      } else if (parts[0] === "guilds" && parts[1]) {
        parts[1] = mapId(parts[1], idMap);
      }
      url.pathname = "/" + parts.join("/");
      return url.toString();
    } catch { return u; }
  }
  function rewriteDiscordUrlsInText(text, idMap) {
    return String(text).replace(
      /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/[^\s)]+/g,
      (m) => rewriteOneDiscordUrl(m, idMap)
    );
  }
  function processClipboardText(text, store) {
    const map = buildIdMap(store);
    const raw = String(text ?? "");
    const t = raw.trim();
    if (!t) return raw;
    if (SNOWFLAKE_RE.test(t)) return mapId(t, map);
    return rewriteDiscordUrlsInText(raw, map);
  }

  // ---------- Patching flow ----------
  async function startPatches() {
    if (state.running) { api.showToast("IDPlus: already running"); return; }
    const s = getStore();
    const delayMs = Number(s.get("startDelayMs") || 0);
    if (delayMs > 0) await delay(delayMs);

    const patcherFactory = api.patcher();
    const patcher = patcherFactory?.create?.(meta.id);
    if (!patcher) { api.showToast("IDPlus: patcher not available"); return; }

    const clip = api.clipboard();
    if (!clip?.setString) { api.showToast("IDPlus: Clipboard module missing"); return; }

    try {
      patcher.before(clip, "setString", (args) => {
        try {
          if (!args?.length) return;
          if (!getStore().get("enabled")) return;
          args[0] = processClipboardText(args[0], getStore());
        } catch {}
      });
      state._patcher = patcher;
      state.running = true;
      api.showToast("IDPlus: clipboard rewrite active");
    } catch (e) {
      api.showToast("IDPlus: failed to patch");
    }
  }

  function stopPatches() {
    try { state._patcher?.unpatchAll?.(); } catch {}
    state._patcher = null;
    state.running = false;
    api.showToast("IDPlus: patches stopped");
  }

  // ---------- Ultra-safe Settings (plain RN only) ----------
  function SettingsPanel() {
    const React = api.react();
    const RN    = api.rn();
    if (!React || !RN) return null;

    const el  = React.createElement;
    const { View, Text, TouchableOpacity, TextInput, ScrollView } = RN;

    const s = getStore();
    const mappings = s.get("mappings") || [];
    const enabled = !!s.get("enabled");
    const startDelayMs = Number(s.get("startDelayMs") || 0);

    const Btn = (title, onPress, danger) =>
      el(TouchableOpacity, {
        onPress,
        style: {
          backgroundColor: danger ? "rgba(255,80,80,0.35)" : "rgba(123,92,255,0.35)",
          paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginTop: 8, alignSelf: "flex-start"
        }
      }, el(Text, { style: { fontWeight: "600" } }, title));

    const Input = (value, onChangeText, placeholder) =>
      TextInput
        ? el(TextInput, {
            style: { padding: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 8 },
            value: String(value ?? ""),
            placeholder: String(placeholder ?? ""),
            onChangeText, autoCapitalize: "none"
          })
        : el(Text, null, String(value ?? "")); // fallback, no crash

    const MapRow = (item, idx) => el(View, { key: item.id || idx, style: { marginBottom: 12 } },
      el(Text, { style: { opacity: 0.8, marginBottom: 4 } }, "Old ID"),
      Input(item.oldId, (v) => {
        const arr = mappings.slice(); arr[idx] = { ...arr[idx], oldId: v }; s.set("mappings", arr);
      }, "old snowflake"),
      el(Text, { style: { opacity: 0.8, marginTop: 8, marginBottom: 4 } }, "New ID"),
      Input(item.newId, (v) => {
        const arr = mappings.slice(); arr[idx] = { ...arr[idx], newId: v }; s.set("mappings", arr);
      }, "new snowflake"),
      Btn("Delete", () => {
        const arr = mappings.slice(); arr.splice(idx, 1); s.set("mappings", arr);
      }, true)
    );

    return el(ScrollView, { contentContainerStyle: { padding: 12 } },
      el(Text, { style: { fontSize: 18, fontWeight: "700", marginBottom: 10 } }, "IDPlus — SafeMinimal"),

      el(Text, { style: { marginTop: 6 } }, "Enable after Start"),
      Btn(enabled ? "Enabled ✓ (tap to disable)" : "Disabled ✗ (tap to enable)", () => s.set("enabled", !s.get("enabled"))),

      el(Text, { style: { marginTop: 14 } }, "Start delay (ms)"),
      Input(startDelayMs, (v) => s.set("startDelayMs", Number(v || 0)), "e.g. 600"),

      el(View, { style: { flexDirection: "row", gap: 10, marginTop: 10 } },
        Btn("Start", startPatches),
        Btn("Stop",  stopPatches, true)
      ),

      el(View, { style: { height: 1, backgroundColor: "rgba(255,255,255,0.15)", marginVertical: 16 } }),

      el(Text, { style: { fontSize: 16, fontWeight: "600", marginBottom: 8 } }, "ID Mappings"),
      ...mappings.map(MapRow),
      Btn("Add mapping", () => {
        const arr = mappings.slice(); arr.push({ id: "row-" + Date.now(), oldId: "", newId: "" });
        s.set("mappings", arr);
      })
    );
  }

  // ---------- Register ----------
  const register = api.register.bind(api);
  if (register) {
    register({
      name: meta.name,
      onStart() { api.showToast("IDPlus SafeMinimal loaded — open settings."); },
      onStop()  { stopPatches(); },
      getSettingsPanel() { return SettingsPanel(); }
    });
  } else {
    // Fallback for builds that expect CommonJS export
    const React = api.react();
    module.exports = {
      name: meta.name,
      onStart() { api.showToast("IDPlus SafeMinimal loaded — open settings."); },
      onStop()  { stopPatches(); },
      getSettingsPanel() { return SettingsPanel(React); }
    };
  }
})();
