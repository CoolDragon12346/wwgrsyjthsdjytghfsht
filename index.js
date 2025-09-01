// IDPlus (Enmity) – v1.1.2 crash-hardened
// Changes vs prior: safer deep-clone, robust module waits, no-op patcher, safer DM resolver,
// stronger guards around MessageActions/Toasts, and extra null checks everywhere.

function safeRequire(path) { try { return require(path); } catch { return null; } }
function deepClone(obj) { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } }

const PluginsMgr = safeRequire("enmity/managers/plugins");
const registerPlugin = PluginsMgr ? PluginsMgr.registerPlugin : null;

const PatcherFactory = safeRequire("enmity/patcher");
const Patcher = PatcherFactory ? PatcherFactory.create("idplus-enmity") : {
  before() { return () => {}; }, after() { return () => {}; }, instead() { return () => {}; }, unpatchAll() {}
};

const Mods = safeRequire("enmity/modules") || {};
const { getByProps, find } = Mods;

const MetroCommon = safeRequire("enmity/metro/common") || {};
const { React, FluxDispatcher, Toasts } = MetroCommon;

const SettingsUI = safeRequire("./settings");

const log = (...a) => { try { console.log("[IDPlus]", ...a); } catch {} };
const toast = (t) => { try { Toasts?.open?.({ content: t + "", source: null }); } catch {} };

const SNOWFLAKE_RE = /^\d{17,21}$/;

const defaults = {
  replacements: [
    { id: "row-default",
      olduserid: "1335468449299955742",
      newuserid: "1335468449299955741",
      username: "vl",
      newUsername: "Emaytee",
      oldUserTag: "cooldragon12346",
      userTag: "emaytee42"
    }
  ],
  quick: {
    mode: "inject", // "inject" | "send"
    channelId: "",
    dmUserId: "",
    content: "Hello from IDPlus (Enmity)!",
    embed: { title: "", description: "", url: "", thumbnail: "" }
  },
  features: { clipboard: true, dispatcher: true, linkBuilders: true }
};

let store = globalThis.__IDPLUS_STORE__ ? deepClone(globalThis.__IDPLUS_STORE__) : deepClone(defaults);
function save(partial) {
  store = deepClone({ ...store, ...partial });
  globalThis.__IDPLUS_STORE__ = deepClone(store);
}

function buildIdMap() {
  const m = new Map();
  for (const r of store.replacements || []) {
    if (r && r.olduserid && r.newuserid) m.set(String(r.olduserid), String(r.newuserid));
  }
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
  return String(text ?? "").replace(
    /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/[^\s)]+/g,
    (m) => rewriteOneDiscordUrl(m, idMap)
  );
}
function processText(text, idMap) {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  if (SNOWFLAKE_RE.test(raw.trim())) return mapId(raw.trim(), idMap);
  return rewriteDiscordUrlsInText(raw, idMap);
}

