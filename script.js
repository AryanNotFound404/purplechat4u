// ==== PASTE YOUR FIREBASE CONFIG HERE ====
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://talk-to-me-once-default-rtdb.firebaseio.com/",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
// ==========================================

const $ = id => document.getElementById(id);
const joinScreen = $('joinScreen'), chatScreen = $('chatScreen'), messagesEl = $('messages');

let db = null;
let state = { room: null, nickname: null, userId: null, msgsRef: null, presenceRef: null };
let messagesCache = {};

// --- Firebase init (guarded so a bad/missing config can't silently kill the whole script) ---
try{
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
}catch(err){
  console.error('Firebase init failed:', err);
}
if(!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_')){
  const errEl = $('joinError');
  errEl.textContent = '';
  errEl.classList.remove('hidden');
}

function randomCode(){
  return 'room-' + Math.random().toString(36).slice(2, 8);
}

// prefill room code if this page was opened from a "Copy Link" invite
(function prefillFromUrl(){
  const room = new URLSearchParams(location.search).get('room');
  if(room) $('roomCode').value = room;
})();

$('createRoomBtn').onclick = () => { $('roomCode').value = randomCode(); };

$('joinBtn').onclick = () => {
  const nickname = $('nickname').value.trim();
  const room = $('roomCode').value.trim();
  const errEl = $('joinError');
  if(!db){
    errEl.textContent = 'Firebase is not configured yet — check firebaseConfig in script.js.';
    errEl.classList.remove('hidden');
    return;
  }
  if(!nickname || !room){
    errEl.textContent = 'Enter a nickname and a room code.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  joinRoom(nickname, room);
};

function joinRoom(nickname, room){
  state.nickname = nickname;
  state.room = room;
  state.userId = Math.random().toString(36).slice(2, 10);
  state.msgsRef = db.ref(`rooms/${room}/messages`);
  state.presenceRef = db.ref(`rooms/${room}/presence/${state.userId}`);
  messagesCache = {};

  $('roomLabel').textContent = room;
  $('nickLabel').textContent = nickname;
  joinScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  messagesEl.innerHTML = '';

  // presence + system join/leave notifications
  state.presenceRef.set({ nickname, joinedAt: Date.now() });
  state.presenceRef.onDisconnect().remove();
  state.msgsRef.push({ type: 'system', text: `${nickname} joined the room`, ts: Date.now() });
  const leaveMsgRef = state.msgsRef.push();
  leaveMsgRef.onDisconnect().set({ type: 'system', text: `${nickname} left the room`, ts: Date.now() });

  state.msgsRef.on('child_added', snap => renderMessage(snap.key, snap.val()));
  state.msgsRef.on('child_changed', snap => {
    messagesCache[snap.key] = snap.val();
    updateMessageDom(snap.key, snap.val());
  });
  state.msgsRef.on('child_removed', snap => {
    delete messagesCache[snap.key];
    const el = messagesEl.querySelector(`[data-mid="${snap.key}"]`);
    if(el) el.remove();
  });
  state.msgsRef.on('value', snap => {
    if(!snap.exists()){ messagesEl.innerHTML = ''; messagesCache = {}; }
  });
}

function fmtTime(ts){
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(){
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function bubbleHTML(id, msg){
  const mine = msg.userId === state.userId;
  const time = fmtTime(msg.ts);
  const editedTag = msg.edited ? ' <span class="italic opacity-70">(edited)</span>' : '';
  const menu = mine ? `
    <button class="msg-menu-btn absolute top-1 right-1 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-black/20 opacity-70" data-id="${id}">&#8942;</button>
    <div class="msg-menu hidden absolute right-1 top-6 z-10 glass rounded-lg overflow-hidden text-xs w-32" data-id="${id}">
      ${msg.type === 'message' ? `<button class="msg-edit-btn block w-full text-left px-3 py-2 hover:bg-purple-500/20" data-id="${id}">Edit Message</button>` : ''}
      <button class="msg-delete-btn block w-full text-left px-3 py-2 hover:bg-red-500/20 text-red-300" data-id="${id}">Delete Message</button>
    </div>` : '';
  const nickTag = !mine ? `<p class="text-xs text-purple-300 mb-0.5">${escapeHtml(msg.nickname)}</p>` : '';
  const body = msg.type === 'image'
    ? `<img class="msg-image" src="${msg.data}" data-full="${msg.data}" alt="shared image">`
    : `<p class="text-sm break-words ${mine ? 'pr-5' : ''}">${escapeHtml(msg.text)}</p>`;
  return `
    <div class="max-w-[75%] ${mine ? 'bubble-sent' : 'bubble-received'} rounded-2xl px-4 py-2 relative">
      ${menu}
      ${nickTag}
      ${body}
      <p class="text-[10px] mt-1 ${mine ? 'text-purple-100/70' : 'text-gray-500'}">${time}${editedTag}</p>
    </div>`;
}

function renderMessage(id, msg){
  if(!msg) return;
  messagesCache[id] = msg;
  const wrap = document.createElement('div');
  wrap.classList.add('fade-in');
  wrap.dataset.mid = id;
  if(msg.type === 'system'){
    wrap.className += ' flex justify-center';
    wrap.innerHTML = `<span class="text-[11px] text-purple-300/60 bg-purple-500/10 px-3 py-1 rounded-full">${escapeHtml(msg.text)}</span>`;
  } else {
    const mine = msg.userId === state.userId;
    wrap.className += ` flex ${mine ? 'justify-end' : 'justify-start'}`;
    wrap.innerHTML = bubbleHTML(id, msg);
  }
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function updateMessageDom(id, msg){
  const wrap = messagesEl.querySelector(`[data-mid="${id}"]`);
  if(!wrap || msg.type === 'system') return;
  wrap.innerHTML = bubbleHTML(id, msg);
}

function closeAllMenus(){
  messagesEl.querySelectorAll('.msg-menu').forEach(m => m.classList.add('hidden'));
}
document.addEventListener('click', e => {
  if(!e.target.closest('.msg-menu-btn') && !e.target.closest('.msg-menu')) closeAllMenus();
});

messagesEl.addEventListener('click', e => {
  const menuBtn = e.target.closest('.msg-menu-btn');
  if(menuBtn){
    e.stopPropagation();
    const id = menuBtn.dataset.id;
    const menu = messagesEl.querySelector(`.msg-menu[data-id="${id}"]`);
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if(wasHidden) menu.classList.remove('hidden');
    return;
  }
  const editBtn = e.target.closest('.msg-edit-btn');
  if(editBtn){ handleEdit(editBtn.dataset.id); return; }
  const delBtn = e.target.closest('.msg-delete-btn');
  if(delBtn){ handleDelete(delBtn.dataset.id); return; }
  const img = e.target.closest('.msg-image');
  if(img){ openImageModal(img.dataset.full); return; }
});

function handleEdit(id){
  const msg = messagesCache[id];
  if(!msg || msg.type !== 'message') return;
  const newText = prompt('Edit message:', msg.text);
  if(newText === null) return;
  const trimmed = newText.trim();
  if(!trimmed || trimmed === msg.text) return;
  db.ref(`rooms/${state.room}/messages/${id}`).update({ text: trimmed, edited: true });
}

function handleDelete(id){
  if(!confirm('Delete this message for everyone?')) return;
  db.ref(`rooms/${state.room}/messages/${id}`).remove();
}

function openImageModal(src){
  $('imageModalImg').src = src;
  $('imageModal').classList.remove('hidden');
  $('imageModal').classList.add('flex');
}
function closeImageModal(){
  $('imageModal').classList.add('hidden');
  $('imageModal').classList.remove('flex');
  $('imageModalImg').src = '';
}
$('imageModal').addEventListener('click', e => {
  if(e.target.id === 'imageModal' || e.target.id === 'closeImageModal') closeImageModal();
});

function sendMessage(e){
  if(e) e.preventDefault(); // no <form> in this markup, but guard anyway in case one is added later
  const input = $('msgInput');
  const text = input.value.trim();
  if(!text || !state.msgsRef) return;

  input.value = ''; // clear immediately for a snappy, optimistic UI

  const messageData = { type: 'message', text, nickname: state.nickname, userId: state.userId, ts: Date.now() };
  console.log("Sending message...", messageData);

  state.msgsRef.push(messageData).catch(err => {
    console.error("Firebase Send Error:", err);
    alert('Message failed to send — check the browser console for details.');
  });
}
$('sendBtn').onclick = sendMessage;
$('msgInput').addEventListener('keydown', e => {
  if(e.key === 'Enter'){ e.preventDefault(); sendMessage(); }
});

function compressImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 900;
        let { width, height } = img;
        if(width > maxDim || height > maxDim){
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$('plusBtn').onclick = () => $('imageInput').click();
$('imageInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file || !state.msgsRef) return;
  if(!file.type.startsWith('image/')){ alert('Please choose an image file.'); return; }
  try{
    const dataUrl = await compressImage(file);
    if(dataUrl.length > 900000){ alert('That image is too large even after compression. Try a smaller photo.'); return; }
    state.msgsRef.push({ type: 'image', data: dataUrl, nickname: state.nickname, userId: state.userId, ts: Date.now() });
  }catch(err){
    alert('Could not process that image.');
  }
});

$('saveBtn').onclick = () => {
  const lines = Object.entries(messagesCache)
    .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
    .map(([id, m]) => {
      const time = fmtTime(m.ts);
      if(m.type === 'system') return `[${time}] * ${m.text}`;
      const body = m.type === 'image' ? '[Image]' : (m.text || '');
      const editedTag = m.edited ? ' (edited)' : '';
      return `[${time}] ${m.nickname}: ${body}${editedTag}`;
    });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `secret-chat-${state.room}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('copyLinkBtn').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room)}`;
  const label = $('copyLinkBtn').querySelector('.btn-label');
  navigator.clipboard.writeText(url).then(() => {
    if(label){
      const prev = label.textContent;
      label.textContent = 'Copied!';
      setTimeout(() => { label.textContent = prev; }, 1500);
    }
  }).catch(() => alert('Could not copy automatically. Here is the link:\n' + url));
};

$('deleteBtn').onclick = () => { $('deleteModal').classList.remove('hidden'); $('deleteModal').classList.add('flex'); };
$('cancelDelete').onclick = () => { $('deleteModal').classList.add('hidden'); $('deleteModal').classList.remove('flex'); };
$('confirmDelete').onclick = () => {
  if(state.msgsRef) state.msgsRef.remove();
  $('deleteModal').classList.add('hidden');
  $('deleteModal').classList.remove('flex');
};

$('leaveBtn').onclick = () => {
  if(state.msgsRef) state.msgsRef.push({ type: 'system', text: `${state.nickname} left the room`, ts: Date.now() });
  if(state.presenceRef) state.presenceRef.remove();
  if(state.msgsRef) state.msgsRef.off();
  chatScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  state = { room: null, nickname: null, userId: null, msgsRef: null, presenceRef: null };
  messagesCache = {};
  $('roomCode').value = '';
};
