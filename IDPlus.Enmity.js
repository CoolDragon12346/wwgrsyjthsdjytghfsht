/*
 * IDPlus (Enmity) — SAFE MODE
 * - Starts with ZERO patches active.
 * - Press "Start Patches" in settings to enable.
 * - Press "Stop Patches" to unhook immediately.
 * - Diagnostics button checks module availability & shows a status report.
 * - Startup Delay lets you defer patching by N ms after you tap "Start".
 */

function safeRequire(path){ try{ return require(path); }catch{ return null; } }
function deepClone(x){ try{ return JSON.parse(JSON.stringify(x)); }catch{ return x; } }
const log=(...a)=>{ try{ console.log("[IDPlus:SAFE]",...a);}catch{} };
const toast=(msg)=>{ try{ (safeRequire("enmity/metro/common")||{}).Toasts?.open?.({content:String(msg),source:"ic_warning_24px"});}catch{} };

/* Enmity/Metro */
const PluginsMgr=safeRequire("enmity/managers/plugins")||{};
const registerPlugin=PluginsMgr.registerPlugin;
const PatcherFactory=safeRequire("enmity/patcher");
const Patcher=PatcherFactory?PatcherFactory.create("idplus-enmity-safe"):{ before(){},unpatchAll(){} };

const Mods=safeRequire("enmity/modules")||{};
const { getByProps, find }=Mods;

const MetroCommon=safeRequire("enmity/metro/common")||{};
const { React, FluxDispatcher }=MetroCommon||{};

/* RN primitives (safe fallbacks) */
const RN=safeRequire("react-native")||{};
const { ScrollView=() => null, View=() => null, Text=() => null, TouchableOpacity=() => null, TextInput=() => null }=RN;

/* ---------------- State/Config ---------------- */
const defaults={
  features:{ clipboard:false, dispatcher:false, linkBuilders:false },
  startupDelayMs: 500,  // wait N ms after you press Start
  replacements: [],
  quick:{ mode:"inject", channelId:"", dmUserId:"", content:"", embed:{title:"",description:"",url:"",thumbnail:""} }
};
let store=globalThis.__IDPLUS_SAFE_STORE__?deepClone(globalThis.__IDPLUS_SAFE_STORE__):deepClone(defaults);
function save(p){ store={...store,...p}; globalThis.__IDPLUS_SAFE_STORE__=deepClone(store); }

const SNOWFLAKE_RE=/^\d{17,21}$/;
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitForModule(props, timeout=8000, step=100){
  const start=Date.now();
  while(Date.now()-start<timeout){
    const m=getByProps?.(...props);
    if(m) return m;
    await delay(step);
  }
  return null;
}

