/* ===== Config ===== */
if(!window.QUOTEFEED_CONFIG){ alert("Missing config.js"); throw new Error("No CFG"); }
const CFG = window.QUOTEFEED_CONFIG;

/* ===== mini utils ===== */
const $ = s => document.querySelector(s);
const el = (t,props={},...kids)=>{ const n=document.createElement(t); Object.assign(n,props); kids.forEach(k=>n.append(k)); return n; };
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const uuid = crypto.randomUUID ? ()=>crypto.randomUUID() : ()=>Math.random().toString(36).slice(2)+Date.now();
function toast(msg, type=""){ const box=$("#toasts"); const t=el("div",{className:"toast"}, msg); if(type==="ok") t.style.borderColor="var(--ok)"; if(type==="danger") t.style.borderColor="var(--danger)"; box.append(t); setTimeout(()=>t.remove(),2600); }
function timeAgo(iso){ const s=(Date.now()-new Date(iso))/(1000); if(s<60)return `${s|0}s`; const m=s/60|0; if(m<60)return `${m}m`; const h=m/60|0; if(h<24)return `${h}h`; const d=h/24|0; if(d<7)return `${d}d`; const w=d/7|0; return `${w}w`; }
async function hashHex(text){ const d=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text||"")); return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join(""); }

/* ===== theme + font ===== */
const THEMES = CFG.THEMES||["ocean","sunset","forest","violet","mono","neon","crimson","gold"];
const FONTS = CFG.FONTS||["inter","outfit","manrope","rubik"];
function applySiteTheme(name){ if(!THEMES.includes(name)) return; document.documentElement.setAttribute("data-theme",name); localStorage.setItem("qf_theme",name); }
function applyFont(name){ if(!FONTS.includes(name)) return; document.documentElement.setAttribute("data-font",name); localStorage.setItem("qf_font",name); }
(function(){ const t=localStorage.getItem("qf_theme"), f=localStorage.getItem("qf_font"); if(t) applySiteTheme(t); if(f) applyFont(f); else applyFont(FONTS[0]); })();

/* ===== image aHash for dup detection ===== */
async function getBitmap(file){
  if(!file) return null;
  if('createImageBitmap' in window){ try{ return await createImageBitmap(file);}catch{} }
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,ko)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=ko; i.src=url; });
    const c=document.createElement("canvas"); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext("2d").drawImage(img,0,0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
async function averageHash(file){
  if(!file || !file.type.startsWith("image/")) return null;
  const bmp=await getBitmap(file);
  const c=document.createElement("canvas"); c.width=8; c.height=8;
  const ctx=c.getContext("2d",{willReadFrequently:true}); ctx.drawImage(bmp,0,0,8,8);
  const {data}=ctx.getImageData(0,0,8,8); let sum=0,g=[];
  for(let i=0;i<data.length;i+=4){ const gray=(data[i]+data[i+1]+data[i+2])/3; g.push(gray); sum+=gray; }
  const avg=sum/64; let bits=0n; for(let i=0;i<64;i++) bits=(bits<<1n)|(g[i]>=avg?1n:0n);
  return bits.toString(16).padStart(16,"0");
}

/* ===== Supabase (Discord OAuth + QuoteFeed email) ===== */
/* Remember me: persistSession based on saved preference (default true) */
const REMEMBER = localStorage.getItem("qf_remember") !== "false";
const supa = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: REMEMBER,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
let me=null; // { id, name, avatar, provider }
function isQFAccount(){ return me?.provider === "email"; } // QuoteFeed account

/* Pick up auth events so redirects (email confirm / discord) set the session */
supa.auth.onAuthStateChange((_event, _session) => {
  // no-op; supabase handles storage when persistSession=true
  refreshSession(); // keep UI in sync
});

async function refreshSession(){
  const { data } = await supa.auth.getSession();
  const u=data.session?.user;
  if(!u){ me=null; renderSignedOut(); return; }
  const provider = (u.app_metadata && u.app_metadata.provider) || "email";
  const meta = u.user_metadata || {};
  const name = (provider==="email" ? (meta.username||u.email) : (meta.custom_claims?.global_name||meta.name||meta.full_name||u.email)) || "User";
  const avatar = meta.avatar_url || `https://api.dicebear.com/8.x/identicon/svg?seed=${encodeURIComponent(name)}`;
  me={ id:u.id, name, avatar, provider };
  renderUserMenu(); renderMyProfileCard();
  $("#openComposer").style.display="";
}

function signInWithDiscord(){
  const redirectTo = location.origin + location.pathname;
  return supa.auth.signInWithOAuth({ provider:"discord", options:{ redirectTo }});
}

/* Email/Password flows (QuoteFeed accounts) */
async function epSignIn(email, pass){
  const { data, error } = await supa.auth.signInWithPassword({ email, password:pass });
  if(error) throw error; return data;
}
async function epSignUp(email, pass, username, avatarFile){
  const { data, error } = await supa.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: location.origin + location.pathname,
      data: { username }
    }
  });
  if(error) throw error;

  const userId = data.user?.id;
  let avatarUrl = null;

  if(userId && avatarFile){
    try{
      const ext = (avatarFile.name.split(".").pop()||"png").toLowerCase();
      const path = `${userId}/avatar.${ext}`;
      await supa.storage.from(CFG.AVATAR_BUCKET || "avatars").upload(path, avatarFile, { upsert:true });
      const { data:pub } = supa.storage.from(CFG.AVATAR_BUCKET || "avatars").getPublicUrl(path);
      avatarUrl = pub.publicUrl;
      await supa.auth.updateUser({ data: { avatar_url: avatarUrl } });
    }catch(e){ /* ignore upload failures */ }
  }
  return { id:userId, avatarUrl };
}
async function epForgot(email){
  const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if(error) throw error;
}

