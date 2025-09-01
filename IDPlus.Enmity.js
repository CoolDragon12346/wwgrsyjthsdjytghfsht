/*
 * IDPlus (Enmity) — Full Features, NO Settings
 * Put all your config in CONFIG below.
 *
 * Features:
 *  - Clipboard rewrite (IDs & discord.com links)
 *  - Dispatcher rewrite (message author usernames, IDs in content/embeds/mentions/references)
 *  - Link builder remap (guild/channel/message/user in generated links)
 *  - DM helper + injectMessage + sendMessage (with embed)
 *  - Fake messages from other users (manual + auto on startup)
 *
 * Safety:
 *  - No Enmity UI usage (no settings screen, no Form components)
 *  - Waits for modules, wraps everything in try/catch
 *  - If a module is missing on your build, that feature is skipped (no crash)
 *
 * Usage:
 *  - Edit CONFIG below.
 *  - (Optional) Use console: __IDPLUS_CTL__.injectMessage({...}) / sendMessage({...}) / fakeMessage({...})
 */

/* ---------------------------------------------------------
 * 1) EDIT YOUR CONFIG HERE
 * ------------------------------------------------------- */
const CONFIG = {
  // Turn individual systems on/off
  features: {
    clipboard:   true,
    dispatcher:  true,
    linkBuilders:true,
    autoFakeMessages: true  // Send fake messages automatically on startup
  },

  // Delay (ms) before patching to ensure modules are loaded
  startDelayMs: 800,

  // Auto fake messages to send on startup (if features.autoFakeMessages is true)
  autoFakeMessages: [
    {
      enabled: true,
      delayMs: 2000,  // Delay after plugin starts before sending
      channelId: "",  // Channel ID to send to (leave empty to use dmUserId)
      dmUserId: "753944929973174283",  // User ID to DM (if channelId is empty)
      userId: "753944929973174283",    // User ID that will appear to send the message
      content: "Hello! This is an auto message from IDPlus!",
      embed: [],
      username: "",  // Optional: override username
      avatar: ""     // Optional: override avatar
    }
    // Add more auto messages as needed...
  ],

  // ID remaps (snowflakes as strings)
  // Example: old user/channel/guild/message ID -> new ID
  idMaps: [
    // add more...
  ],

  // Username changer rules (optional)
  // If author's id equals matchId OR author's username equals matchUsername,
  // replace with newUsername (also sets global_name if present)
  usernameRules: [
    { matchId: ".Tweety", newId: "Emaytee" }
    // add more...
  ],

  // Optional "tag" remap (legacy discriminators) — rarely used nowadays
  tagRules: [
    // { oldTag: "cooldragon12346", newTag: "emaytee42" }
  ],

  // Quick actions (you can call from console via __IDPLUS_CTL__)
  quick: {
    mode: "inject",                  // "inject" (local) or "send" (real)
    channelId: "",                   // set to a channel ID OR dmUserId
    dmUserId: "753944929973174283",  // user ID to DM (auto-creates DM)
    content: "Hello from IDPlus!",
    embed: {
      title: "",
      description: "",
      url: "",
      thumbnail: ""
    }
  }
};

/* ---------------------------------------------------------
 * 2) IMPLEMENTATION (no edits needed below)
 * ------------------------------------------------------- */