/* ---------------- Mapping & Rewrites ---------------- */
function buildIdMap(){ const m=new Map(); for(const r of store.replacements||[]){ if(r?.olduserid&&r?.newuserid) m.set(String(r.olduserid),String(r.newuserid)); } return m; }
function mapId(id, m){ const k=String(id??""); return m.get(k)??k; }
function rewriteOneDiscordUrl(u, idMap){
  try{
    const url=new URL(String(u));
    const host=String(url.hostname||"").toLowerCase();
    if(!/^(?:www\.|ptb\.|canary\.)?discord\.com$/.test(host)) return u;
    const parts=(url.pathname||"").split("/").filter(Boolean);
    if(parts[0]==="channels"){ if(parts[1])parts[1]=mapId(parts[1],idMap); if(parts[2])parts[2]=mapId(parts[2],idMap); if(parts[3])parts[3]=mapId(parts[3],idMap); }
    else if(parts[0]==="users" && parts[1]) parts[1]=mapId(parts[1],idMap);
    else if(parts[0]==="guilds"&& parts[1]) parts[1]=mapId(parts[1],idMap);
    url.pathname="/"+parts.join("/");
    return url.toString();
  }catch{ return u; }
}
function rewriteDiscordUrlsInText(text, idMap){
  return String(text).replace(/https?:\/\/(?:ptb\.|canary\.)?discord\.com\/[^\s)]+/g,(m)=>rewriteOneDiscordUrl(m,idMap));
}
function processText(text, idMap){
  const raw=String(text??""); const t=raw.trim();
  if(!t) return raw;
  if(SNOWFLAKE_RE.test(t)) return mapId(t,idMap);
  return rewriteDiscordUrlsInText(raw,idMap);
}
function remapAuthor(author, idMap){
  if(!author) return;
  if(author.id) author.id=mapId(author.id,idMap);
  for(const r of store.replacements||[]){
    if(r.newUsername){
      if(r.olduserid && String(author.id)===mapId(String(r.olduserid),idMap)){
        author.username=String(r.newUsername);
        if(author.global_name) author.global_name=String(r.newUsername);
      }else if(r.username && author.username===r.username){
        author.username=String(r.newUsername);
        if(author.global_name) author.global_name=String(r.newUsername);
      }
    }
    if(r.oldUserTag && r.userTag && author.discriminator===r.oldUserTag){
      author.discriminator=String(r.userTag);
    }
  }
}
function remapMessage(msg, idMap){
  if(!msg) return;
  if(typeof msg.content==="string") msg.content=processText(msg.content,idMap);
  if(Array.isArray(msg.embeds)) for(const e of msg.embeds){
    if(e?.title) e.title=rewriteDiscordUrlsInText(e.title,idMap);
    if(e?.description) e.description=rewriteDiscordUrlsInText(e.description,idMap);
    if(e?.url) e.url=rewriteOneDiscordUrl(e.url,idMap);
  }
  if(Array.isArray(msg.mentions)) for(const m of msg.mentions) if(m?.id) m.id=mapId(m.id,idMap);
  if(msg.message_reference){
    const ref=msg.message_reference;
    if(ref.guild_id) ref.guild_id=mapId(ref.guild_id,idMap);
    if(ref.channel_id) ref.channel_id=mapId(ref.channel_id,idMap);
    if(ref.message_id) ref.message_id=mapId(ref.message_id,idMap);
  }
}

/* ---------------- Patchers (only run after Start) ---------------- */
let unpatches=[];

async function patchClipboard(){
  try{
    const Clipboard=await waitForModule(["setString","getString"]);
    if(!Clipboard) throw new Error("Clipboard not found");
    unpatches.push(Patcher.before(Clipboard,"setString",(args)=>{
      try{ if(!args?.length) return; args[0]=processText(args[0],buildIdMap()); }catch(e){ log("Clipboard error",e); }
    }));
    log("Clipboard patched");
  }catch(e){ log("Clipboard patch skipped:",e.message); }
}

async function patchLinkBuilders(){
  try{
    const builder=find?.((m)=>{
      for(const k in m){ if(typeof m[k]==="function"){ const s=String(m[k]); if(s.includes("discord.com")&&s.includes("/channels/")) return true; } }
      return false;
    });
    if(!builder) throw new Error("LinkBuilder module not found");
    Object.keys(builder).forEach((key)=>{
      if(typeof builder[key]!=="function") return;
      unpatches.push(Patcher.before(builder,key,(args)=>{
        try{
          const idMap=buildIdMap();
          if(args.length===3){
            args[0]=mapId(args[0],idMap);
            args[1]=mapId(args[1],idMap);
            args[2]=mapId(args[2],idMap);
          }else if(args.length===1 && args[0] && typeof args[0]==="object"){
            const o=args[0];
            if("guildId" in o) o.guildId=mapId(o.guildId,idMap);
            if("channelId" in o) o.channelId=mapId(o.channelId,idMap);
            if("messageId" in o) o.messageId=mapId(o.messageId,idMap);
            if("userId" in o) o.userId=mapId(o.userId,idMap);
          }
        }catch(e){ log("LinkBuilder error",e); }
      }));
    });
    log("LinkBuilders patched");
  }catch(e){ log("LinkBuilders patch skipped:",e.message); }
}