/* ===== Transport: JSONP GET + iframe POST ===== */
function jsonp(url){
  return new Promise((resolve,reject)=>{
    const cb="QF_cb_"+Math.random().toString(36).slice(2);
    const scr=document.createElement("script");
    scr.src = url + (url.includes("?")?"&":"?") + "callback="+cb;
    let done=false;
    window[cb]=d=>{done=true; resolve(d); cleanup();};
    scr.onerror=()=>{ if(done) return; reject(new Error("JSONP failed")); cleanup(); };
    function cleanup(){ delete window[cb]; scr.remove(); }
    document.head.appendChild(scr);
    setTimeout(()=>{ if(!done){ reject(new Error("JSONP timeout")); cleanup(); }},15000);
  });
}
function postBridge(url, fields){
  return new Promise((resolve,reject)=>{
    const key="QF_BR_"+Math.random().toString(36).slice(2);
    const frm=document.createElement("form"); frm.method="POST"; frm.enctype="multipart/form-data"; frm.action=url+(url.includes("?")?"&":"?")+"bridge=1"; frm.style.display="none";
    const ifr=document.createElement("iframe"); ifr.name=key; ifr.style.display="none"; frm.target=key;
    for(const f of fields){
      if(f.node){ frm.appendChild(f.node); }
      else { const inp=document.createElement("input"); inp.type="hidden"; inp.name=f.name; inp.value=f.value; frm.appendChild(inp); }
    }
    function onMsg(ev){
      const d=ev.data; if(!d||d.source!=="QuoteFeedGAS") return;
      window.removeEventListener("message",onMsg);
      try{ resolve(d.data);}catch(e){reject(e);}
      setTimeout(()=>{ ifr.remove(); frm.remove(); },0);
    }
    window.addEventListener("message",onMsg);
    document.body.appendChild(ifr); document.body.appendChild(frm); frm.submit();
  });
}

/* ===== API (GAS) ===== */
const API = {
  list: (q={})=>{
    const u=new URL(CFG.GAS_ENDPOINT);
    u.searchParams.set("op","list");
    u.searchParams.set("limit", q.limit??CFG.PAGE_SIZE);
    u.searchParams.set("offset", q.offset??0);
    if(q.search) u.searchParams.set("search", q.search);
    if(q.user_id) u.searchParams.set("user_id", q.user_id);
    if(q.sort) u.searchParams.set("sort", q.sort);
    if(q.topic) u.searchParams.set("topic", q.topic);
    return jsonp(u.toString());
  },
  getPost: (id)=>{ const u=new URL(CFG.GAS_ENDPOINT); u.searchParams.set("op","post"); u.searchParams.set("id",id); return jsonp(u.toString()); },
  whoReacted: (post_id)=>{ const u=new URL(CFG.GAS_ENDPOINT); u.searchParams.set("op","reactions"); u.searchParams.set("post_id",post_id); return jsonp(u.toString()); },
  listComments: (post_id)=>{ const u=new URL(CFG.GAS_ENDPOINT); u.searchParams.set("op","comments"); u.searchParams.set("post_id",post_id); return jsonp(u.toString()); },
  getProfile: (user_id)=>{ const u=new URL(CFG.GAS_ENDPOINT); u.searchParams.set("op","profile"); u.searchParams.set("user_id",user_id); return jsonp(u.toString()); },

  createPost: (payload)=> postBridge(CFG.GAS_ENDPOINT+"?op=postCreate", [{name:"payload",value:JSON.stringify(payload)}]),
  editPost:   (payload)=> postBridge(CFG.GAS_ENDPOINT+"?op=postEdit",   [{name:"payload",value:JSON.stringify(payload)}]),
  deletePost: (payload)=> postBridge(CFG.GAS_ENDPOINT+"?op=postDelete", [{name:"payload",value:JSON.stringify(payload)}]),
  deleteAccount: (payload)=> postBridge(CFG.GAS_ENDPOINT+"?op=accountDelete", [{name:"payload",value:JSON.stringify(payload)}]),

  toggleLike: (post_id,user)=> postBridge(CFG.GAS_ENDPOINT+"?op=like", [{name:"payload",value:JSON.stringify({post_id,user_id:user.id,user_name:user.name,user_avatar:user.avatar})}]),
  toggleDislike: (post_id,user)=> postBridge(CFG.GAS_ENDPOINT+"?op=dislike", [{name:"payload",value:JSON.stringify({post_id,user_id:user.id,user_name:user.name,user_avatar:user.avatar})}]),
  addComment: (post_id,user,content)=> postBridge(CFG.GAS_ENDPOINT+"?op=comment", [{name:"payload",value:JSON.stringify({post_id,user_id:user.id,user_name:user.name,user_avatar:user.avatar,content})}]),
  upsertProfile: (obj)=> postBridge(CFG.GAS_ENDPOINT+"?op=profileUpsert", [{name:"payload",value:JSON.stringify(obj)}]),
  uploadToDrive: (inputEl)=> postBridge(CFG.GAS_ENDPOINT+"?op=uploadMedia", [{name:"file",node:inputEl}]),
};

