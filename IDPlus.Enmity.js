/*
 * IDPlus (Enmity) — Zero-touch Safe Bootstrap
 * Purpose: never crash Enmity; only patch after you press "Start" in Settings.
 * Scope: Clipboard rewrite only (IDs & discord.com links). Extend later once stable.
 *
 * Why this won’t crash:
 * - No top-level grabs of window.enmity.modules/common/components.
 * - All module lookups happen inside onStart or when you press Start.
 * - Every call is guarded and wrapped in try/catch.
 * - If a module isn’t found, we show a toast and skip the patch.
 */

(function () {
  // Small helpers (safe & local)
  const get = (obj, path, dflt) => {
    try {
      return path.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj) ?? dflt;
    } catch { return dflt; }
  };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const deepClone = (x) => { try { return JSON.parse(JSON.stringify(x)); } catch { return x; } };

  // Thin wrappers we only call inside lifecycle methods
  const api = {
    enmity() { return get(window, "enmity", {}); },
    modules() { return get(window, "enmity.modules", {}); },
    common() { return get(window, "enmity.modules.common", {}); },
    comps() { return get(window, "enmity.components", {}); },
    settings() { return get(window, "enmity.settings", {}); },
    patcher() { return get(window, "enmity.patcher", null); },
    toasts() { return get(window, "enmity.modules.common.Toasts", null); },
    clipboard() { return get(window, "enmity.modules.common.Clipboard", null); },
    getByProps(...p) { return get(window, "enmity.modules.getByProps", () => null)(...p); },
    showToast(msg) { try { this.toasts()?.open?.({ content: String(msg), source: "ic_warning_24px" }); } catch {} }
  };

  // Plugin identity (Enmity expects this struct)
  const meta = {
    name: "IDPlus (Safe Bootstrap)",
    id: "idplus.safe.bootstrap",
    version: "1.0.0",
    description: "Safe bootstrap plugin: enable clipboard rewrite only after you press Start.",
    authors: [{ name: "you" }]
  };

  // Runtime state (kept in memory; Enmity keeps the module while enabled)
  const state = {
    running: false,
    unpatched: false,
    storeKey: "idplus.safe.bootstrap",
    defaults: {
      enabledOnStartPress: true,
      startDelayMs: 600,
      mappings: [
        // Example:
        // { oldId: "1335468449299955742", newId: "1335468449299955741" }
      ]
    }
  };

  // Settings store using Enmity’s settings API (lazy; won’t crash if absent)
  function getStore() {
    const s = api.settings()?.makeStore?.(state.storeKey);
    if (!s) return {
      get: (k, d) => state.localStore?.[k] ?? d,
      set: (k, v) => { (state.localStore ||= {}); state.localStore[k] = v; }
    };
    if (!Array.isArray(s.get("mappings"))) s.set("mappings", deepClone(state.defaults.mappings));
    if (typeof s.get("enabledOnStartPress") !== "boolean") s.set("enabledOnStartPress", !!state.defaults.enabledOnStartPress);
    if (typeof s.get("startDelayMs") !== "number") s.set("startDelayMs", state.defaults.startDelayMs);
    return s;
  }

  // ID/URL processing
  const SNOWFLAKE_RE = /^\d{17,21}$/;
  function buildIdMap(store) {
    const m = new Map();
    const arr = store.get("mappings") || [];
    for (const it of arr) {
      if (it?.oldId && it?.newId) m.set(String(it.oldId), String(it.newId));
    }
    return m;
  }
  function mapId(id, map) {
    const k = String(id ?? "");
    return map.get(k) ?? k;
  }
  function rewriteOneDiscordUrl(u, idMap) {
    try {
      const url = new URL(String(u));
      const host = String(url.hostname || "").toLowerCase();
      if (!/^(?:www\.|ptb\.|canary\.)?discord\.com$/.test(host)) return u;
      const parts = (url.pathname || "").split("/").filter(Boolean);
      if (parts[0] === "channels") {
        if (parts[1]) parts[1] = mapId(parts[1], idMap); // guild
        if (parts[2]) parts[2] = mapId(parts[2], idMap); // channel
        if (parts[3]) parts[3] = mapId(parts[3], idMap); // message
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
    const idMap = buildIdMap(store);
    const raw = String(text ?? "");
    const t = raw.trim();
    if (!t) return raw;
    if (SNOWFLAKE_RE.test(t)) return mapId(t, idMap);
    return rewriteDiscordUrlsInText(raw, idMap);
  }

  // Patching — only after pressing Start
  async function startPatches() {
    if (state.running) { api.showToast("IDPlus: already running"); return; }
    state.running = true;

    const store = getStore();
    const delayMs = Number(store.get("startDelayMs") || 0);
    if (delayMs > 0) await delay(delayMs);

    const patcher = api.patcher()?.create?.(meta.id);
    if (!patcher) { api.showToast("IDPlus: patcher not available"); state.running = false; return; }

    const Clipboard = api.clipboard();
    if (!Clipboard?.setString) {
      api.showToast("IDPlus: Clipboard module not found; skipping");
      state.running = false;
      return;
    }

    try {
      patcher.before(Clipboard, "setString", (args) => {
        try {
          if (!Array.isArray(args) || !args.length) return;
          const s = getStore();
          if (!s.get("enabledOnStartPress")) return;
          args[0] = processClipboardText(args[0], s);
        } catch {}
      });
    } catch {}

    // Remember patcher so we can unpatch later
    state._patcher = patcher;
    api.showToast("IDPlus: clipboard rewrite active");
  }

  function stopPatches() {
    try { state._patcher?.unpatchAll?.(); } catch {}
    state._patcher = null;
    state.running = false;
    state.unpatched = true;
    api.showToast("IDPlus: patches stopped");
  }

  // Settings UI (safe, no top-level module grabs)
  function SettingsPanel() {
    const React = get(window, "enmity.modules.common.React", {});
    const create = (...a) => React.createElement ? React.createElement(...a) : null;

    const FormRow      = get(window, "enmity.components.FormRow", null);
    const FormSection  = get(window, "enmity.components.FormSection", null);
    const FormSwitch   = get(window, "enmity.components.FormSwitch", null);
    const FormDivider  = get(window, "enmity.components.FormDivider", null);
    const Button       = get(window, "enmity.components.Button", null);
    const ScrollView   = get(window, "enmity.components.ScrollView", null);
    const View         = get(window, "enmity.components.View", null);
    const RNTextInput  = get(window, "enmity.modules.common.ReactNative.TextInput", null);

    const s = getStore();
    const mappings = s.get("mappings") || [];
    const enabled = !!s.get("enabledOnStartPress");
    const startDelayMs = Number(s.get("startDelayMs") || 0);

    const Row = (props) => FormRow ? create(FormRow, props) : create("div", {}, JSON.stringify(props));
    const Section = (props) => FormSection ? create(FormSection, props) : create("div", {}, props.children);
    const Switch = (p) => FormSwitch ? create(FormSwitch, p) : create("div", {}, p.value ? "ON" : "OFF");
    const Div = () => FormDivider ? create(FormDivider) : create("hr");
    const Btn = (p) => Button ? create(Button, p) : create("button", { onClick: p.onPress }, p.text || p.title);
    const Input = (p) => RNTextInput
      ? create(RNTextInput, { style: { padding: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 8 }, autoCapitalize: "none", ...p })
      : create("input", { value: p.value, onChange: (e) => p.onChangeText?.(e.target.value), placeholder: p.placeholder });

    const onAdd = () => {
      const arr = mappings.slice();
      arr.push({ id: "row-" + Date.now(), oldId: "", newId: "" });
      s.set("mappings", arr);
    };
    const onDel = (idx) => {
      const arr = mappings.slice();
      arr.splice(idx, 1);
      s.set("mappings", arr);
    };
    const setMap = (idx, patch) => {
      const arr = mappings.slice();
      arr[idx] = { ...arr[idx], ...patch };
      s.set("mappings", arr);
    };

    const content =
      create(Section, { title: "Controls" },
        create(Row, {
          label: "Enable on Start",
          trailing: create(Switch, {
            value: enabled,
            onValueChange: (v) => s.set("enabledOnStartPress", !!v)
          })
        }),
        create(Row, {
          label: "Start delay (ms)",
          trailing: Input({
            value: String(startDelayMs),
            placeholder: "e.g. 600",
            onChangeText: (v) => s.set("startDelayMs", Number(v || 0))
          })
        }),
        create(View, { style: { flexDirection: "row", gap: 8 } },
          create(Btn, { text: "Start", onPress: startPatches }),
          create(Btn, { text: "Stop",  onPress: stopPatches, color: "red" })
        ),
        create(Div)
      );

    const mapsUI = create(Section, { title: "ID mappings" },
      ...mappings.map((m, i) =>
        create(View, { key: m.id || i, style: { marginBottom: 10, gap: 6 } },
          create(Row, {
            label: "Old ID",
            trailing: Input({
              value: String(m.oldId ?? ""),
              placeholder: "old snowflake",
              onChangeText: (v) => setMap(i, { oldId: v })
            })
          }),
          create(Row, {
            label: "New ID",
            trailing: Input({
              value: String(m.newId ?? ""),
              placeholder: "new snowflake",
              onChangeText: (v) => setMap(i, { newId: v })
            })
          }),
          create(Btn, { text: "Delete", onPress: () => onDel(i), color: "red" })
        )
      ),
      create(Btn, { text: "Add mapping", onPress: onAdd })
    );

    const body = create(View || "div", { style: { padding: 12 } }, content, mapsUI);

    return ScrollView ? create(ScrollView, null, body) : body;
  }

  // Register with Enmity (don’t touch modules at top-level)
  const register = get(window, "enmity.plugins.registerPlugin", null);
  if (!register) {
    // As a last resort, export CommonJS style in case your build expects it
    module.exports = {
      name: meta.name,
      onStart() {},
      onStop() { stopPatches(); },
      getSettingsPanel() { return SettingsPanel(); }
    };
    return;
  }

  register({
    name: meta.name,
    onStart() {
      // Do nothing here except maybe a tiny toast; no module touching required
      api.showToast("IDPlus Safe Bootstrap loaded — open settings to Start.");
    },
    onStop() {
      stopPatches();
    },
    getSettingsPanel() {
      return SettingsPanel();
    }
  });
})();
