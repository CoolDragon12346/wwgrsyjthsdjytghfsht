// Minimal, robust settings UI with feature toggles.
// If something crashes, toggle it off here, reload, then isolate.

const { React, Toasts } = require("enmity/metro/common");
const { getByProps } = require("enmity/modules");

const Form = getByProps("FormSection", "FormRow", "FormSwitch", "FormDivider");
const { ScrollView, View } = require("react-native");
const TextInput = require("react-native").TextInput;
const Button = ({ title, onPress }) => {
  const { TouchableOpacity, Text } = require("react-native");
  return React.createElement(TouchableOpacity, { onPress, style: {
    backgroundColor: "rgba(123,92,255,0.35)", paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 8, marginTop: 8, alignSelf: "flex-start"
  }}, React.createElement(Text, { style: { fontWeight: "600" } }, title));
};

module.exports = function Settings() {
  const api = globalThis.__IDPLUS_API__;
  const [, rerender] = React.useReducer(x => x + 1, 0);
  const s = api.read();

  const set = (patch) => { api.write({ ...s, ...patch }); rerender(); };
  const setPath = (path, val) => {
    const root = JSON.parse(JSON.stringify(s));
    let cur = root, segs = path.split(".");
    for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
    cur[segs.at(-1)] = val;
    api.write(root); rerender();
  };

  const feats = s.features || { clipboard: true, dispatcher: true, linkBuilders: true };
  const quick = s.quick || { mode: "inject", channelId: "", dmUserId: "", content: "", embed: {} };

  const textInput = (value, placeholder, onChangeText) =>
    React.createElement(TextInput, {
      style: { padding: 10, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 8 },
      value: value ?? "", placeholder, onChangeText, autoCapitalize: "none"
    });

  return React.createElement(ScrollView, { style: { padding: 12 } },

    React.createElement(Form.FormSection, { title: "Features" },
      React.createElement(Form.FormRow, {
        label: "Clipboard rewrite",
        trailing: React.createElement(Form.FormSwitch, {
          value: !!feats.clipboard,
          onValueChange: v => setPath("features.clipboard", v)
        })
      }),
      React.createElement(Form.FormRow, {
        label: "Dispatcher (message/username rewrite)",
        trailing: React.createElement(Form.FormSwitch, {
          value: !!feats.dispatcher,
          onValueChange: v => setPath("features.dispatcher", v)
        })
      }),
      React.createElement(Form.FormRow, {
        label: "Link builders (pre-clipboard remap)",
        trailing: React.createElement(Form.FormSwitch, {
          value: !!feats.linkBuilders,
          onValueChange: v => setPath("features.linkBuilders", v)
        })
      }),
      React.createElement(Form.FormDivider, null)
    ),

    React.createElement(Form.FormSection, { title: "Quick Actions" },
      React.createElement(Form.FormRow, { label: "Mode (inject/send)", trailing: textInput(quick.mode, "inject | send", v => setPath("quick.mode", v)) }),
      React.createElement(Form.FormRow, { label: "Channel ID", trailing: textInput(quick.channelId, "123...", v => setPath("quick.channelId", v)) }),
      React.createElement(Form.FormRow, { label: "DM User ID", trailing: textInput(quick.dmUserId, "123...", v => setPath("quick.dmUserId", v)) }),
      React.createElement(Form.FormRow, { label: "Content", trailing: textInput(quick.content, "Message text", v => setPath("quick.content", v)) }),
      React.createElement(Form.FormRow, { label: "Embed Title", trailing: textInput(quick.embed?.title, "Title", v => setPath("quick.embed.title", v)) }),
      React.createElement(Form.FormRow, { label: "Embed Description", trailing: textInput(quick.embed?.description, "Description", v => setPath("quick.embed.description", v)) }),
      React.createElement(Form.FormRow, { label: "Embed URL", trailing: textInput(quick.embed?.url, "https://...", v => setPath("quick.embed.url", v)) }),
      React.createElement(Form.FormRow, { label: "Embed Thumbnail", trailing: textInput(quick.embed?.thumbnail, "https://...", v => setPath("quick.embed.thumbnail", v)) }),
      React.createElement(View, { style: { flexDirection: "row", gap: 8 } },
        React.createElement(Button, { title: "Save", onPress: () => { api.write(s); Toasts.open({ content: "Saved." }); } }),
        React.createElement(Button, { title: (quick.mode || "inject") === "send" ? "Send" : "Inject", onPress: async () => {
          try {
            const payload = {
              channelId: (s.quick.channelId || "").trim() || undefined,
              dmUserId: (s.quick.dmUserId || "").trim() || undefined,
              content: s.quick.content || "",
              embed: s.quick.embed || {}
            };
            if ((s.quick.mode || "inject") === "send") await api.sendMessage(payload);
            else await api.injectMessage(payload);
          } catch (e) { Toasts.open({ content: String(e?.message || e) }); }
        } })
      )
    ),

    React.createElement(Form.FormDivider, null),

    React.createElement(Form.FormSection, { title: "ID / Username Mappings" },
      ...(s.replacements || []).map((r, idx) =>
        React.createElement(View, { key: r.id || idx, style: { marginBottom: 12, gap: 6 } },
          React.createElement(Form.FormRow, { label: "Old User ID", trailing: textInput(r.olduserid, "old snowflake", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, olduserid: v }; set({ replacements: list });
          }) }),
          React.createElement(Form.FormRow, { label: "New User ID", trailing: textInput(r.newuserid, "new snowflake", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, newuserid: v }; set({ replacements: list });
          }) }),
          React.createElement(Form.FormRow, { label: "Old Username", trailing: textInput(r.username, "old username", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, username: v }; set({ replacements: list });
          }) }),
          React.createElement(Form.FormRow, { label: "New Username", trailing: textInput(r.newUsername, "new username", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, newUsername: v }; set({ replacements: list });
          }) }),
          React.createElement(Form.FormRow, { label: "Old Tag", trailing: textInput(r.oldUserTag, "old tag", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, oldUserTag: v }; set({ replacements: list });
          }) }),
          React.createElement(Form.FormRow, { label: "New Tag", trailing: textInput(r.userTag, "new tag", v => {
            const list = s.replacements.slice(); list[idx] = { ...r, userTag: v }; set({ replacements: list });
          }) }),
          React.createElement(Button, { title: "Delete", onPress: () => {
            const list = s.replacements.slice(); list.splice(idx, 1); set({ replacements: list });
          } })
        )
      ),
      React.createElement(Button, { title: "Add Mapping", onPress: () => {
        const list = (s.replacements || []).slice();
        list.push({ id: "row-" + Date.now(), olduserid: "", newuserid: "", username: "", newUsername: "", oldUserTag: "", userTag: "" });
        set({ replacements: list });
      } })
    )
  );
};