/* ===== Client cache (faster scrolling) ===== */
function cacheKey(obj){ return "qf_cache_"+Object.entries(obj).map(([k,v])=>k+"="+(v??"")).join("&"); }
function cacheGet(key,ttl=60){ try{ const j=JSON.parse(localStorage.getItem(key)||"null"); if(!j) return null; if(Date.now()-j.t>ttl*1000) return null; return j.v; }catch{return null;} }
function cacheSet(key,val){ try{ localStorage.setItem(key, JSON.stringify({t:Date.now(), v:val})); }catch{} }
function cacheClear(){ Object.keys(localStorage).filter(k=>k.startsWith("qf_cache_")).forEach(k=>localStorage.removeItem(k)); }

/* ===== State ===== */
const state={ posts:[], offset:0, exhausted:false, search:"", sort:"new", topic:"", editing:null };

/* ===== Signed-out and menu ===== */
function renderSignedOut(){
  $("#userBox").innerHTML="";
  const b=el("button",{className:"btn brand",textContent:"Sign in"}); b.onclick=()=>openAuthModal();
  $("#userBox").append(b);
  $("#openComposer").style.display="none";
  renderMyProfileCard();
}
function renderUserMenu(){
  const box=$("#userBox"); box.innerHTML="";
  const wrap=el("div",{style:"position:relative;display:flex;gap:10px;align-items:center;cursor:pointer"});
  const avatar=el("img",{className:"avatar",src:me.avatar}); const name=el("button",{className:"btn ghost",textContent:me.name,style:"font-weight:800"});
  wrap.append(avatar,name); box.append(wrap);
  let menu=null;
  function close(){ menu?.remove(); menu=null; document.removeEventListener("click", onDoc); }
  function onDoc(e){ if(!menu) return; if(!box.contains(e.target)) close(); }
  wrap.onclick=()=>{
    if(menu){ close(); return; }
    const tpl=$("#menuTpl"); menu=tpl.content.firstElementChild.cloneNode(true);
    menu.querySelector('[data-act="profile"]').onclick=()=>{ close(); openProfile(me.id); };
    menu.querySelector('[data-act="settings"]').onclick=()=>{ close(); openSettings(); };
    menu.querySelector('[data-act="logout"]').onclick=async()=>{ close(); await supa.auth.signOut(); await refreshSession(); };
    box.append(menu); setTimeout(()=>document.addEventListener("click",onDoc),0);
  };
}
function renderMyProfileCard(){
  const c=$("#myProfileBox"); c.innerHTML="";
  if(!me){
    const b=el("button",{className:"btn brand"},"Sign in"); b.onclick=openAuthModal;
    c.append(
      el("img",{className:"avatar",src:`https://api.dicebear.com/8.x/shapes/svg?seed=guest`}),
      el("div",{}, el("div",{className:"meta"},"Not signed in")), b
    );
  }else{
    c.append(
      el("img",{className:"avatar",src:me.avatar}),
      el("div",{},
        el("div",{style:"font-weight:800"},me.name),
        el("div",{className:"meta"}, isQFAccount()?"QuoteFeed account":"Discord")
      ),
      el("button",{className:"btn",onclick:()=>openProfile(me.id)},"Open")
    );
  }
}

/* ===== Feed rendering ===== */
const feedEl=$("#feed"), loadMoreBtn=$("#loadMore");
function renderFeed(){ feedEl.innerHTML=""; const frag=document.createDocumentFragment(); for(const p of state.posts) frag.append(renderCard(p)); feedEl.append(frag); }
function renderCard(p){
  const head=el("div",{className:"post-head"},
    el("img",{className:"avatar",src:p.user_avatar}),
    el("div",{},
      el("div",{style:"font-weight:800;cursor:pointer",textContent:p.user_name,onclick:()=>openProfile(p.user_id)}),
      el("div",{className:"meta"}, new Date(p.created_at).toLocaleString())
    ),
    el("div",{style:"margin-left:auto",className:"meta"}, timeAgo(p.created_at))
  );
  const title=el("div",{className:"title"}, p.title||"(No title)");
  if(p.edited_at) title.append(" ", el("span",{className:"badge edited"},"edited"));
  const body=el("div",{className:"body"}, p.body||"");
  const card=el("div",{className:"card", "data-post":p.id});
  card.append(head, title, body);
  if(p.media_url){
    const m=el("div",{className:"media"},
      p.media_type==="video"
        ? el("video",{src:p.media_url,controls:true,preload:"metadata"})
        : el("img",{src:p.media_url,loading:"lazy"})
    );
    card.append(m);
  }

  const tagsWrap=el("div",{className:"chips"});
  (p.topics||[]).forEach(t=>{
    const ch=el("span",{className:"chip"},"#"+t);
    ch.onclick=()=>{ state.topic=t; $("#searchInput").value=""; loadInitial(); };
    tagsWrap.append(ch);
  });
  if((p.topics||[]).length) card.append(tagsWrap);

  const likeB = el("button",{className:"iconbtn"}, `❤️ ${p.like_count||0}`);
  const dlikeB= el("button",{className:"iconbtn"}, `👎 ${p.dislike_count||0}`);
  const viewB = el("button",{className:"iconbtn"},"🔎 View");
  const shareB= el("button",{className:"iconbtn"},"🔗 Share");
  likeB.onclick=()=>optimisticReact(p,"like",likeB,dlikeB);
  dlikeB.onclick=()=>optimisticReact(p,"dislike",likeB,dlikeB);
  viewB.onclick=()=>openPostModal(p.id);
  shareB.onclick=()=>openShare({type:"post",id:p.id,title:p.title});
  const actions=el("div",{className:"actions"}, likeB,dlikeB,viewB,shareB);

  if(me && me.id===p.user_id){
    const more=el("button",{className:"iconbtn"},"⋯");
    let open=false, dd;
    more.onclick=()=>{
      if(open){ dd.remove(); open=false; return; }
      dd=el("div",{className:"menu"}); dd.style.right="0"; dd.style.position="absolute";
      const ed = el("button",{},"Edit"); ed.onclick=()=>{ dd.remove(); open=false; openEditor(p); };
      const del= el("button",{},"Delete…"); del.onclick=()=>{ dd.remove(); open=false; confirmDeletePost(p); };
      dd.append(ed,del);
      more.parentNode.style.position="relative";
      more.parentNode.append(dd); open=true;
    };
    actions.append(more);
  }
  card.append(actions);

  card.style.cursor="default";
  card.onclick=()=>openPostModal(p.id);
  return card;
}

