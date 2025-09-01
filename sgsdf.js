import { React, ReactNative } from 'enmity/metro/common';
import { Toasts } from 'enmity/api/toasts';

const { View, Text, TextInput, ScrollView, Pressable } = ReactNative;

const Row = ({ label, value, onChange, placeholder, multiline }) => (
  <View style={{ marginBottom: 8 }}>
    <Text style={{ color: '#fff', opacity: 0.8, marginBottom: 4 }}>{label}</Text>
    <TextInput
      value={value ?? ''}
      placeholder={placeholder ?? ''}
      placeholderTextColor="#999"
      onChangeText={onChange}
      multiline={!!multiline}
      numberOfLines={multiline ? 3 : 1}
      style={{
        color: '#fff', borderWidth: 1, borderColor: '#3b3b3b',
        borderRadius: 8, padding: 8
      }}
    />
  </View>
);

const Button = ({ label, onPress, tone='default' }) => (
  <Pressable
    onPress={onPress}
    style={{
      backgroundColor: tone === 'danger' ? '#b91c1c' : '#374151',
      paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', marginVertical: 4
    }}
  >
    <Text style={{ color: '#fff', fontWeight: '600' }}>{label}</Text>
  </Pressable>
);

export default function Settings({ storage, API }) {
  const [tick, setTick] = React.useState(0);
  const force = () => setTick(x => x + 1);

  React.useEffect(() => {
    if (!Array.isArray(storage.get('replacements'))) storage.set('replacements', []);
    if (!storage.get('quick')) storage.set('quick', { mode: 'inject', channelId: '', dmUserId: '', content: '', embed: {} });
  }, []);

  const reps = storage.get('replacements') || [];
  const quick = storage.get('quick') || { mode: 'inject', channelId: '', dmUserId: '', content: '', embed: {} };

  const addRep = () => {
    reps.push({
      id: 'message-content-' + Date.now(),
      olduserid: '',
      newuserid: '',
      text: '',
      url: '',
      username: '',
      newUsername: '',
      oldUserTag: '',
      userTag: '',
      embedEnabled: false,
      embed: { provider: '', title: '', description: '', url: '', thumbnail: '' }
    });
    storage.set('replacements', reps);
    force();
  };
  const delRep = (idx) => {
    reps.splice(idx, 1);
    storage.set('replacements', reps);
    force();
  };

  const saveQuick = () => {
    storage.set('quick', quick);
    Toasts.open({ content: 'Saved', source: 'ic_check_24px' });
    force();
  };

  return (
    <ScrollView style={{ padding: 12 }}>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
        IDPlus – Replacements
      </Text>

      {reps.map((r, idx) => (
        <View key={idx} style={{ borderWidth: 1, borderColor: '#333', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600', marginBottom: 8 }}>Replacement #{idx + 1}</Text>

          <Row label="message id (unused on iOS)" value={r.id} onChange={v => { r.id = v; storage.set('replacements', reps); }} placeholder="message-content-..." />
          <Row label="olduserid" value={r.olduserid} onChange={v => { r.olduserid = v; storage.set('replacements', reps); }} placeholder="old snowflake" />
          <Row label="newuserid" value={r.newuserid} onChange={v => { r.newuserid = v; storage.set('replacements', reps); }} placeholder="new id to output" />

          <Row label="username (unused for matching if ID provided)" value={r.username} onChange={v => { r.username = v; storage.set('replacements', reps); }} placeholder="original username" />
          <Row label="newUsername" value={r.newUsername} onChange={v => { r.newUsername = v; storage.set('replacements', reps); }} placeholder="replacement username" />
          <Row label="oldUserTag" value={r.oldUserTag} onChange={v => { r.oldUserTag = v; storage.set('replacements', reps); }} placeholder="original tag" />
          <Row label="userTag" value={r.userTag} onChange={v => { r.userTag = v; storage.set('replacements', reps); }} placeholder="replacement tag" />

          <Text style={{ color: '#9ca3af', marginTop: 4, marginBottom: 8 }}>
            Embed fields below are only used when you inject/send a test message from Quick Tools.
          </Text>
          <Row label="embed.title" value={r.embed?.title} onChange={v => { r.embed.title = v; storage.set('replacements', reps); }} placeholder="Title" />
          <Row label="embed.description" value={r.embed?.description} onChange={v => { r.embed.description = v; storage.set('replacements', reps); }} placeholder="Description" multiline />
          <Row label="embed.url" value={r.embed?.url} onChange={v => { r.embed.url = v; storage.set('replacements', reps); }} placeholder="https://..." />
          <Row label="embed.thumbnail" value={r.embed?.thumbnail} onChange={v => { r.embed.thumbnail = v; storage.set('replacements', reps); }} placeholder="https://image..." />

          <Button label="Delete mapping" tone="danger" onPress={() => delRep(idx)} />
        </View>
      ))}

      <Button label="Add mapping" onPress={addRep} />

      <View style={{ height: 16 }} />

      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
        Quick Tools
      </Text>
      <Row label="Mode (inject/send)" value={quick.mode} onChange={v => { quick.mode = v.trim() || 'inject'; }} placeholder="inject or send" />
      <Row label="channelId (optional)" value={quick.channelId} onChange={v => { quick.channelId = v; }} placeholder="123..." />
      <Row label="dmUserId (optional)" value={quick.dmUserId} onChange={v => { quick.dmUserId = v; }} placeholder="target user id" />
      <Row label="content" value={quick.content} onChange={v => { quick.content = v; }} placeholder="message content" />

      <Text style={{ color: '#9ca3af', marginBottom: 8 }}>Embed (optional)</Text>
      <Row label="title" value={quick.embed?.title} onChange={v => { quick.embed.title = v; }} placeholder="title" />
      <Row label="description" value={quick.embed?.description} onChange={v => { quick.embed.description = v; }} placeholder="description" multiline />
      <Row label="url" value={quick.embed?.url} onChange={v => { quick.embed.url = v; }} placeholder="https://..." />
      <Row label="thumbnail" value={quick.embed?.thumbnail} onChange={v => { quick.embed.thumbnail = v; }} placeholder="https://image..." />

      <Button label="Save Quick Tools" onPress={saveQuick} />
      <Button
        label="Run Quick Tools"
        onPress={async () => {
          try {
            const payload = {
              channelId: quick.channelId || undefined,
              dmUserId: quick.dmUserId || undefined,
              content: quick.content || '',
              embed: quick.embed
            };
            if ((quick.mode || 'inject').toLowerCase() === 'send') {
              await API.sendMessageReal(payload);
            } else {
              await API.injectMessage(payload);
            }
          } catch (e) {
            Toasts.open({ content: String(e?.message || e), source: 'ic_warning_24px' });
          }
        }}
      />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