(function () {
  const get = (obj, path, dflt) => {
    try { return path.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj) ?? dflt; }
    catch { return dflt; }
  };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Enmity accessors (late-bound)
  const api = {
    register(fn)      { return get(window, "enmity.plugins.registerPlugin", null)?.(fn); },
    patcher()         { return get(window, "enmity.patcher", null); },
    getByProps(...p)  { return get(window, "enmity.modules.getByProps", () => null)(...p); },
    findMod(pred)     { return get(window, "enmity.modules.find", null)?.(pred) ?? null; },
    common()          { return get(window, "enmity.modules.common", {}); },
    toasts()          { return get(window, "enmity.modules.common.Toasts", null); },
    showToast(msg)    { try { this.toasts()?.open?.({ content: String(msg), source: "ic_warning_24px" }); } catch {} }
  };

  // Map helpers
  const SNOWFLAKE_RE = /^\d{17,21}$/;
  function buildIdMap() {
    const m = new Map();
    for (const row of (CONFIG.idMaps || [])) {
      if (row?.oldId && row?.newId) m.set(String(row.oldId), String(row.newId));
    }
    return m;
  }
  function mapId(id, m) {
    const k = String(id ?? "");
    return m.get(k) ?? k;
  }

  // Clipboard rewrite
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
  function processTextForIdsAndLinks(text) {
    const idMap = buildIdMap();
    const raw = String(text ?? "");
    const t = raw.trim();
    if (!t) return raw;
    if (SNOWFLAKE_RE.test(t)) return mapId(t, idMap);
    return rewriteDiscordUrlsInText(raw, idMap);
  }

  // Message rewrite (dispatcher)
  function applyUsernameRules(author) {
    if (!author) return;
    for (const r of (CONFIG.usernameRules || [])) {
      if (r.matchId && String(author.id) === String(r.matchId)) {
        author.username = String(r.newUsername);
        if (author.global_name) author.global_name = String(r.newUsername);
      }
      if (r.matchUsername && author.username === r.matchUsername) {
        author.username = String(r.newUsername);
        if (author.global_name) author.global_name = String(r.newUsername);
      }
    }
    for (const r of (CONFIG.tagRules || [])) {
      if (r.oldTag && r.newTag && author.discriminator === r.oldTag) {
        author.discriminator = String(r.newTag);
      }
    }
  }
  function rewriteMessageObject(msg) {
    if (!msg) return;
    const idMap = buildIdMap();

    // content
    if (typeof msg.content === "string") {
      msg.content = processTextForIdsAndLinks(msg.content);
    }
    // mentions
    if (Array.isArray(msg.mentions)) {
      for (const m of msg.mentions) if (m?.id) m.id = mapId(m.id, idMap);
    }
    // reference
    if (msg.message_reference) {
      const ref = msg.message_reference;
      if (ref.guild_id) ref.guild_id = mapId(ref.guild_id, idMap);
      if (ref.channel_id) ref.channel_id = mapId(ref.channel_id, idMap);
      if (ref.message_id) ref.message_id = mapId(ref.message_id, idMap);
    }
    // embeds (basic pass)
    if (Array.isArray(msg.embeds)) {
      for (const e of msg.embeds) {
        if (e?.title) e.title = rewriteDiscordUrlsInText(e.title, idMap);
        if (e?.description) e.description = rewriteDiscordUrlsInText(e.description, idMap);
        if (e?.url) e.url = rewriteOneDiscordUrl(e.url, idMap);
      }
    }
  }
  function rewriteAuthor(author) {
    if (!author) return;
    const idMap = buildIdMap();
    if (author.id) author.id = mapId(author.id, idMap);
    applyUsernameRules(author);
  }

  // Wait for module utility
  async function waitForProps(props, timeout = 8000, step = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const mod = api.getByProps?.(...props);
      if (mod) return mod;
      await delay(step);
    }
    return null;
  }

  // Patches
  let patcher = null;
  async function patchClipboard() {
    if (!CONFIG.features.clipboard) return;
    try {
      const Clipboard = await waitForProps(["setString", "getString"]);
      if (!Clipboard) { api.showToast("IDPlus: Clipboard module missing"); return; }
      patcher.before(Clipboard, "setString", (args) => {
        try {
          if (!args?.length) return;
          args[0] = processTextForIdsAndLinks(args[0]);
        } catch {}
      });
    } catch {}
  }

  async function patchLinkBuilders() {
    if (!CONFIG.features.linkBuilders) return;
    try {
      const builder = api.findMod?.((m) => {
        for (const k in m) {
          if (typeof m[k] === "function") {
            const s = String(m[k]);
            if (s.includes("discord.com") && s.includes("/channels/")) return true;
          }
        }
        return false;
      });
      if (!builder) return;

      Object.keys(builder).forEach((key) => {
        if (typeof builder[key] !== "function") return;
        patcher.before(builder, key, (args) => {
          try {
            const idMap = buildIdMap();
            if (args.length === 3) {
              args[0] = mapId(args[0], idMap);
              args[1] = mapId(args[1], idMap);
              args[2] = mapId(args[2], idMap);
            } else if (args.length === 1 && args[0] && typeof args[0] === "object") {
              const o = args[0];
              if ("guildId"   in o) o.guildId   = mapId(o.guildId, idMap);
              if ("channelId" in o) o.channelId = mapId(o.channelId, idMap);
              if ("messageId" in o) o.messageId = mapId(o.messageId, idMap);
              if ("userId"    in o) o.userId    = mapId(o.userId, idMap);
            }
          } catch {}
        });
      });
    } catch {}
  }

  async function patchDispatcher() {
    if (!CONFIG.features.dispatcher) return;
    try {
      const FluxDispatcher = get(api.common(), "FluxDispatcher", null);
      if (!FluxDispatcher?.dispatch) { api.showToast("IDPlus: Dispatcher missing"); return; }

      patcher.before(FluxDispatcher, "dispatch", (args) => {
        try {
          const action = args?.[0];
          if (!action || !action.type) return;

          if (action.type === "MESSAGE_CREATE" || action.type === "MESSAGE_UPDATE") {
            const msg = action.message || action.messageRecord;
            if (!msg) return;
            rewriteAuthor(msg.author);
            rewriteMessageObject(msg);
          }

          if (action.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(action.messages)) {
            for (const m of action.messages) {
              rewriteAuthor(m.author);
              rewriteMessageObject(m);
            }
          }
        } catch {}
      });
    } catch {}
  }

  // DM helper + message actions
  async function ensureDmChannel(userId) {
    const DMs  = await waitForProps(["getDMFromUserId", "getChannel"]);
    const HTTP = await waitForProps(["get", "post", "put", "del", "patch"]);
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
  
  // Get user info by ID
  async function getUserInfo(userId) {
    const UserStore = await waitForProps(["getUser", "getCurrentUser"]);
    return UserStore?.getUser?.(userId);
  }
  
  // Create a fake message that appears to be from another user
// Create a fake message that appears to be from another user
  api.showToast("Fake message injected");
// Create a fake message that appears to be from another user


// Create a fake message that appears to be from another user
// Create a fake message that appears to be from another user
  async function fakeMessage({ channelId, dmUserId, userId, content, embed, username, avatar, timestamp }) {
    const MessageActions = await waitForProps(["sendMessage", "receiveMessage"]);
    const target = await normalizeTarget({ channelId, dmUserId });
    
    // Handle timestamp safely - always use future timestamp to stay at bottom
    let messageTimestamp;
    try {
      if (timestamp) {
        // Parse the provided timestamp
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) {
          throw new Error("Invalid timestamp");
        }
        messageTimestamp = date.toISOString();
      } else {
        // Default: future timestamp far in the future to always stay at bottom
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 10); // 10 years in the future
        messageTimestamp = futureDate.toISOString();
      }
    } catch (error) {
      // Fallback to far future timestamp
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 10);
      messageTimestamp = futureDate.toISOString();
    }
    
    // Get user info if userId is provided
    let userInfo = null;
    if (userId) {
      userInfo = await getUserInfo(userId);
    }
    
    const embeds = (embed && (embed.title || embed.description || embed.url || embed.thumbnail)) ? [{
      type: "rich",
      title: embed.title || undefined,
      description: embed.description || undefined,
      url: embed.url || undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
    }] : [];
  
    const fake = {
      id: String(Date.now() + Math.floor(Math.random() * 1000)),
      type: 0,
      content: String(content ?? ""),
      channel_id: target,
      author: {
        id: userId || "0",
        username: username || (userInfo?.username || "Unknown User"),
        discriminator: userInfo?.discriminator || "0000",
        avatar: avatar || userInfo?.avatar,
        global_name: userInfo?.global_name,
        bot: userInfo?.bot || false
      },
      embeds,
      timestamp: messageTimestamp,
      edited_timestamp: null,
      flags: 0,
      mention_everyone: false,
      mention_roles: [],
      mentions: [],
      pinned: false,
      tts: false
    };
    
    MessageActions?.receiveMessage?.(target, fake);
    api.showToast("Fake message injected (persistent bottom)");
    return fake;
  }




    const MessageActions = await waitForProps(["sendMessage", "receiveMessage"]);
    const target = await normalizeTarget({ channelId, dmUserId });
    
    // Use a future timestamp to ensure it appears below all messages
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year in the future
    const futureIso = futureDate.toISOString();
    
    // Get user info if userId is provided
    let userInfo = null;
    if (userId) {
      userInfo = await getUserInfo(userId);
    }
    
    const embeds = (embed && (embed.title || embed.description || embed.url || embed.thumbnail)) ? [{
      type: "rich",
      title: embed.title || undefined,
      description: embed.description || undefined,
      url: embed.url || undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
    }] : [];
  
    const fake = {
      id: String(Date.now() + Math.floor(Math.random() * 1000)),
      type: 0,
      content: String(content ?? ""),
      channel_id: target,
      author: {
        id: userId || "0",
        username: username || (userInfo?.username || "Unknown User"),
        discriminator: userInfo?.discriminator || "0000",
        avatar: avatar || userInfo?.avatar,
        global_name: userInfo?.global_name,
        bot: userInfo?.bot || false
      },
      embeds,
      timestamp: futureIso, // Future timestamp to appear below all messages
      edited_timestamp: null,
      flags: 0,
      mention_everyone: false,
      mention_roles: [],
      mentions: [],
      pinned: false,
      tts: false
    };
    
    MessageActions?.receiveMessage?.(target, fake);
    return fake;
  }
  async function injectMessage({ channelId, dmUserId, content, embed }) {
    const MessageActions = await waitForProps(["sendMessage", "receiveMessage"]);
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
    api.showToast("Injected (local)");
  }
  
  async function sendMessage({ channelId, dmUserId, content, embed }) {
    const MessageActions = await waitForProps(["sendMessage", "receiveMessage"]);
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
    api.showToast("Sent");
  }