/* Optimistic like/dislike */
const myReact = { liked:new Set(), disliked:new Set() };
async function optimisticReact(p,kind,likeB,dlikeB){
  if(!me){ openAuthModal("Sign in to react"); return; }
  const liked=myReact.liked.has(p.id), disliked=myReact.disliked.has(p.id);
  const oldL=p.like_count|0, oldD=p.dislike_count|0;
  if(kind==="like"){
    if(disliked){ myReact.disliked.delete(p.id); p.dislike_count=Math.max(0,oldD-1); }
    if(liked){ myReact.liked.delete(p.id); p.like_count=Math.max(0,oldL-1); } else { myReact.liked.add(p.id); p.like_count=oldL+1; }
  }else{
    if(liked){ myReact.liked.delete(p.id); p.like_count=Math.max(0,oldL-1); }
    if(disliked){ myReact.disliked.delete(p.id); p.dislike_count=Math.max(0,oldD-1); } else { myReact.disliked.add(p.id); p.dislike_count=oldD+1; }
  }
  likeB.textContent=`❤️ ${p.like_count}`; dlikeB.textContent=`👎 ${p.dislike_count}`;
  try{
    const r = kind==="like" ? await API.toggleLike(p.id,me) : await API.toggleDislike(p.id,me);
    p.like_count=r.like_count; p.dislike_count=r.dislike_count;
    likeB.textContent=`❤️ ${p.like_count}`; dlikeB.textContent=`👎 ${p.dislike_count}`;
  }catch{}
}

/* ===== Composer / Edit ===== */
const composeBD=$("#composeBackdrop"), postBtn=$("#postBtn");
$("#openComposer").onclick=()=>{ if(!me) return openAuthModal(); state.editing=null; resetComposer(); showBD(composeBD,true); };
$("#closeCompose").onclick=()=>showBD(composeBD,false);
const titleInput=$("#titleInput"), bodyInput=$("#bodyInput"), fileInput=$("#fileInput"), fileInfo=$("#fileInfo"), filePrev=$("#filePreview"), topicsInput=$("#topicsInput");
fileInput.onchange=()=>{
  const f=fileInput.files?.[0]||null;
  filePrev.innerHTML=""; filePrev.style.display="none";
  fileInfo.textContent=f?`${f.name} (${Math.round(f.size/1024)} KB)`:"No file";
  if(f){ const url=URL.createObjectURL(f); filePrev.append(f.type.startsWith("video/")?el("video",{src:url,controls:true}):el("img",{src:url})); filePrev.style.display=""; }
};

