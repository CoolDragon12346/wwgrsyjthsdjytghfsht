/*
 * IDPlus (Enmity) — Full, Inline Time Next to Message
 * - Shows exact HH:MM:SS right next to the message content.
 * - Respects CONFIG.autoFakeMessages[].timestamp exactly.
 */

const CONFIG = {
  features: {
    clipboard: true,
    dispatcher: true,
    linkBuilders: true,
    autoFakeMessages: true,

    // Inline time next to the message bubble (our new patch)
    inlineTimeNextToMessage: true,

    // If renderer not found on your build, optionally prefix content as a fallback
    fallbackTimePrefixInContent: true
  },

  // Formatting for the displayed time next to the bubble
  // Change to "en-GB" if you prefer 24h format, or tweak options below.
  timeLocale: "en-US",
  timeOptions: { hour: "2-digit", minute: "2-digit", second: "2-digit" },

  startDelayMs: 800,

  autoFakeMessages: [
    {
      enabled: true,
      delayMs: 2000,
      channelId: "",
      dmUserId: "1329259221409202299",
      userId: "1329259221409202299",
      content: "Hey add me so you can join my private server https://robiox.com.tg/users/343093966600/profile",
      // Exact Eastern time for Sep 1, 2025 1:35:00 PM (EDT, UTC-4)
      timestamp: "2025-09-06T13:35:00-04:00",
      embed: {},
      username: "",
      avatar: ""
    }
  ],

  idMaps: [
    // { oldId: "123", newId: "456" },
  ],

  usernameRules: [
    // { matchId: "1329259221409202299", newUsername: "Emaytee" },
    // { matchUsername: "Tweety", newUsername: "Emaytee" }
  ],

  tagRules: [
    // { oldTag: "0001", newTag: "4242" }
  ],

  quick: {
    mode: "inject",
    channelId: "",
    dmUserId: "753944929973174283",
    content: "Hello from IDPlus!",
    embed: { title: "", description: "", url: "", thumbnail: "" }
  }
};

/* ---------------------------------------------------------
 * Implementation
 * ------------------------------------------------------- */
