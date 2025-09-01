/*
 * IDPlus (Enmity) — crash-hardened single file
 * Features:
 *  - Clipboard rewrite (IDs & discord.com links)
 *  - Incoming message rewrite (IDs in text, embeds, references)
 *  - Username changer (author remap)
 *  - Message inject/send (guild channels or DMs; auto-creates DM)
 *  - Link builder remap (pre-clipboard ID mapping)
 *  - Robust guards, feature toggles, and safe fallbacks
 */

function safeRequire(path) { try { return require(path); } catch { return null; } }
function deepClone(obj) { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } }
const log  = (...a) => { try { console.log("[IDPlus]", ...a); } catch {} };
const warn = (...a) => { try { console.warn("[IDPlus]", ...a); } catch {} };

/* Enmity APIs */
const PluginsMgr = safeRequire("enmity/managers/plugins") || {};
const registerPlugin = PluginsMgr.registerPlugin;
const PatcherFactory = safeRequire("enmity/patcher");
const Patcher = PatcherFactory ? PatcherFactory.create("idplus-enmity") : { before(){}, unpatchAll(){} };

const Mods = safeRequire("enmity/modules") || {};
const { getByProps, find } = Mods;

const MetroCommon = safeRequire("enmity/metro/common") || {};
const { React, FluxDispatcher, Toasts } = MetroCommon || {};
const toast = (t) => { try { Toasts?.open?.({ content: t, source: "ic_warning_24px" }); } catch {} };

/* React Native */
const RN = safeRequire("react-native") || {};
const { ScrollView = () => null, View = () => null, Text = () => null, TouchableOpacity = () => null, TextInput = () => null } = RN;

/* Defaults / Store */
const defaults = {
  replacements: [
    {
      id: "message-content-1406759724975652874",
      olduserid: "1335468449299955742",
      newuserid: "1335468449299955741",
      username: "vl",
      newUsername: "Emaytee",
      oldUserTag: "cooldragon12346",
      userTag: "emaytee42"
    }
  ],
  quick: {
    mode: "inject",   // "inject" | "send"
    channelId: "",
    dmUserId: "",
    content: "Hello from IDPlus (Enmity)!",
    embed: { title: "", description: "", url: "", thumbnail: "" }
  },
  features: {
    clipboard: true,
    dispatcher: true,
    linkBuilders: true
  }
};
// In-memory persistence while plugin stays loaded. (Simple & robust)
let store = globalThis.__IDPLUS_STORE__ ? deepClone(globalThis.__IDPLUS_STORE__) : deepClone(defaults);
function save(partial) { store = { ...store, ...partial }; globalThis.__IDPLUS_STORE__ = deepClone(store); }

/* Helpers */
const SNOWFLAKE_RE = /^\d{17,21}$/;