async function patchDispatcher(){
  try{
    if(!FluxDispatcher?.dispatch) throw new Error("FluxDispatcher missing");
    unpatches.push(Patcher.before(FluxDispatcher,"dispatch",(args)=>{
      try{
        const action=args?.[0];
        if(!action||!action.type) return;
        const idMap=buildIdMap();
        if(action.type==="MESSAGE_CREATE"||action.type==="MESSAGE_UPDATE"){
          const msg=action.message||action.messageRecord;
          if(!msg) return;
          remapAuthor(msg.author,idMap);
          remapMessage(msg,idMap);
        }
        if(action.type==="LOAD_MESSAGES_SUCCESS" && Array.isArray(action.messages)){
          for(const m of action.messages){ remapAuthor(m.author,idMap); remapMessage(m,idMap); }
        }
      }catch(e){ log("Dispatcher error",e); }
    }));
    log("Dispatcher patched");
  }catch(e){ log("Dispatcher patch skipped:",e.message); }
}

/* ---------------- Start/Stop orchestration ---------------- */
let running=false;
async function startPatches(){
  if(running) return toast("IDPlus: already running");
  running=true;
  const { features, startupDelayMs }=store;
  if(startupDelayMs>0) await delay(Number(startupDelayMs)||0);
  try{
    if(features?.clipboard)   await patchClipboard();
    if(features?.linkBuilders)await patchLinkBuilders();
    if(features?.dispatcher)  await patchDispatcher();
    toast("IDPlus: patches active");
  }catch(e){
    toast("IDPlus: start error");
    log("start error",e);
  }
}
function stopPatches(){
  try{ Patcher?.unpatchAll?.(); }catch{}
  for(const u of unpatches) try{ u(); }catch{}
  unpatches=[];
  running=false;
  toast("IDPlus: patches stopped");
}

/* ---------------- Diagnostics ---------------- */
async function runDiagnostics(){
  const report=[];
  const have=(arr)=>getByProps?.(...arr)?"OK":"MISS";
  report.push(`Clipboard [setString,getString]: ${have(["setString","getString"])}`);
  report.push(`MessageActions [sendMessage,receiveMessage]: ${have(["sendMessage","receiveMessage"])}`);
  report.push(`DMs [getDMFromUserId,getChannel]: ${have(["getDMFromUserId","getChannel"])}`);
  report.push(`HTTP [get,post,put,del,patch]: ${have(["get","post","put","del","patch"])}`);
  report.push(`FluxDispatcher.dispatch: ${FluxDispatcher?.dispatch?"OK":"MISS"}`);

  // Try to find any link builder-ish module
  let linkMod="MISS";
  try{
    const builder=find?.((m)=>{
      for(const k in m){ if(typeof m[k]==="function"){ const s=String(m[k]); if(s.includes("discord.com")&&s.includes("/channels/")) return true; } }
      return false;
    });
    linkMod = builder?"OK":"MISS";
  }catch{ linkMod="MISS"; }
  report.push(`LinkBuilder module: ${linkMod}`);

  const msg=report.join(" | ");
  toast(msg);
  log("Diagnostics:",msg);
}

/* ---------------- Settings UI ---------------- */
function Btn({ title, onPress, style }){
  return React.createElement(TouchableOpacity,{ onPress, style: { backgroundColor:"rgba(123,92,255,0.35)", paddingVertical:10, paddingHorizontal:12, borderRadius:8, marginTop:8, alignSelf:"flex-start", ...(style||{}) } },
    React.createElement(Text,{ style:{ fontWeight:"600" } }, String(title))
  );
}
function Row({ label, right }){
  const Form=getByProps?.("FormRow","FormSection","FormSwitch");
  return React.createElement(Form?.FormRow||View,{ label:String(label) }, right||null);
}
function Section({ title, children }){
  const Form=getByProps?.("FormRow","FormSection","FormSwitch","FormDivider");
  return React.createElement(Form?.FormSection||View,{ title:String(title) }, children);
}
function Divider(){
  const Form=getByProps?.("FormDivider");
  return React.createElement(Form?.FormDivider||View,null);
}
function Toggle({ value, onValueChange }){
  const Form=getByProps?.("FormSwitch");
  return React.createElement(Form?.FormSwitch||View,{ value:!!value, onValueChange:(v)=>onValueChange(!!v) });
}
function input(value, placeholder, onChangeText){
  return React.createElement(TextInput,{ style:{ padding:10, backgroundColor:"rgba(255,255,255,0.07)", borderRadius:8 }, value:String(value??""), placeholder:String(placeholder??""), onChangeText, autoCapitalize:"none" });
}