function remapAuthor(author, idMap) {
  if (!author) return;
  if (author.id) author.id = mapId(author.id, idMap);
  for (const r of store.replacements || []) {
    if (!r) continue;
    const wantName = r.newUsername;
    if (wantName) {
      if (r.olduserid && String(author.id) === mapId(String(r.olduserid), idMap)) {
        author.username = String(wantName);
        if (author.global_name) author.global_name = String(wantName);
      } else if (r.username && author.username === r.username) {
        author.username = String(wantName);
        if (author.global_name) author.global_name = String(wantName);
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
  if (Array.isArray(msg.mentions)) for (const m of msg.mentions) if (m?.id) m.id = mapId(m.id, idMap);
  const ref = msg.message_reference;
  if (ref && typeof ref === "object") {
    if (ref.guild_id) ref.guild_id = mapId(ref.guild_id, idMap);
    if (ref.channel_id) ref.channel_id = mapId(ref.channel_id, idMap);
    if (ref.message_id) ref.message_id = mapId(ref.message_id, idMap);
  }
  if (Array.isArray(msg.embeds)) {
    for (const e of msg.embeds) {
      if (!e) continue;
      if (e.title) e.title = rewriteDiscordUrlsInText(e.title, idMap);
      if (e.description) e.description = rewriteDiscordUrlsInText(e.description, idMap);
      if (e.url) e.url = rewriteOneDiscordUrl(e.url, idMap);
    }
  }
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForModule(propNames, timeoutMs = 8000, step = 100) {
  if (!getByProps) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const mod = getByProps(...propNames);
      if (mod) return mod;
    } catch {}
    await delay(step);
  }
  return null;
}

let unpatches = [];

async function tryPatchClipboard() {
  try {
    const Clipboard = await waitForModule(["setString", "getString"]);
    if (!Clipboard?.setString) throw new Error("Clipboard not available");
    unpatches.push(Patcher.before(Clipboard, "setString", (args) => {
      try {
        if (!args?.length) return;
        args[0] = processText(args[0], buildIdMap());
      } catch (e) { log("clipboard rewrite error", e); }
    }));
    log("Clipboard patched");
  } catch (e) { toast("IDPlus: Clipboard patch skipped"); log("Clipboard patch failed", e); }
}

async function tryPatchLinkBuilders() {
  try {
    if (!find) throw new Error("find() unavailable");
    const builder = find((m) => {
      try {
        for (const k in m) {
          if (typeof m[k] !== "function") continue;
          const s = String(m[k]);
          if (s.includes("discord.com") && s.includes("/channels/")) return true;
        }
      } catch {}
      return false;
    });
    if (!builder) throw new Error("No link builder module");
    Object.keys(builder).forEach((key) => {
      if (typeof builder[key] !== "function") return;
      unpatches.push(Patcher.before(builder, key, (args) => {
        try {
          const idMap = buildIdMap();
          if (args.length === 3) {
            args[0] = mapId(args[0], idMap);
            args[1] = mapId(args[1], idMap);
            args[2] = mapId(args[2], idMap);
          } else if (args.length === 1 && args[0] && typeof args[0] === "object") {
            const o = args[0];
            if ("guildId" in o) o.guildId = mapId(o.guildId, idMap);
            if ("channelId" in o) o.channelId = mapId(o.channelId, idMap);
            if ("messageId" in o) o.messageId = mapId(o.messageId, idMap);
            if ("userId" in o) o.userId = mapId(o.userId, idMap);
          }
        } catch (e) { log("link builder patch error", e); }
      }));
    });
    log("Link builders patched");
  } catch (e) { toast("IDPlus: Link patch skipped"); log("LinkBuilder patch failed", e); }
}

async function tryPatchDispatcher() {
  try {
    if (!FluxDispatcher?.dispatch) throw new Error("FluxDispatcher missing");
    unpatches.push(Patcher.before(FluxDispatcher, "dispatch", (args) => {
      try {
        const action = args?.[0];
        if (!action?.type) return;
        const idMap = buildIdMap();

        if (action.type === "MESSAGE_CREATE" || action.type === "MESSAGE_UPDATE") {
          const msg = action.message || action.messageRecord;
          if (!msg) return;
          remapAuthor(msg.author, idMap);
          remapMessage(msg, idMap);
        } else if (action.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(action.messages)) {
          for (const m of action.messages) {
            remapAuthor(m.author, idMap);
            remapMessage(m, idMap);
          }
        }
      } catch (e) { log("dispatcher transform error", e); }
    }));
    log("Dispatcher patched");
  } catch (e) { toast("IDPlus: Dispatcher patch skipped"); log("Dispatcher patch failed", e); }
}

async function ensureDmChannel(userId) {
  const DMs = await waitForModule(["getDMFromUserId", "getChannel"]);
  const HTTP = await waitForModule(["get", "post", "put", "del", "patch"]);
  if (!DMs || !HTTP) throw new Error("DM helpers unavailable");

  let existing = null;
  try { existing = DMs.getDMFromUserId?.(userId); } catch {}
  if (existing) {
    // Some builds return the channel id, others a channel object
    if (typeof existing === "string") return existing;
    if (typeof existing === "object" && existing.id) return existing.id;
  }
  const res = await HTTP.post?.({ url: "/users/@me/channels", body: { recipient_id: String(userId) } });
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
  if (!MessageActions?.receiveMessage) throw new Error("receiveMessage unavailable");

  const nowIso = new Date().toISOString();
  const embeds = embed && (embed.title || embed.description || embed.url || embed.thumbnail)
    ? [{
        type: "rich",
        title: embed.title || undefined,
        description: embed.description || undefined,
        url: embed.url || undefined,
        thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
      }]
    : [];

  const fake = {
    id: String(Date.now()),
    type: 0,
    content: String(content ?? ""),
    channel_id: target,
    author: { id: "0", username: "IDPlus", discriminator: "0000", bot: true },
    embeds,
    timestamp: nowIso
  };

  MessageActions.receiveMessage(target, fake);
  toast("Injected (local)");
}

async function sendMessage({ channelId, dmUserId, content, embed }) {
  const MessageActions = await waitForModule(["sendMessage", "receiveMessage"]);
  const target = await normalizeTarget({ channelId, dmUserId });
  if (!MessageActions?.sendMessage) throw new Error("sendMessage unavailable");

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

  await MessageActions.sendMessage(target, message);
  toast("Sent");
}

// Expose API for settings
globalThis.__IDPLUS_API__ = {
  read: () => deepClone(store),
  write: (s) => save(deepClone(s)),
  injectMessage,
  sendMessage
};

const PluginObject = {
  name: "IDPlus (Enmity)",
  onStart: async () => {
    try {
      // ensure defaults applied once
      save({ ...deepClone(defaults), ...deepClone(store) });

      // patch in guarded order
      if (store.features?.clipboard) await tryPatchClipboard();
      if (store.features?.linkBuilders) await tryPatchLinkBuilders();
      if (store.features?.dispatcher) await tryPatchDispatcher();

      toast("IDPlus ready");
    } catch (e) { toast("IDPlus failed to start"); log("start error", e); }
  },
  onStop: () => {
    try { Patcher.unpatchAll(); } catch {}
    for (const u of unpatches.splice(0)) { try { u(); } catch {} }
    toast("IDPlus stopped");
  },
  settings: SettingsUI || (() => null)
};

module.exports = registerPlugin ? registerPlugin(PluginObject) : PluginObject;