// Auto send fake messages on startup
  async function sendAutoFakeMessages() {
    if (!CONFIG.features.autoFakeMessages || !Array.isArray(CONFIG.autoFakeMessages)) {
      return;
    }
    
    // Use a fixed future timestamp that will always stay at the bottom
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 10); // 10 years in the future
    const futureTimestamp = futureDate.toISOString();
    
    for (const messageConfig of CONFIG.autoFakeMessages) {
      if (!messageConfig.enabled) continue;
      
      try {
        // Wait for the specified delay
        await delay(messageConfig.delayMs || 0);
        
        // Send the fake message with future timestamp to stay at bottom
        await fakeMessage({
          channelId: messageConfig.channelId,
          dmUserId: messageConfig.dmUserId,
          userId: messageConfig.userId,
          content: messageConfig.content,
          embed: messageConfig.embed,
          username: messageConfig.username,
          avatar: messageConfig.avatar,
          timestamp: futureTimestamp // Fixed future timestamp to stay at bottom
        });
        
        api.showToast(`Auto message sent from user ${messageConfig.userId} (persistent bottom)`);
      } catch (error) {
        console.error("Failed to send auto fake message:", error);
        api.showToast(`Auto message failed: ${error.message}`);
      }
    }
  }




  // Expose console helpers
  window.__IDPLUS_CTL__ = {
    injectMessage,
    sendMessage,
    fakeMessage,
    getUserInfo,
    sendAutoFakeMessages,
    quick() {
      const q = CONFIG.quick || {};
      const payload = {
        channelId: (q.channelId || "").trim() || undefined,
        dmUserId:  (q.dmUserId  || "").trim() || undefined,
        content:   q.content || "",
        embed:     q.embed   || {}
      };
      if ((q.mode || "inject") === "send") return sendMessage(payload);
      return injectMessage(payload);
    }
  };

  // Plugin lifecycle
  async function onStart() {
    try {
      // wait a bit for modules to settle
      const ms = Number(CONFIG.startDelayMs || 0);
      if (ms > 0) await delay(ms);

      const P = api.patcher();
      patcher = P?.create?.("idplus-full") || null;
      if (!patcher) { api.showToast("IDPlus: patcher missing"); return; }

      await patchClipboard();
      await patchLinkBuilders();
      await patchDispatcher();

      // Start auto fake messages if enabled
      if (CONFIG.features.autoFakeMessages) {
        sendAutoFakeMessages();
      }

      api.showToast("IDPlus: full features active");
    } catch (e) {
      api.showToast("IDPlus: failed to start");
    }
  }

  function onStop() {
    try { patcher?.unpatchAll?.(); } catch {}
    patcher = null;
    api.showToast("IDPlus: stopped");
  }

  // Register (prefer Enmity register; fallback CommonJS export)
  const reg = api.register.bind(api);
  if (reg) {
    reg({
      name: "IDPlus (Full, No Settings)",
      onStart,
      onStop
      // No getSettingsPanel — nothing to open, so no settings crash possible.
    });
  } else {
    module.exports = { name: "IDPlus (Full, No Settings)", onStart, onStop };
  }
})();