(function () {
  const get = (obj, path, dflt) => {
    try { return path.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj) ?? dflt; }
    catch { return dflt; }
  };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  const api = {
    register(fn)      { return get(window, "enmity.plugins.registerPlugin", null)?.(fn); },
    patcher()         { return get(window, "enmity.patcher", null); },
    getByProps(...p)  { return get(window, "enmity.modules.getByProps", () => null)(...p); },
    findMod(pred)     { return get(window, "enmity.modules.find", null)?.(pred) ?? null; },
    common()          { return get(window, "enmity.modules.common", {}); },
    toasts()          { return get(window, "enmity.modules.common.Toasts", null); },
    showToast(msg)    { try { this.toasts()?.open?.({ content: String(msg), source: "ic_warning_24px" }); } catch {} }
  };

  const { React } = api.common();
  const SNOWFLAKE_RE = /^\d{17,21}$/;

  function fmtDate(ts, locale, opts) {
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString(locale || undefined, opts || undefined);
    } catch { return null; }
  }

  function fmtTime(ts) {
    return fmtDate(ts, CONFIG.timeLocale, CONFIG.timeOptions);
  }

  /* ---------- ID/URL helpers ---------- */
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
  function rewriteOneDiscordUrl(u, idMap) {
    try {
      const url = new URL(String(u));
      const host = String(url.hostname || "").toLowerCase();
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
  function processTextForIdsAndLinks(text) {
    const idMap = buildIdMap();
    const raw = String(text ?? "");
    const t = raw.trim();
    if (!t) return raw;
    if (SNOWFLAKE_RE.test(t)) return mapId(t, idMap);
    return rewriteDiscordUrlsInText(raw, idMap);
  }

  function applyUsernameRules(author) {
    if (!author) return;
    for (const r of (CONFIG.usernameRules || [])) {
      if (r.matchId && String(author.id) === String(r.matchId) && r.newUsername) {
        author.username = String(r.newUsername);
        if (author.global_name) author.global_name = String(r.newUsername);
      }
      if (r.matchUsername && author.username === r.matchUsername && r.newUsername) {
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
    if (typeof msg.content === "string") {
      msg.content = processTextForIdsAndLinks(msg.content);
    }
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
  function rewriteAuthor(author) {
    if (!author) return;
    const idMap = buildIdMap();
    if (author.id) author.id = mapId(author.id, idMap);
    applyUsernameRules(author);
  }

  async function waitForProps(props, timeout = 8000, step = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const mod = api.getByProps?.(...props);
      if (mod) return mod;
      await delay(step);
    }
    return null;
  }

  let patcher = null;

  /* ---------- Clipboard & link builders ---------- */
  async function patchClipboard() {
    if (!CONFIG.features.clipboard) return;
    try {
      const Clipboard = await waitForProps(["setString", "getString"]);
      if (!Clipboard) { api.showToast("IDPlus: Clipboard module missing"); return; }
      patcher.before(Clipboard, "setString", (args) => {
        try { if (args?.length) args[0] = processTextForIdsAndLinks(args[0]); } catch {}
      });
    } catch {}
  }

  async function patchLinkBuilders() {
    if (!CONFIG.features.linkBuilders) return;
    try {
      const builder = api.findMod?.((m) => {
        for (const k in m) {
          const fn = m[k];
          if (typeof fn === "function") {
            const s = String(fn);
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

  /* ---------- Dispatcher rewrite ---------- */
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

  /* ---------- DM + message helpers ---------- */
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
  async function getUserInfo(userId) {
    const UserStore = await waitForProps(["getUser", "getCurrentUser"]);
    return UserStore?.getUser?.(userId);
  }

  /* ---------- Fake/Inject/Send ---------- */
  async function fakeMessage({ channelId, dmUserId, userId, content, embed, username, avatar, timestamp }) {
    const MessageActions = await waitForProps(["sendMessage", "receiveMessage"]);
    const target = await normalizeTarget({ channelId, dmUserId });

    let messageTimestamp;
    if (timestamp) {
      const d = new Date(timestamp);
      messageTimestamp = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      messageTimestamp = new Date().toISOString();
    }

    const userInfo = userId ? await getUserInfo(userId) : null;
    const embeds = (embed && (embed.title || embed.description || embed.url || embed.thumbnail)) ? [{
      type: "rich",
      title: embed.title || undefined,
      description: embed.description || undefined,
      url: embed.url || undefined,
      thumbnail: embed.thumbnail ? { url: embed.thumbnail } : undefined
    }] : [];

    let finalContent = String(content ?? "");
    if (CONFIG.features.fallbackTimePrefixInContent) {
      const t = fmtTime(messageTimestamp);
      if (t && !finalContent.startsWith("[")) finalContent = `[${t}] ${finalContent}`;
    }

    const fake = {
      id: String(Date.now() + Math.floor(Math.random() * 1000)),
      type: 0,
      content: finalContent,
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
      tts: false,

      // Our marker so the renderer knows the exact time to show inline
      __idplusExactTimestamp: messageTimestamp
    };

    MessageActions?.receiveMessage?.(target, fake);
    api.showToast("Fake message injected");
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

    let finalContent = String(content ?? "");
    if (CONFIG.features.fallbackTimePrefixInContent) {
      const t = fmtTime(nowIso);
      if (t && !finalContent.startsWith("[")) finalContent = `[${t}] ${finalContent}`;
    }

    const fake = {
      id: String(Date.now()),
      type: 0,
      content: finalContent,
      channel_id: target,
      author: { id: "0", username: "IDPlus", discriminator: "0000", bot: true },
      embeds,
      timestamp: nowIso,
      __idplusExactTimestamp: nowIso
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

  /* ---------- Auto fake (respects timestamp) ---------- */
  async function sendAutoFakeMessages() {
    if (!CONFIG.features.autoFakeMessages || !Array.isArray(CONFIG.autoFakeMessages)) return;
    for (const m of CONFIG.autoFakeMessages) {
      if (!m.enabled) continue;
      try {
        await delay(m.delayMs || 0);
        await fakeMessage({
          channelId: m.channelId,
          dmUserId:  m.dmUserId,
          userId:    m.userId,
          content:   m.content,
          embed:     m.embed,
          username:  m.username,
          avatar:    m.avatar,
          timestamp: m.timestamp || undefined
        });
      } catch (error) {
        console.error("Auto fake message error:", error);
        api.showToast(`Auto message failed: ${error.message}`);
      }
    }
  }

  /* ---------- INLINE TIME NEXT TO MESSAGE ---------- */
  async function patchInlineTimeNextToMessage() {
    if (!CONFIG.features.inlineTimeNextToMessage) return;

    // Try well-known names first
    const candidates = [
      ["MessageContent", "default"],
      ["MessageContent", "MessageContent"],
      ["Content", "default"],
      ["Content", "Content"],
    ];

    // Util to append a <span> with the time to the rendered content node
    function appendTimeElement(node, timestampIso) {
      const t = fmtTime(timestampIso);
      if (!t || !node) return node;

      const timeSpan = React.createElement(
        "span",
        {
          // Subtle look; adjust as you like
          style: {
            marginLeft: 6,
            fontSize: 12,
            opacity: 0.6,
            whiteSpace: "nowrap",
            verticalAlign: "baseline"
          }
        },
        t
      );

      try {
        // Typical shape: node.props.children is the message text tree
        if (!node.props) return node;

        // If the root already wraps children, append our span to the same level
        if (Array.isArray(node.props.children)) {
          node.props.children.push(timeSpan);
          return node;
        }

        if (node.props.children) {
          node.props.children = [node.props.children, timeSpan];
          return node;
        }

        // If no children, set it
        node.props.children = [timeSpan];
      } catch {}
      return node;
    }

    function afterRenderPatch(mod, key) {
      try {
        patcher.after(mod, key, (args, res) => {
          // We only want to modify fake messages we injected (with our marker)
          // Try to find the message record in the props/args tree
          const propRoots = [
            res?.props,
            args?.[0],
            res?.props?.message,
            res?.props?.children?.props,
            args?.[0]?.message,
            args?.[0]?.record
          ];

          let msg = null;
          for (const p of propRoots) {
            if (p && p.__idplusExactTimestamp) { msg = p; break; }
            if (p && p.message && p.message.__idplusExactTimestamp) { msg = p.message; break; }
            if (p && p.record && p.record.__idplusExactTimestamp) { msg = p.record; break; }
          }
          if (!msg || !msg.__idplusExactTimestamp) return res;

          // Append right next to message content
          return appendTimeElement(res, msg.__idplusExactTimestamp);
        });
        return true;
      } catch { return false; }
    }

    // Try direct known modules
    for (const [prop, method] of candidates) {
      const mod = await waitForProps([prop]);
      if (mod && typeof mod[method] === "function" && afterRenderPatch(mod, method)) {
        api.showToast("IDPlus: inline time patch applied");
        return;
      }
    }

    // Heuristic hunt: find a module whose function uses ".message.content"
    const guess = api.findMod?.((m) => {
      for (const k in m) {
        const fn = m[k];
        if (typeof fn !== "function") continue;
        const s = String(fn);
        if (s.includes(".message") && s.includes(".content")) return true;
      }
      return false;
    });

    if (guess) {
      for (const k in guess) {
        if (typeof guess[k] === "function" && afterRenderPatch(guess, k)) {
          api.showToast("IDPlus: inline time patch applied (heuristic)");
          return;
        }
      }
    }

    api.showToast("IDPlus: inline time patch not found; using prefix fallback");
  }

  /* ---------- Console helpers ---------- */
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

  /* ---------- Lifecycle ---------- */
  async function onStart() {
    try {
      const ms = Number(CONFIG.startDelayMs || 0);
      if (ms > 0) await delay(ms);

      const P = api.patcher();
      patcher = P?.create?.("idplus-full-inline-time") || null;
      if (!patcher) { api.showToast("IDPlus: patcher missing"); return; }

      await patchClipboard();
      await patchLinkBuilders();
      await patchDispatcher();

      // Append the inline time span directly next to the message text
      await patchInlineTimeNextToMessage();

      if (CONFIG.features.autoFakeMessages) {
        sendAutoFakeMessages();
      }

      api.showToast("IDPlus: full features active (inline time)");
    } catch {
      api.showToast("IDPlus: failed to start");
    }
  }

  function onStop() {
    try { patcher?.unpatchAll?.(); } catch {}
    patcher = null;
    api.showToast("IDPlus: stopped");
  }

  const reg = api.register.bind(api);
  if (reg) {
    reg({
      name: "IDPlus (Full, Inline Time)",
      onStart,
      onStop
    });
  } else {
    module.exports = { name: "IDPlus (Full, Inline Time)", onStart, onStop };
  }
})();