function parseTopics(s){ return (s||"").toLowerCase().replace(/,/g," ").split(/\s+/).map(x=>x.replace(/^#+/,"").trim()).filter(Boolean).slice(0,5); }
function resetComposer(p=null){
  titleInput.value=p?.title||"";
  bodyInput.value=p?.body||"";
  topicsInput.value=(p?.topics||[]).map(t=>"#"+t).join(" ");
  fileInput.value=""; filePrev.innerHTML=""; filePrev.style.display="none";
  $("#composeHint").hidden=true;
}

postBtn.onclick=async()=>{
  if(!me) return openAuthModal();
  const title=titleInput.value.trim(), body=bodyInput.value.trim(), topics=parseTopics(topicsInput.value);
  let media_url=null, media_type=null, media_id=null;
  if(fileInput.files?.[0]){
    const f=fileInput.files[0];
    if(f.size>CFG.MAX_FILE_BYTES){ toast("File too large","danger"); return; }
    const up=await API.uploadToDrive(fileInput);
    if(!up.ok) return toast(up.error||"Upload failed","danger");
    media_url=up.url; media_type=f.type.startsWith("video/")?"video":"image"; media_id=up.id;
  }
  if(state.editing){
    const p=state.editing;
    const payload={ id:p.id, title, body, topics, media_url, media_type, media_id };
    const res=await API.editPost(payload);
    if(!res.ok) return toast(res.error||"Edit failed","danger");
    Object.assign(p,res.post);
    await loadInitial(true);
    $("#composeHint").textContent="✓ Edited"; $("#composeHint").hidden=false; setTimeout(()=>showBD(composeBD,false),400);
    return;
  }
  if(!title && !body && !media_url) return toast("Write something or add media");
  const id=uuid();
  const title_hash=title?await hashHex(title):null, body_hash=body?await hashHex(body):null, media_hash=await averageHash(fileInput.files?.[0]);
  const res=await API.createPost({ id,user_id:me.id,user_name:me.name,user_avatar:me.avatar,title,body,media_url,media_type,media_id,title_hash,body_hash,media_hash,topics });
  if(res.dup && res.existing){ toast("Looks similar to an existing post"); openPostModal(res.existing.id); return; }
  if(!res.ok) return toast(res.error||"Failed to create","danger");
  state.posts.unshift(res.post); feedEl.prepend(renderCard(res.post));
  resetComposer(); $("#composeHint").textContent="✓ Posted"; $("#composeHint").hidden=false; setTimeout(()=>showBD(composeBD,false),400);
};

function openEditor(p){ state.editing=p; resetComposer(p); showBD(composeBD,true); }
async function confirmDeletePost(p){
  const ok = await confirmModal(`Delete this post?`, `This will remove the post, its media and all comments/reactions.`);
  if(!ok) return;
  const res=await API.deletePost({ id:p.id });
  if(!res.ok) return toast(res.error||"Delete failed","danger");
  state.posts = state.posts.filter(x=>x.id!==p.id); renderFeed(); toast("Deleted","ok");
}

/* ===== Post modal (view & comments) ===== */
const postBD=$("#postBackdrop"), postBody=$("#postModalBody"), modalLoading=$("#modalLoading");
$("#closePostModal").onclick=()=>showBD(postBD,false);
function setModalLoading(on,text="Loading…"){ modalLoading.hidden=!on; modalLoading.querySelector(".loading-text").textContent=text; }

async function openPostModal(post_id){
  setModalLoading(true,"Loading post…"); showBD(postBD,true);
  try{
    const { post, ok } = await API.getPost(post_id);
    if(!ok){ toast("Post not found","danger"); setModalLoading(false); return; }
    buildPostView(post);
  } finally { setModalLoading(false); }
}
function buildPostView(post){
  postBody.innerHTML="";
  const head=el("div",{className:"post-head"},
    el("img",{className:"avatar",src:post.user_avatar}),
    el("div",{}, el("div",{style:"font-weight:800;cursor:pointer",textContent:post.user_name,onclick:()=>openProfile(post.user_id)}), el("div",{className:"meta"},new Date(post.created_at).toLocaleString())),
    el("div",{style:"margin-left:auto",className:"meta"},timeAgo(post.created_at))
  );
  const title=el("div",{className:"title"},post.title||"(No title)"); if(post.edited_at) title.append(" ",el("span",{className:"badge edited"},"edited"));
  const body=el("div",{className:"body"},post.body||"");
  const media=post.media_url?el("div",{className:"media"}, post.media_type==="video"?el("video",{src:post.media_url,controls:true}):el("img",{src:post.media_url,loading:"lazy"})):null;
  const likeB=el("button",{className:"iconbtn"},`❤️ ${post.like_count||0}`); const dislikeB=el("button",{className:"iconbtn"},`👎 ${post.dislike_count||0}`);
  likeB.onclick=()=>optimisticReact(post,"like",likeB,dislikeB); dislikeB.onclick=()=>optimisticReact(post,"dislike",likeB,dislikeB);
  const shareB=el("button",{className:"iconbtn"},"🔗 Share"); shareB.onclick=()=>openShare({type:"post",id:post.id,title:post.title});
  const act=el("div",{className:"actions"},likeB,dislikeB,shareB);

  if(me && me.id===post.user_id){
    const edit=el("button",{className:"iconbtn"},"Edit"); edit.onclick=()=>{ openEditor(post); };
    const del=el("button",{className:"iconbtn"},"Delete…"); del.onclick=()=>confirmDeletePost(post);
    act.append(edit,del);
  }

  postBody.append(el("div",{className:"card"},head,title,body,media||el("div"),act));

  if((post.topics||[]).length){
    const wrap=el("div",{className:"chips"});
    post.topics.forEach(t=>{ const ch=el("span",{className:"chip"},"#"+t); ch.onclick=()=>{ state.topic=t; showBD(postBD,false); loadInitial(); }; wrap.append(ch); });
    postBody.append(el("div",{className:"card"}, wrap));
  }

  const reactList=el("div",{className:"meta"},"Loading reactions…");
  API.whoReacted(post.id).then(r=>{
    const arr=[]; if(r.likes?.length)arr.push(`❤️ ${r.likes.length}`); if(r.dislikes?.length)arr.push(`👎 ${r.dislikes.length}`);
    reactList.textContent=arr.length?arr.join("  •  "):"No reactions yet.";
  });
  postBody.append(el("div",{className:"card"}, reactList));

  const box=el("div",{}), input=el("textarea",{className:"input",rows:3,placeholder:"Write a comment…"}), add=el("button",{className:"btn brand"},"Comment");
  add.onclick=async()=>{
    if(!me) return openAuthModal();
    const c=input.value.trim(); if(!c) return;

    // Optimistic comment with "Pending…" + spinner
    const tempId = "temp-"+uuid();
    const pending = renderOneComment({
      id: tempId,
      user_avatar: me.avatar,
      user_name: me.name,
      created_at: new Date().toISOString(),
      content: c,
      _pending: true
    });
    box.prepend(pending);
    input.value="";

    try{
      const res=await API.addComment(post.id,me,c);
      // Replace list with server truth (ensures counts/order accurate)
      renderComments(box,res.items);
      // Feedback
      const okmsg=el("div",{className:"meta"},"✓ Comment posted"); postBody.append(okmsg); setTimeout(()=>okmsg.remove(),1200);
    }catch{
      // Mark failed
      pending.querySelector(".badge")?.remove();
      const fail = el("span",{className:"badge",style:"border-color:var(--danger);color:var(--danger)"},"failed");
      pending.querySelector(".meta.time")?.append(" • ", fail);
      const retry = el("button",{className:"btn sm", style:"margin-top:6px"},"Retry");
      retry.onclick=async()=>{
        retry.disabled=true;
        try{
          const res=await API.addComment(post.id,me,c);
          renderComments(box,res.items);
        }catch{ retry.disabled=false; }
      };
      pending.append(retry);
    }
  };
  postBody.append(el("div",{className:"card"},
    el("div",{style:"font-weight:800"},"Comments"), box,
    el("div",{className:"row right",style:"margin-top:8px"}, input, add)
  ));
  API.listComments(post.id).then(r=>renderComments(box,r.items));
}
function renderOneComment(c){
  const head = el("div",{className:"post-head"},
    el("img",{className:"avatar",src:c.user_avatar}),
    el("div",{},
      el("div",{style:"font-weight:800"},c.user_name),
      el("div",{className:"meta time"}, new Date(c.created_at).toLocaleString())
    )
  );
  const body = el("div",{style:"margin-top:6px;white-space:pre-wrap"}, c.content);
  const card = el("div",{className:"card", "data-cid": c.id||""}, head, body);
  if(c._pending){
    const badge = el("span",{className:"badge"}, el("span",{className:"spinner"})," Pending…");
    card.append(el("div",{style:"margin-top:6px"}, badge));
  }
  return card;
}
function renderComments(container,items){
  container.innerHTML="";
  if(!items.length){ container.append(el("div",{className:"meta"},"No comments yet.")); return; }
  for(const c of items){ container.append(renderOneComment(c)); }
}

/* ===== Profiles ===== */
async function openProfile(user_id){
  setModalLoading(true,"Loading profile…"); showBD(postBD,true);
  postBody.innerHTML=""; for(let i=0;i<2;i++) postBody.append(el("div",{className:"card skeleton",style:"height:120px"}));
  try{
    const prof = await API.getProfile(user_id);
    const { items } = await API.list({ user_id, offset:0, limit:50, sort:"new" });
    const header = el("div",{className:"card"},
      el("div",{className:"row",style:"gap:12px"},
        el("img",{className:"avatar",src:prof.profile?.user_avatar || items[0]?.user_avatar || ""}),
        el("div",{},
          el("div",{style:"font-weight:800;font-size:18px"}, prof.profile?.user_name || items[0]?.user_name || "User"),
          el("div",{className:"meta"}, prof.profile?.about || "No bio yet.")
        ),
        el("div",{style:"margin-left:auto"},
          el("button",{className:"iconbtn",onclick:()=>openShare({type:"user",id:user_id,title:(prof.profile?.user_name || "Profile")})},"🔗 Share")
        )
      )
    );
    const accent = prof.profile?.theme || localStorage.getItem("qf_theme") || "ocean";
    const themeBadge = el("span",{className:"badge"}, "theme: "+accent);
    header.append(el("div",{style:"margin-top:6px"}, themeBadge));
    if(me && me.id===user_id){
      const editBtn=el("button",{className:"btn",style:"margin-top:8px"},"Edit profile");
      editBtn.onclick=()=>editProfile(prof.profile||{});
      header.append(editBtn);
    }
    postBody.innerHTML="";
    postBody.append(header, el("div",{className:"card"}, el("div",{style:"font-weight:800"},"Recent posts")));
    const wrap=el("div",{}); (items.length?items:[{meta:"No posts yet."}]).forEach(p=>{ if(p.id) wrap.append(renderCard(p)); else wrap.append(el("div",{className:"meta"},p.meta)); });
    postBody.append(wrap);
  }catch{ toast("Failed to load profile","danger"); }
  finally{ setModalLoading(false); }
}

function editProfile(existing={}){
  postBody.innerHTML="";

  const showAccountControls = isQFAccount();

  const about = el("textarea",{className:"input",rows:4,placeholder:"About me / status…", value: existing.about || ""});
  const themeSel = el("select",{className:"input"});
  (CFG.THEMES||[]).forEach(t => themeSel.append(el("option",{value:t,selected:(existing.theme||localStorage.getItem("qf_theme")||"")===t}, t)));

  const uWrap = el("div", {style: showAccountControls ? "" : "display:none"});
  const uname = el("input",{className:"input",placeholder:"😎 Username", value: (me?.name && isQFAccount()) ? (existing.user_name || me.name) : (existing.user_name || "")});
  const aWrap = el("div",{className:"row", style: showAccountControls ? "margin-top:8px" : "display:none"});
  const aLbl  = el("label",{},"🖼️ Profile photo");
  const aInp  = el("input",{type:"file", accept:"image/*"});
  aWrap.append(aLbl,aInp);
  uWrap.append(uname,aWrap);

  const tip = el("div",{className:"meta"}, showAccountControls ? "Username & photo apply to your QuoteFeed account." : "Using Discord—username/photo are managed by Discord.");
  const save = el("button",{className:"btn brand"},"Save");
  const back = el("button",{className:"btn"},"Back");

  save.onclick=async()=>{
    if(!me) return openAuthModal();
    save.disabled=true;
    try{
      const r=await API.upsertProfile({
        user_id:me.id,
        user_name:showAccountControls ? (uname.value.trim()||me.name) : me.name,
        user_avatar:me.avatar,
        about:about.value.trim(),
        theme:themeSel.value
      });
      if(!r.ok) throw new Error(r.error||"Save failed");

      if(showAccountControls){
        const updates = {};
        if(uname.value.trim() && uname.value.trim() !== me.name) updates.data = { ...(updates.data||{}), username: uname.value.trim() };
        const file = aInp.files?.[0];
        if(file){
          try{
            const ext=(file.name.split(".").pop()||"png").toLowerCase();
            const path = `${me.id}/avatar.${ext}`;
            await supa.storage.from(CFG.AVATAR_BUCKET || "avatars").upload(path, file, { upsert:true });
            const { data:pub } = supa.storage.from(CFG.AVATAR_BUCKET || "avatars").getPublicUrl(path);
            const url = pub.publicUrl;
            updates.data = { ...(updates.data||{}), avatar_url: url };
          }catch(e){ /* ignore */ }
        }
        if(Object.keys(updates).length){ await supa.auth.updateUser(updates); }
      }

      applySiteTheme(themeSel.value);
      const ok=el("div",{className:"meta"},"✓ Saved");
      postBody.append(ok);
      setTimeout(()=>openProfile(me.id),500);
    }catch(e){
      toast(e.message||"Save failed","danger");
    }finally{
      save.disabled=false;
    }
  };
  back.onclick=()=>openProfile(me.id);

  postBody.append(
    el("div",{className:"card"},
      el("div",{style:"font-weight:800"},"Edit Profile"),
      el("label",{},"About me"), about,
      el("label",{},"Profile theme"), themeSel,
      tip,
      uWrap,
      el("div",{className:"row right"}, back, save)
    )
  );
}

/* ===== Settings: global theme + font + cache + delete account ===== */
const settingsBD=$("#settingsBackdrop"); $("#openSettings").onclick=()=>openSettings(); $("#closeSettings").onclick=()=>showBD(settingsBD,false);
function openSettings(){
  const body=$("#settingsBody"); body.innerHTML="";
  const themeSel=el("select",{className:"input"}); (CFG.THEMES||[]).forEach(t=>themeSel.append(el("option",{value:t,selected:document.documentElement.getAttribute("data-theme")===t},t)));
  const fontSel=el("select",{className:"input"}); (CFG.FONTS||[]).forEach(f=>fontSel.append(el("option",{value:f,selected:document.documentElement.getAttribute("data-font")===f},f)));

  const apply=el("button",{className:"btn brand"},"Apply");
  apply.onclick=()=>{ applySiteTheme(themeSel.value); applyFont(fontSel.value); toast("Appearance updated","ok"); };

  const clr=el("button",{className:"btn"},"Clear cache"); clr.onclick=()=>{ cacheClear(); toast("Cache cleared","ok"); };

  const delAcc=el("button",{className:"btn",style:"border-color:var(--danger);color:var(--danger)"},"Delete account…");
  delAcc.onclick=async()=>{
    if(!me) return openAuthModal();
    const ok=await confirmModal("Delete account?", "This deletes your profile, posts, media, comments and reactions. Type DELETE to confirm.","DELETE");
    if(!ok) return;
    const r=await API.deleteAccount({ user_id:me.id });
    if(!r.ok) return toast(r.error||"Failed","danger");
    toast("Account deleted","ok");
    await supa.auth.signOut(); location.reload();
  };

  body.append(
    el("div",{className:"card"}, el("div",{style:"font-weight:800"},"Appearance"),
      el("label",{},"Theme"), themeSel,
      el("label",{},"Font"), fontSel,
      el("div",{className:"row right"},apply)
    ),
    el("div",{className:"card"}, el("div",{style:"font-weight:800"},"Data"), clr),
    el("div",{className:"card"}, el("div",{style:"font-weight:800;color:var(--danger)"},"Danger Zone"), el("div",{className:"meta"},"This cannot be undone."), delAcc)
  );
  showBD(settingsBD,true);
}

/* ===== Auth modal (Discord + QuoteFeed email) ===== */
const authBD=$("#authBackdrop"); $("#closeAuth").onclick=()=>showBD(authBD,false);
function openAuthModal(msg){
  showBD(authBD,true); if(msg) toast(msg);

  const email = $("#authEmail"), pass=$("#authPassword"),
        uname=$("#authUsername"), avat=$("#authAvatar"),
        remember=$("#rememberMe"),
        submit=$("#authSubmit"),
        discordBtn=$("#discordLoginBtn"),
        msgbox=$("#authMsg"),
        seg = authBD.querySelectorAll(".seg-item");

  // Set initial remember toggle from saved pref
  remember.checked = localStorage.getItem("qf_remember") !== "false";
  remember.onchange = ()=> localStorage.setItem("qf_remember", remember.checked ? "true":"false");

  // segmented control (signup/login)
  function setMode(mode){
    seg.forEach(s=>s.classList.toggle("active", s.dataset.mode===mode));
    const signup = mode==="signup";
    $("#signupExtras").style.display = signup ? "" : "none";
    submit.textContent = signup ? "Create Account" : "Log In";
    submit.dataset.mode = mode;
    msgbox.textContent = "";
  }
  seg.forEach(s => s.onclick = ()=> setMode(s.dataset.mode));
  setMode("signup");

  // Discord
  discordBtn.onclick = async()=>{
    try{
      const {error}=await signInWithDiscord();
      if(error) msgbox.textContent = error.message || "Sign-in failed";
    }catch(e){
      msgbox.textContent = "Sign-in failed";
    }
  };

  // Submit (signup / login)
  submit.onclick = async()=>{
    const mode = submit.dataset.mode;
    const emailVal=email.value.trim(), passVal=pass.value;

    if(!emailVal || !passVal){ msgbox.textContent="Enter email and password"; return; }

    try{
      // Update client persistence according to remember toggle (new page loads honor this)
      localStorage.setItem("qf_remember", remember.checked ? "true":"false");

      if(mode==="signup"){
        await epSignUp(emailVal, passVal, (uname.value||"").trim(), avat.files?.[0]);
        msgbox.textContent = "Check your inbox to confirm your email.";
      }else{
        await epSignIn(emailVal, passVal);
        msgbox.textContent = "Signed in!";
        showBD(authBD,false);
        await refreshSession();
      }
    }catch(e){
      msgbox.textContent = e.message || "Auth failed";
    }
  };
}

/* ===== Share modal ===== */
const shareBD=$("#shareBackdrop"); $("#closeShare").onclick=()=>showBD(shareBD,false);
function openShare({type,id,title}){
  const link = `${CFG.SITE_BASE_URL}#/${type}/${id}`;
  $("#shareLink").value=link;
  $("#copyLink").onclick=async()=>{ await navigator.clipboard.writeText(link); toast("Link copied","ok"); };
  $("#copyMD").onclick=async()=>{ const md = type==="post" ? `[${title||"Post"}](${link})` : `[Profile](${link})`; await navigator.clipboard.writeText(md); toast("Markdown copied","ok"); };
  $("#webShare").onclick=async()=>{ if(navigator.share){ try{ await navigator.share({ title:"QuoteFeed", text:title||"QuoteFeed", url:link }); }catch{} } else { toast("System share not supported"); } };
  $("#tweet").onclick=()=>{ const u="https://twitter.com/intent/tweet?text="+encodeURIComponent((title?title+" ":"")+"— "+link); window.open(u,"_blank"); };
  showBD(shareBD,true);
}

/* ===== Load feed ===== */
async function loadInitial(skipCache=false){
  $("#topicCloud").innerHTML="";
  if(state.topic){
    $("#topicCloud").append(
      el("span",{className:"chip"}, "Filter: #"+state.topic),
      el("button",{className:"btn ghost",onclick:()=>{state.topic=""; loadInitial();}}, "Clear")
    );
  }

  state.offset=0; state.exhausted=false;
  const key = cacheKey({s:state.search, sort:state.sort, topic:state.topic, off:0});
  let data = !skipCache && cacheGet(key);
  if(!data){
    data = await API.list({ search:state.search, offset:0, limit:CFG.PAGE_SIZE, sort:state.sort, topic:state.topic });
    cacheSet(key, data);
  }
  state.posts=data.items||[];
  renderFeed();
  loadMoreBtn.style.display=(state.posts.length<(data.total||0))?"":"none";
  state.offset=state.posts.length;
}
loadMoreBtn.onclick=async()=>{
  if(state.exhausted) return;
  const data = await API.list({ search:state.search, offset:state.offset, limit:CFG.PAGE_SIZE, sort:state.sort, topic:state.topic });
  const items = data.items||[];
  if(!items.length){ state.exhausted=true; loadMoreBtn.style.display="none"; return; }
  state.posts.push(...items);
  const frag=document.createDocumentFragment(); for(const p of items) frag.append(renderCard(p)); feedEl.append(frag);
  state.offset+= items.length; if(state.offset>=(data.total||0)){ state.exhausted=true; loadMoreBtn.style.display="none"; }
};

/* ===== Search/sort ===== */
$("#searchInput").addEventListener("input",()=>{ clearTimeout(window.__st); window.__st=setTimeout(()=>{ state.search=$("#searchInput").value.trim(); state.topic=""; loadInitial(); },250); });
$("#sortSelect").addEventListener("change",()=>{ state.sort=$("#sortSelect").value; loadInitial(true); });

/* ===== Helpers ===== */
function showBD(node,on){ node.style.display=on?"flex":"none"; node.setAttribute("aria-hidden", on?"false":"true"); }
function confirmModal(title, body, requireText=null){
  return new Promise(resolve=>{
    const bd=document.createElement("div"); bd.className="backdrop"; bd.style.display="flex";
    const md=el("div",{className:"modal"},
      el("div",{className:"modal-head"}, el("div",{className:"modal-title"},title), el("button",{className:"icon",onclick:()=>{bd.remove(); resolve(false);}},"✕")),
      el("div",{className:"modal-body"},
        el("div",{},body),
        requireText?el("input",{className:"input",placeholder:requireText}):el("div"),
        el("div",{className:"row right"},
          el("button",{className:"btn",onclick:()=>{bd.remove(); resolve(false);}},"Cancel"),
          el("button",{className:"btn brand",onclick:()=>{ if(requireText){ const val=md.querySelector("input").value.trim(); if(val!==requireText) return; } bd.remove(); resolve(true); }},"Confirm")
        )
      )
    );
    bd.append(md); document.body.append(bd);
  });
}

/* ===== Deep links ===== */
function handleHash(){
  const h=location.hash||""; const m=h.match(/^#\/(post|user)\/(.+)$/); if(!m) return;
  if(m[1]==="post") openPostModal(m[2]); else openProfile(m[2]);
}
window.addEventListener("hashchange",handleHash);

/* ===== init ===== */
(async function(){
  feedEl.innerHTML=""; for(let i=0;i<3;i++) feedEl.append(el("div",{className:"card skeleton",style:"height:140px"}));
  await refreshSession();
  await loadInitial();
  handleHash();
})();
