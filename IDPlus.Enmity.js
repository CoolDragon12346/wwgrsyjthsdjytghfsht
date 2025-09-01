/* IDPlus (Enmity) — Clipboard ID/URL Rewriter
 * Style: matches the "window.enmity" plugin example you shared.
 * Features:
 *  - Rewrites copied Discord IDs and discord.com links according to mappings.
 *  - Simple Settings UI to manage mappings and an enable/disable toggle.
 *
 * Notes:
 *  - Safe minimal surface: only hooks Clipboard.setString (no dispatcher or link builders).
 *  - If Clipboard module is missing on your build, we fail gracefully.
 */

/* ===== Shortcuts from your example style ===== */
const o = Object.assign((...e) => window.enmity.modules.common.React.createElement(...e), window.enmity.modules.common.React);
function V(e) { window.enmity.plugins.registerPlugin(e); }
function O(e) { return window.enmity.patcher.create(e); }
function D(...e) { return window.enmity.modules.getByProps(...e); }
function H(...e) { return window.enmity.modules.getByName(...e); }

/* Common modules (guarded) */
const Common   = window.enmity.modules.common || {};
const U        = Common.React;
const vDialog  = Common.Dialog;
const E        = Common.Linking;
const F        = Common.StyleSheet;
const Clipboard= Common.Clipboard;

/* UI components (same pull pattern as example) */
const { components: t } = window.enmity;
const h  = t.Button;
const K  = t.FormDivider;
const J  = t.FormRow;
const q  = t.FormSection;
const Q  = t.FormSwitch;
const d  = t.View;
const z  = t.ScrollView;
const TextPrim = D("Text")?.Text || (() => null);

/* Assets helper (optional) */
function f(name) {
  const id = window.enmity.assets.getIDByName(name);
  if (typeof id === "undefined") throw new Error(`Asset '${name}' is undefined`);
  return id;
}

/* ===== Manifest-ish info (same pattern as example) ===== */
const meta = {
  id: "idplus-clipboard",
  manifest: {
    name: "IDPlus (Clipboard)",
    version: "1.0.0",
    description: "Rewrite Discord IDs and links on copy using your mappings.",
    authors: [{ name: "you" }]
  },
  git: { url: "https://github.com/your/repo", branch: "main" }
};
const r = Object.assign(meta.manifest, { name: meta.id });

/* ===== Minimal styles ===== */
const styles = F.createThemedStyleSheet({
  sectionPad: { paddingBottom: 6 },
  input: { padding: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 8 },
  rowBox: { marginBottom: 10, gap: 6 },
});

/* ===== Settings store (same style as example) ===== */
function makeStore(key) { return window.enmity.settings.makeStore(key); }
const store = makeStore(r.name);

/* Defaults */
if (!Array.isArray(store.get("mappings"))) {
  store.set("mappings", [
    // { oldId: "1335468449299955742", newId: "1335468449299955741" }
  ]);
}
if (typeof store.get("enabled") !== "boolean") store.set("enabled", true);

/* ===== Helper logic ===== */
const SNOWFLAKE_RE = /^\d{17,21}$/;

function buildIdMap() {
  const map = new Map();
  for (const item of store.get("mappings") || []) {
    if (item?.oldId && item?.newId) map.set(String(item.oldId), String(item.newId));
  }
  return map;
}

function mapId(id, map) {
  const key = String(id ?? "");
  return map.get(key) ?? key;
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
  } catch {
    return u;
  }
}

function rewriteDiscordUrlsInText(text, idMap) {
  return String(text).replace(
    /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/[^\s)]+/g,
    (m) => rewriteOneDiscordUrl(m, idMap)
  );
}

function processClipboardText(text) {
  const idMap = buildIdMap();
  const raw = String(text ?? "");
  const t = raw.trim();
  if (!t) return raw;
  if (SNOWFLAKE_RE.test(t)) return mapId(t, idMap);
  return rewriteDiscordUrlsInText(raw, idMap);
}

/* ===== Patch (Clipboard only) ===== */
const I = O(r.name); // patcher instance
let unpatched = false;

function patchClipboard() {
  if (!Clipboard?.setString) {
    // No clipboard module found; show a dialog (non-fatal)
    vDialog?.show?.({
      title: "IDPlus",
      body: "Clipboard module not available on this build. Clipboard rewrite disabled.",
      confirmText: "OK"
    });
    return;
  }

  I.before(Clipboard, "setString", (args) => {
    try {
      if (!store.get("enabled")) return;
      if (!args?.length) return;
      args[0] = processClipboardText(args[0]);
    } catch (e) {
      // swallow errors so we never crash
    }
  });
}

/* ===== Settings UI ===== */
const RN = window.enmity.modules.common?.ReactNative || window.enmity.modules.common;
const TextInput = RN?.TextInput || (() => null);

function TextLabel({ children }) {
  return o(TextPrim || "Text", { style: { opacity: 0.9 } }, children);
}

function MappingRow({ idx, item }) {
  const valOld = String(item?.oldId ?? "");
  const valNew = String(item?.newId ?? "");

  return o(d, { style: styles.rowBox },
    o(J, {
      label: "Old ID",
      trailing: o(TextInput, {
        style: styles.input,
        value: valOld,
        placeholder: "old snowflake",
        onChangeText: (v) => {
          const arr = (store.get("mappings") || []).slice();
          arr[idx] = { ...arr[idx], oldId: v };
          store.set("mappings", arr);
        },
        autoCapitalize: "none"
      })
    }),
    o(J, {
      label: "New ID",
      trailing: o(TextInput, {
        style: styles.input,
        value: valNew,
        placeholder: "new snowflake",
        onChangeText: (v) => {
          const arr = (store.get("mappings") || []).slice();
          arr[idx] = { ...arr[idx], newId: v };
          store.set("mappings", arr);
        },
        autoCapitalize: "none"
      })
    }),
    o(h, {
      text: "Delete",
      color: "red",
      onPress: () => {
        const arr = (store.get("mappings") || []).slice();
        arr.splice(idx, 1);
        store.set("mappings", arr);
      }
    })
  );
}

function SettingsPanel() {
  const enabled = !!store.get("enabled");
  const mappings = store.get("mappings") || [];

  return o(q, { title: "IDPlus (Clipboard)" },
    o(J, {
      label: "Enabled",
      trailing: o(Q, {
        value: enabled,
        onValueChange: (v) => store.set("enabled", !!v)
      })
    }),
    o(K, null),
    o(q, { title: "Mappings", style: styles.sectionPad },
      ...mappings.map((m, i) => o(MappingRow, { key: m.id || i, idx: i, item: m })),
      o(h, {
        text: "Add Mapping",
        onPress: () => {
          const arr = (store.get("mappings") || []).slice();
          arr.push({ id: "row-" + Date.now(), oldId: "", newId: "" });
          store.set("mappings", arr);
        }
      })
    )
  );
}

/* ===== Register plugin (same flow as example) ===== */
let started = false;

V({
  ...r,
  onStart() {
    if (started) return;
    started = true;
    patchClipboard();
  },
  onStop() {
    if (unpatched) return;
    try { I.unpatchAll(); } catch {}
    unpatched = true;
  },
  getSettingsPanel() {
    return o(z, null, o(SettingsPanel, null));
  }
});
