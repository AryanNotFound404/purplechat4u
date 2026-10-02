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
const joinScreen = $('joinScreen'), chatScreen = $('chatScreen'), messagesEl =$('messages');

let db = null;
let state = { room: null, nickname: null, userId: null, msgsRef: null, presenceRef: null, presenceAllRef: null, onlineUsers: [] };
let messagesCache = {};
let currentReplyTarget = null;

// --- Firebase init ---
try{
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
}catch(err){
  console.error('Firebase init failed:', err);
}
if(!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_')){
  const errEl = $('joinError');
  if(errEl) {
    errEl.textContent = '';
    errEl.classList.remove('hidden');
  }
}

function randomCode(){
  return 'room-' + Math.random().toString(36).slice(2, 8);
}

(function prefillFromUrl(){
  const room = new URLSearchParams(location.search).get('room');
  if(room) $('roomCode').value = room;
})();

$('createRoomBtn').onclick = () => {$('roomCode').value = randomCode(); };

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
  state.presenceAllRef = db.ref(`rooms/${room}/presence`);
  messagesCache = {};

  $('roomLabel').textContent = room;
  $('nickLabel').textContent = nickname;
  joinScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  messagesEl.innerHTML = '';

  // Presence logic (User Online State)
  state.presenceRef.set({ nickname, status: 'online', joinedAt: Date.now() });
  state.presenceRef.onDisconnect().set({ nickname, status: 'offline', joinedAt: Date.now() });

  // Listen for users status & deduplicate
  state.presenceAllRef.on('value', snap => {
    const presenceData = snap.val() || {};
    state.onlineUsers = Object.values(presenceData);

    const uniqueUsersMap = {};
    state.onlineUsers.forEach(u => {
      if (!u || !u.nickname) return;
      const existing = uniqueUsersMap[u.nickname];
      if (!existing) {
        uniqueUsersMap[u.nickname] = u;
      } else {
        if (u.status === 'online' && existing.status !== 'online') {
          uniqueUsersMap[u.nickname] = u;
        } else if (u.status === existing.status && (u.joinedAt || 0) > (existing.joinedAt || 0)) {
          uniqueUsersMap[u.nickname] = u;
        }
      }
    });

    const uniqueUsers = Object.values(uniqueUsersMap);
    updateOnlineStatusHeader(uniqueUsers.filter(u => u.status === 'online'));
    renderOnlineUsersList(uniqueUsers);
  });

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