function Settings(){
  const [,rerender]=React.useReducer(x=>x+1,0);
  const s=store;
  const setPath=(path,val)=>{
    const root=deepClone(s); const parts=path.split(".");
    let cur=root; for(let i=0;i<parts.length-1;i++) cur=cur[parts[i]];
    cur[parts.at(-1)]=val; save(root); rerender();
  };

  return React.createElement(ScrollView,{ style:{ padding:12 } },

    React.createElement(Section,{ title:"Controls" },
      React.createElement(Row,{ label:"Startup Delay (ms)", right: input(s.startupDelayMs,"e.g. 500", v=>setPath("startupDelayMs", Number(v||0))) }),
      React.createElement(Row,{ label:"Clipboard",   right: React.createElement(Toggle,{ value:s.features.clipboard,   onValueChange:v=>setPath("features.clipboard",v) }) }),
      React.createElement(Row,{ label:"Dispatcher",  right: React.createElement(Toggle,{ value:s.features.dispatcher,  onValueChange:v=>setPath("features.dispatcher",v) }) }),
      React.createElement(Row,{ label:"LinkBuilders",right: React.createElement(Toggle,{ value:s.features.linkBuilders,onValueChange:v=>setPath("features.linkBuilders",v) }) }),
      React.createElement(View,{ style:{ flexDirection:"row", gap:8 } },
        React.createElement(Btn,{ title:"Start Patches", onPress: startPatches }),
        React.createElement(Btn,{ title:"Stop Patches",  onPress: stopPatches, style:{ backgroundColor:"rgba(255,80,80,0.35)" } }),
        React.createElement(Btn,{ title:"Diagnostics",   onPress: runDiagnostics })
      )
    ),

    React.createElement(Divider,null),

    React.createElement(Section,{ title:"ID / Username Mappings" },
      ...(s.replacements||[]).map((r,idx)=>
        React.createElement(View,{ key:r.id||idx, style:{ marginBottom:12, gap:6 } },
          Row({ label:"Old User ID",  right: input(r.olduserid,"old snowflake", v=>{ const list=s.replacements.slice(); list[idx]={...r,olduserid:v}; save({replacements:list}); rerender(); }) }),
          Row({ label:"New User ID",  right: input(r.newuserid,"new snowflake", v=>{ const list=s.replacements.slice(); list[idx]={...r,newuserid:v}; save({replacements:list}); rerender(); }) }),
          Row({ label:"Old Username", right: input(r.username,"old username",  v=>{ const list=s.replacements.slice(); list[idx]={...r,username:v};   save({replacements:list}); rerender(); }) }),
          Row({ label:"New Username", right: input(r.newUsername,"new username", v=>{ const list=s.replacements.slice(); list[idx]={...r,newUsername:v}; save({replacements:list}); rerender(); }) }),
          Row({ label:"Old Tag",      right: input(r.oldUserTag,"old tag",      v=>{ const list=s.replacements.slice(); list[idx]={...r,oldUserTag:v}; save({replacements:list}); rerender(); }) }),
          Row({ label:"New Tag",      right: input(r.userTag,"new tag",         v=>{ const list=s.replacements.slice(); list[idx]={...r,userTag:v};    save({replacements:list}); rerender(); }) }),
          React.createElement(Btn,{ title:"Delete", onPress:()=>{ const list=s.replacements.slice(); list.splice(idx,1); save({replacements:list}); rerender(); } })
        )
      ),
      React.createElement(Btn,{ title:"Add Mapping", onPress:()=>{ const list=(s.replacements||[]).slice(); list.push({ id:"row-"+Date.now(), olduserid:"", newuserid:"", username:"", newUsername:"", oldUserTag:"", userTag:"" }); save({replacements:list}); rerender(); } })
    )
  );
}

/* Plugin object */
const Plugin={
  name:"IDPlus (Enmity) — Safe Mode",
  onStart(){ toast("IDPlus Safe Mode loaded (inactive until you press Start)."); },
  onStop(){ stopPatches(); },
  settings: Settings
};

module.exports = registerPlugin ? registerPlugin(Plugin) : Plugin;