function buildIdMap() {
  const m = new Map();
  for (const r of store.replacements || []) {
    if (r?.olduserid && r?.newuserid) m.set(String(r.olduserid), String(r.newuserid));
  }
  return m;
}
function mapId(id, m) {
  const k = String(id ?? "");
  return m.get(k) ?? k;
}
function rewriteOneDiscordUrl(u, idMap) {
  try {
    // URL may not exist in some hermes builds; guard with try/catch
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
function processText(text, idMap) {
  const raw = String(text ?? "");
  const t = raw.trim();
  if (!t) return raw;
  if (SNOWFLAKE_RE.test(t)) return mapId(t, idMap);
  return rewriteDiscordUrlsInText(raw, idMap);
}

/* Message transforms */
function remapAuthor(author, idMap) {
  if (!author) return;
  if (author.id) author.id = mapId(author.id, idMap);
  for (const r of store.replacements || []) {
    if (r.newUsername) {
      if (r.olduserid && String(author.id) === mapId(String(r.olduserid), idMap)) {
        author.username = String(r.newUsername);
        if (author.global_name) author.global_name = String(r.newUsername);
      } else if (r.username && author.username === r.username) {
        author.username = String(r.newUsername);
        if (author.global_name) author.global_name = String(r.newUsername);
      }
    }
    if (r.oldUserTag && r.userTag && author.discriminator === r.oldUserTag) {
      author.discriminator = String(r.userTag);
    }
  }
}
function remapMessage(msg, idMap) {
  if (!msg) return;
  if (typeof msg.content === "string") msg.content = processText(msg.content, idMap);

  if (Array.isArray(msg.mentions)) {
    for (const m of msg.mentions) if (m?.id) m.id = mapId(m.id, idMap);
  }
  if (msg.message_reference) {
    const ref = msg.message_reference;
    if (ref.guild_id) ref.guild_id = mapId(ref.guild_id, idMap);
    if (ref.channel_id) ref.channel_id = mapId(ref.channel_id, idMap);
    if (ref.message_id) ref.message_id = mapId(ref.message_id, idMap);
  }
  if (Array.isArray(msg.embeds)) {
    for (const e of msg.embeds) {
      if (e?.title) e.title = rewriteDiscordUrlsInText(e.title, idMap);
      if (e?.description) e.description = rewriteDiscordUrlsInText(e.description, idMap);
      if (e?.url) e.url = rewriteOneDiscordUrl(e.url, idMap);
    }
  }
}

/* Async util */
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForModule(propNames, timeoutMs = 8000, step = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const mod = getByProps?.(...propNames);
    if (mod) return mod;
    await delay(step);
  }
  return null;
}

/* Patches */
let unpatches = [];

async function tryPatchClipboard() {
  if (!store.features.clipboard) return;
  try {
    const Clipboard = await waitForModule(["setString", "getString"]);
    if (!Clipboard) throw new Error("Clipboard module not found");
    unpatches.push(
      Patcher.before(Clipboard, "setString", (args) => {
        try {
          if (!args?.length) return;
          args[0] = processText(args[0], buildIdMap());
        } catch (e) { warn("clipboard rewrite error", e); }
      })
    );
    log("clipboard patched");
  } catch (e) { toast("IDPlus: Clipboard patch skipped"); warn(e); }
}

async function tryPatchLinkBuilders() {
  if (!store.features.linkBuilders) return;
  try {
    const builder = find?.((m) => {
      for (const k in m) {
        if (typeof m[k] === "function") {
          const s = String(m[k]);
          if (s.includes("discord.com") && s.includes("/channels/")) return true;
        }
      }
      return false;
    });
    if (!builder) throw new Error("No link builder module");
    Object.keys(builder).forEach((key) => {
      if (typeof builder[key] !== "function") return;
      unpatches.push(
        Patcher.before(builder, key, (args) => {
          try {
            const idMap = buildIdMap();
            if (args.length === 3) {
              args[0] = mapId(args[0], idMap);
              args[1] = mapId(args[1], idMap);
              args[2] = mapId(args[2], idMap);
            } else if (args.length === 1 && args[0] && typeof args[0] === "object") {
              const o = args[0];
              if ("guildId" in o)   o.guildId   = mapId(o.guildId, idMap);
              if ("channelId" in o) o.channelId = mapId(o.channelId, idMap);
              if ("messageId" in o) o.messageId = mapId(o.messageId, idMap);
              if ("userId" in o)    o.userId    = mapId(o.userId, idMap);
            }
          } catch (e) { warn("link builder patch error", e); }
        })
      );
    });
    log("link builders patched");
  } catch (e) { toast("IDPlus: Link patch skipped"); warn(e); }
}

async function tryPatchDispatcher() {
  if (!store.features.dispatcher) return;
  try {
    if (!FluxDispatcher?.dispatch) throw new Error("FluxDispatcher missing");
    unpatches.push(
      Patcher.before(FluxDispatcher, "dispatch", (args) => {
        try {
          const action = args?.[0];
          if (!action || !action.type) return;

          const idMap = buildIdMap();

          if (action.type === "MESSAGE_CREATE" || action.type === "MESSAGE_UPDATE") {
            const msg = action.message || action.messageRecord;
            if (!msg) return;
            remapAuthor(msg.author, idMap);
            remapMessage(msg, idMap);
          }
          if (action.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(action.messages)) {
            for (const m of action.messages) {
              remapAuthor(m.author, idMap);
              remapMessage(m, idMap);
            }
          }
        } catch (e) { warn("dispatcher transform error", e); }
      })
    );
    log("dispatcher patched");
  } catch (e) { toast("IDPlus: Dispatcher patch skipped"); warn(e); }
}

/* DM/channel helpers + send/inject */
async function ensureDmChannel(userId) {
  const DMs = await waitForModule(["getDMFromUserId", "getChannel"]);
  const HTTP = await waitForModule(["get", "post", "put", "del", "patch"]);
  const existing = DMs?.getDMFromUserId?.(userId);
  if (existing) return existing;
  const res = await HTTP?.post?.({ url: "/users/@me/channels", body: { recipient_id: userId } });
  const id = res?.body?.id;
  if (!id) throw new Error("Create DM failed");
  return id;
}
async function normalizeTarget({ channelId, dmUserId }) {
  if (channelId) return String(channelId);
  if (dmUserId) return await ensureDmChannel(String(dmUserId));
  throw new Error("Provide channelId or dmUserId");
}
async function injectMessage({ channelId, dmUserId, content, embed }) {
  const MessageActions = await waitForModule(["sendMessage", "receiveMessage"]);
  const target = await normalizeTarget({ channelId, dmUserId });
  const nowIso = new Date().toISOString();

  const embeds = (embed && (embed.title || embed.description || embed.url || embed.thumbnail)) ? [{
    type: "rich",
    title: embed.title || undefined,
    description: embed.description || undefined,
    url: embed.url || undefined,
    thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
  }] : [];

  const fake = {
    id: String(Date.now()),
    type: 0,
    content: String(content ?? ""),
    channel_id: target,
    author: { id: "0", username: "IDPlus", discriminator: "0000", bot: true },
    embeds,
    timestamp: nowIso
  };
  MessageActions?.receiveMessage?.(target, fake);
  toast("Injected (local)");
}
async function sendMessage({ channelId, dmUserId, content, embed }) {
  const MessageActions = await waitForModule(["sendMessage", "receiveMessage"]);
  const target = await normalizeTarget({ channelId, dmUserId });
  const message = {
    content: String(content ?? ""),
    invalidEmojis: [],
    tts: false,
    allowed_mentions: { parse: ["users", "roles", "everyone"] }
  };
  if (embed && (embed.title || embed.description || embed.url || embed.thumbnail)) {
    message.embed = {
      type: "rich",
      title: embed.title || undefined,
      description: embed.description || undefined,
      url: embed.url || undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
    };
  }
  await MessageActions?.sendMessage?.(target, message);
  toast("Sent");
}

/* Settings UI (inline) */
function Btn({ title, onPress }) {
  return React.createElement(TouchableOpacity, {
    onPress,
    style: {
      backgroundColor: "rgba(123,92,255,0.35)",
      paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginTop: 8, alignSelf: "flex-start"
    }
  }, React.createElement(Text, { style: { fontWeight: "600" } }, String(title)));
}
function Row({ label, right }) {
  const Form = getByProps?.("FormRow", "FormSection", "FormSwitch");
  return React.createElement(Form?.FormRow || View, { label: String(label) }, right || null);
}
function Section({ title, children }) {
  const Form = getByProps?.("FormRow", "FormSection", "FormSwitch", "FormDivider");
  return React.createElement(Form?.FormSection || View, { title: String(title) }, children);
}
function Divider() {
  const Form = getByProps?.("FormDivider");
  return React.createElement(Form?.FormDivider || View, null);
}
function Toggle({ value, onValueChange }) {
  const Form = getByProps?.("FormSwitch");
  return React.createElement(Form?.FormSwitch || View, { value: !!value, onValueChange: (v)=>onValueChange(!!v) });
}
function input(value, placeholder, onChangeText) {
  return React.createElement(TextInput, {
    style: { padding: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 8 },
    value: String(value ?? ""), placeholder: String(placeholder ?? ""), onChangeText, autoCapitalize: "none"
  });
}

function Settings() {
  const [, rerender] = React.useReducer(x => x + 1, 0);
  const s = store;

  const setPath = (path, val) => {
    const root = deepClone(s);
    const parts = path.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts.at(-1)] = val;
    save(root);
    rerender();
  };

  const feats = s.features || { clipboard: true, dispatcher: true, linkBuilders: true };
  const q = s.quick || { mode: "inject", channelId: "", dmUserId: "", content: "", embed: {} };
  const reps = Array.isArray(s.replacements) ? s.replacements : [];

  return React.createElement(ScrollView, { style: { padding: 12 } },

    React.createElement(Section, { title: "Features" },
      React.createElement(Row, { label: "Clipboard rewrite", right: React.createElement(Toggle, { value: feats.clipboard, onValueChange: v => setPath("features.clipboard", v) }) }),
      React.createElement(Row, { label: "Dispatcher (message/username)", right: React.createElement(Toggle, { value: feats.dispatcher, onValueChange: v => setPath("features.dispatcher", v) }) }),
      React.createElement(Row, { label: "Link builders (pre-clipboard)", right: React.createElement(Toggle, { value: feats.linkBuilders, onValueChange: v => setPath("features.linkBuilders", v) }) }),
      React.createElement(Divider, null)
    ),

    React.createElement(Section, { title: "Quick Actions" },
      React.createElement(Row, { label: "Mode (inject/send)", right: input(q.mode, "inject | send", v => setPath("quick.mode", v)) }),
      React.createElement(Row, { label: "Channel ID",        right: input(q.channelId, "123...", v => setPath("quick.channelId", v)) }),
      React.createElement(Row, { label: "DM User ID",        right: input(q.dmUserId, "123...", v => setPath("quick.dmUserId", v)) }),
      React.createElement(Row, { label: "Content",           right: input(q.content, "Message text", v => setPath("quick.content", v)) }),
      React.createElement(Row, { label: "Embed Title",       right: input(q.embed?.title, "Title", v => setPath("quick.embed.title", v)) }),
      React.createElement(Row, { label: "Embed Description", right: input(q.embed?.description, "Description", v => setPath("quick.embed.description", v)) }),
      React.createElement(Row, { label: "Embed URL",         right: input(q.embed?.url, "https://...", v => setPath("quick.embed.url", v)) }),
      React.createElement(Row, { label: "Embed Thumbnail",   right: input(q.embed?.thumbnail, "https://...", v => setPath("quick.embed.thumbnail", v)) }),
      React.createElement(View, { style: { flexDirection: "row", gap: 8 } },
        React.createElement(Btn, { title: "Save", onPress: () => { save(s); toast("Saved."); } }),
        React.createElement(Btn, { title: (q.mode || "inject") === "send" ? "Send" : "Inject", onPress: async () => {
          try {
            const payload = {
              channelId: (store.quick.channelId || "").trim() || undefined,
              dmUserId:  (store.quick.dmUserId  || "").trim() || undefined,
              content:   store.quick.content || "",
              embed:     store.quick.embed   || {}
            };
            if ((store.quick.mode || "inject") === "send") await sendMessage(payload);
            else await injectMessage(payload);
          } catch (e) { toast(String(e?.message || e)); }
        } })
      )
    ),

    React.createElement(Divider, null),

    React.createElement(Section, { title: "ID / Username Mappings" },
      ...reps.map((r, idx) =>
        React.createElement(View, { key: r.id || idx, style: { marginBottom: 12, gap: 6 } },
          React.createElement(Row, { label: "Old User ID",  right: input(r.olduserid, "old snowflake", v => { const list = reps.slice(); list[idx] = { ...r, olduserid: v }; save({ replacements: list }); rerender(); }) }),
          React.createElement(Row, { label: "New User ID",  right: input(r.newuserid, "new snowflake", v => { const list = reps.slice(); list[idx] = { ...r, newuserid: v }; save({ replacements: list }); rerender(); }) }),
          React.createElement(Row, { label: "Old Username", right: input(r.username, "old username",  v => { const list = reps.slice(); list[idx] = { ...r, username: v };   save({ replacements: list }); rerender(); }) }),
          React.createElement(Row, { label: "New Username", right: input(r.newUsername, "new username", v => { const list = reps.slice(); list[idx] = { ...r, newUsername: v }; save({ replacements: list }); rerender(); }) }),
          React.createElement(Row, { label: "Old Tag",      right: input(r.oldUserTag, "old tag",    v => { const list = reps.slice(); list[idx] = { ...r, oldUserTag: v }; save({ replacements: list }); rerender(); }) }),
          React.createElement(Row, { label: "New Tag",      right: input(r.userTag, "new tag",       v => { const list = reps.slice(); list[idx] = { ...r, userTag: v };    save({ replacements: list }); rerender(); }) }),
          React.createElement(Btn, { title: "Delete", onPress: () => { const list = reps.slice(); list.splice(idx, 1); save({ replacements: list }); rerender(); } })
        )
      ),
      React.createElement(Btn, { title: "Add Mapping", onPress: () => { const list = reps.slice(); list.push({ id: "row-" + Date.now(), olduserid: "", newuserid: "", username: "", newUsername: "", oldUserTag: "", userTag: "" }); save({ replacements: list }); rerender(); } })
    )
  );
}

/* Expose small API (useful for debugging via console) */
globalThis.__IDPLUS_API__ = {
  read: () => deepClone(store),
  write: (s) => save(s),
  injectMessage,
  sendMessage
};

/* Plugin object */
const PluginObject = {
  name: "IDPlus (Enmity)",
  onStart: async () => {
    try {
      toast("IDPlus starting…");

      // Kick patches in guarded order
      await tryPatchClipboard();
      await tryPatchLinkBuilders();
      await tryPatchDispatcher();

      toast("IDPlus ready");
    } catch (e) {
      toast("IDPlus failed to start");
      warn("start error", e);
    }
  },
  onStop: () => {
    try { Patcher?.unpatchAll?.(); } catch {}
    unpatches.forEach(u => { try { u(); } catch {} });
    unpatches = [];
    toast("IDPlus stopped");
  },
  settings: Settings
};

/* Export */
module.exports = registerPlugin ? registerPlugin(PluginObject) : PluginObject;