// REALTIME ONLINE USERS HEADER STATUS
function updateOnlineStatusHeader(onlineUsers) {
  const statusEl = $('onlineStatusLabel');
  if (!statusEl) return;

  const count = onlineUsers.length;
  if (count === 0) {
    statusEl.innerHTML = '';
    return;
  }

  let text = '';
  if (count === 1) {
    text = `${escapeHtml(onlineUsers[0].nickname)} is online`;
  } else if (count === 2) {
    text = `${escapeHtml(onlineUsers[0].nickname)} and 1 other are online`;
  } else {
    text = `${escapeHtml(onlineUsers[0].nickname)} and ${count - 1} more are online`;
  }

  statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ${text}`;
}

// RENDER USERS LIST INSIDE MODAL
function renderOnlineUsersList(uniqueUsers = null) {
  const listEl = $('onlineUsersList');
  if (!listEl) return;

  let users = uniqueUsers;
  if (!users) {
    const rawUsers = state.onlineUsers || [];
    const uniqueMap = {};
    rawUsers.forEach(u => {
      if (!u || !u.nickname) return;
      const existing = uniqueMap[u.nickname];
      if (!existing) {
        uniqueMap[u.nickname] = u;
      } else {
        if (u.status === 'online' && existing.status !== 'online') {
          uniqueMap[u.nickname] = u;
        } else if (u.status === existing.status && (u.joinedAt || 0) > (existing.joinedAt || 0)) {
          uniqueMap[u.nickname] = u;
        }
      }
    });
    users = Object.values(uniqueMap);
  }

  if (users.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">No users found</p>';
    return;
  }

  users.sort((a, b) => {
    if (a.nickname === state.nickname) return -1;
    if (b.nickname === state.nickname) return 1;
    if (a.status === 'online' && b.status !== 'online') return -1;
    if (a.status !== 'online' && b.status === 'online') return 1;
    return 0;
  });

  listEl.innerHTML = users.map(u => {
    const isMe = u.nickname === state.nickname;
    const initial = u.nickname ? u.nickname[0].toUpperCase() : '?';
    const isOnline = u.status === 'online';

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/15">
        <div class="flex items-center gap-2.5 overflow-hidden">
          <div class="w-8 h-8 rounded-full bg-purple-600/30 border border-purple-400/40 flex items-center justify-center font-semibold text-purple-200 text-xs shrink-0">
            ${escapeHtml(initial)}
          </div>
          <span class="text-sm font-medium text-gray-100 truncate">${escapeHtml(u.nickname)} ${isMe ? '<span class="text-[10px] text-purple-400 font-normal">(You)</span>' : ''}</span>
        </div>
        
        <div class="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-md ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'}">
          <span class="w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}"></span>
          <span class="text-xs font-medium">${isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// HEADER CLICK TO OPEN USERS MODAL
const headerBox = $('headerTitleBox');
if (headerBox) {
  headerBox.onclick = () => {
    renderOnlineUsersList();
    const modal = $('onlineUsersModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  };
}

if ($('closeOnlineModal')) {$('closeOnlineModal').onclick = () => {
    $('onlineUsersModal').classList.add('hidden');$('onlineUsersModal').classList.remove('flex');
  };
}

if ($('onlineUsersModal')) {$('onlineUsersModal').addEventListener('click', e => {
    if (e.target.id === 'onlineUsersModal') {
      $('onlineUsersModal').classList.add('hidden');$('onlineUsersModal').classList.remove('flex');
    }
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

// SWIPE TO REPLY HELPER FUNCTIONS
function setReplyTarget(msgId, msg) {
  currentReplyTarget = { 
    id: msgId, 
    nickname: msg.nickname, 
    text: msg.text || (msg.type === 'image' ? '📷 Photo' : '') 
  };

  let replyBar = $('replyPreviewBar');
  if (!replyBar) {
    const inputArea = $('msgInput')?.parentElement;
    if (inputArea) {
      replyBar = document.createElement('div');
      replyBar.id = 'replyPreviewBar';
      replyBar.className = 'flex items-center justify-between bg-purple-950/60 border-l-4 border-purple-500 px-3 py-1.5 rounded-lg mb-2 text-xs backdrop-blur-sm';
      replyBar.innerHTML = `
        <div class="overflow-hidden mr-2">
          <p id="replyUserName" class="font-semibold text-purple-400 text-[11px]"></p>
          <p id="replyMsgText" class="text-purple-200/80 truncate text-[11px]"></p>
        </div>
        <button type="button" id="cancelReplyBtn" class="text-purple-400 hover:text-white text-base font-bold px-1">✕</button>
      `;
      inputArea.parentNode.insertBefore(replyBar, inputArea);
      $('cancelReplyBtn').onclick = cancelReply;
    }
  }

  if (replyBar) {
    $('replyUserName').textContent = `Replying to ${msg.nickname}`;
    $('replyMsgText').textContent = currentReplyTarget.text;
    replyBar.classList.remove('hidden');
    replyBar.classList.add('flex');
  }
}

function cancelReply() {
  currentReplyTarget = null;
  const replyBar = $('replyPreviewBar');
  if (replyBar) {
    replyBar.classList.add('hidden');
    replyBar.classList.remove('flex');
  }
}

function bubbleHTML(id, msg){
  const mine = msg.userId === state.userId;
  const time = fmtTime(msg.ts);
  const editedTag = msg.edited ? ' <span class="italic opacity-70">(edited)</span>' : '';
  
  const menu = `
    <button class="msg-menu-btn absolute top-1 right-1 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-black/20 opacity-70" data-id="${id}">&#8942;</button>
    <div class="msg-menu hidden absolute right-1 top-6 z-10 glass rounded-lg overflow-hidden text-xs w-32" data-id="${id}">
      <button class="msg-reply-btn block w-full text-left px-3 py-2 hover:bg-purple-500/20" data-id="${id}">Reply</button>
      ${mine && msg.type === 'message' ? `<button class="msg-edit-btn block w-full text-left px-3 py-2 hover:bg-purple-500/20" data-id="${id}">Edit Message</button>` : ''}
      ${mine ? `<button class="msg-delete-btn block w-full text-left px-3 py-2 hover:bg-red-500/20 text-red-300" data-id="${id}">Delete Message</button>` : ''}
    </div>`;

  const replyBox = msg.replyTo ? `
    <div class="mb-1.5 p-1.5 rounded bg-black/25 border-l-2 border-purple-400 text-xs select-none">
      <p class="font-semibold text-purple-300 text-[10px]">${escapeHtml(msg.replyTo.nickname)}</p>
      <p class="opacity-80 truncate text-[11px]">${escapeHtml(msg.replyTo.text)}</p>
    </div>` : '';

  const nickTag = !mine ? `<p class="text-xs text-purple-300 mb-0.5">${escapeHtml(msg.nickname)}</p>` : '';
  const body = msg.type === 'image'
    ? `<img class="msg-image" src="${msg.data}" data-full="${msg.data}" alt="shared image">`
    : `<p class="text-sm break-words pr-5">${escapeHtml(msg.text)}</p>`;

  return `
    <div class="msg-bubble max-w-[75%] ${mine ? 'bubble-sent' : 'bubble-received'} rounded-2xl px-4 py-2 relative touch-pan-y transition-transform duration-150 ease-out select-none">
      ${menu}
      ${nickTag}
      ${replyBox}
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
    wrap.className += ' flex justify-center my-1';
    wrap.innerHTML = `<span class="text-[11px] text-purple-300/60 bg-purple-500/10 px-3 py-1 rounded-full">${escapeHtml(msg.text)}</span>`;
  } else {
    const mine = msg.userId === state.userId;
    wrap.className += ` flex ${mine ? 'justify-end' : 'justify-start'} my-1`;
    wrap.innerHTML = bubbleHTML(id, msg);

    const bubbleEl = wrap.querySelector('.msg-bubble');
    enableSwipeToReply(bubbleEl, id, msg);
  }
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function enableSwipeToReply(bubbleEl, id, msg) {
  if (!bubbleEl) return;
  let startX = 0;
  let currentX = 0;
  let isSwiping = false;

  bubbleEl.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    currentX = 0;
    isSwiping = true;
    bubbleEl.style.transition = 'none';
  }, { passive: true });

  bubbleEl.addEventListener('touchmove', e => {
    if (!isSwiping) return;
    const x = e.touches[0].clientX - startX;
    if (x > 0 && x < 70) {
      currentX = x;
      bubbleEl.style.transform = `translateX(${x}px)`;
    }
  }, { passive: true });

  bubbleEl.addEventListener('touchend', () => {
    if (!isSwiping) return;
    isSwiping = false;
    bubbleEl.style.transition = 'transform 0.2s ease-out';
    bubbleEl.style.transform = 'translateX(0px)';

    if (currentX > 35) {
      setReplyTarget(id, msg);
    }
    currentX = 0;
  });
}

function updateMessageDom(id, msg){
  const wrap = messagesEl.querySelector(`[data-mid="${id}"]`);
  if(!wrap || msg.type === 'system') return;
  wrap.innerHTML = bubbleHTML(id, msg);
  enableSwipeToReply(wrap.querySelector('.msg-bubble'), id, msg);
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
  const replyBtn = e.target.closest('.msg-reply-btn');
  if(replyBtn){
    const id = replyBtn.dataset.id;
    const msg = messagesCache[id];
    if(msg) setReplyTarget(id, msg);
    closeAllMenus();
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
  $('imageModal').classList.remove('hidden');$('imageModal').classList.add('flex');
}
function closeImageModal(){
  $('imageModal').classList.add('hidden');
  $('imageModal').classList.remove('flex');$('imageModalImg').src = '';
}
$('imageModal').addEventListener('click', e => {
  if(e.target.id === 'imageModal' || e.target.id === 'closeImageModal') closeImageModal();
});

function sendMessage(e){
  if(e) e.preventDefault();
  const input = $('msgInput');
  const text = input.value.trim();
  if(!text || !state.msgsRef) return;

  input.value = '';

  const messageData = { 
    type: 'message', 
    text, 
    nickname: state.nickname, 
    userId: state.userId, 
    ts: Date.now() 
  };

  if (currentReplyTarget) {
    messageData.replyTo = {
      nickname: currentReplyTarget.nickname,
      text: currentReplyTarget.text
    };
    cancelReply();
  }

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

$('plusBtn').onclick = () => $('imageInput').click();$('imageInput').addEventListener('change', async e => {
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

$('deleteBtn').onclick = () => { $('deleteModal').classList.remove('hidden');$('deleteModal').classList.add('flex'); };
$('cancelDelete').onclick = () => {$('deleteModal').classList.add('hidden'); $('deleteModal').classList.remove('flex'); };$('confirmDelete').onclick = () => {
  if(state.msgsRef) state.msgsRef.remove();
  $('deleteModal').classList.add('hidden');$('deleteModal').classList.remove('flex');
};

$('leaveBtn').onclick = () => {
  if(state.presenceRef) state.presenceRef.set({ nickname: state.nickname, status: 'offline', joinedAt: Date.now() });
  if(state.presenceAllRef) state.presenceAllRef.off();
  if(state.msgsRef) state.msgsRef.off();
  cancelReply();
  chatScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  state = { room: null, nickname: null, userId: null, msgsRef: null, presenceRef: null, presenceAllRef: null, onlineUsers: [] };
  messagesCache = {};
  $('roomCode').value = '';
};
