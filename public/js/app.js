let socket = null;
let currentUserId = null;
let chattingWith = null;

// ---------------- Push Notification (Web Push) ----------------
// Replace with your own generated VAPID public key (Base64-url string)
const PUBLIC_VAPID_KEY = 'REPLACE_WITH_YOUR_PUBLIC_VAPID_KEY';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;++i){outputArray[i]=rawData.charCodeAt(i);}return outputArray;
}

async function registerPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !currentUserId) return;
  try{
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(PUBLIC_VAPID_KEY)});
    }
    await fetch('/api/save-sub', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUserId, sub})});
  }catch(err){console.warn('[push] setup failed', err);}
}
// ----------------------------------------------------------------

// UI Elements
// ---------------- Socket helper ----------------
function initSocket(){
  if(socket || !currentUserId) return;
  socket = io();
  // join personal signalling room
  socket.emit('join', currentUserId);
  console.log('[socket] joined personal room', currentUserId);
  // Auto-open chat tab on incoming VIDEO call
  socket.on('incoming_video', ({from, offer})=>{
    try { sessionStorage.setItem('pendingVideoOffer', JSON.stringify({from, offer})); } catch{}
    const popup = window.open(`chat.html?userId=${from}`, '_blank');
    if(!popup){
      alert(`${from} is video calling you ‑ open their chat to answer.`);
    }
  });
  // Auto-open chat tab on incoming VOICE call (optional)
  socket.on('incoming_call', ({from, offer})=>{
    console.log('DEBUG - App.js incoming call from:', from);
    try { sessionStorage.setItem('pendingVoiceOffer', JSON.stringify({from, offer})); } catch{}
    const popup = window.open(`chat.html?userId=${from}`, '_blank');
    if(!popup){
      const callerId = from; // Explicitly use the caller's ID
      alert(`${callerId} is calling you - open their chat to answer.`);
    }
  });
}
// -------------------------------------------------

const signupBox = document.getElementById('signup-box');
const loginBox = document.getElementById('login-box');
const showLogin = document.getElementById('show-login');
const showSignup = document.getElementById('show-signup');
const signupBtn = document.getElementById('signup-btn');
const loginBtn = document.getElementById('login-btn');
const signupError = document.getElementById('signup-error');
const loginError = document.getElementById('login-error');
const chatContainer = document.getElementById('chat-container');
const authContainer = document.getElementById('auth-container');
const userList = document.getElementById('user-list');
const chatBox = document.getElementById('chat-box');
const chatWith = document.getElementById('chat-with');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const closeChatBtn = document.getElementById('close-chat');
// Dropdown menu elements
const profileMenu = document.getElementById('profile-menu');
const profileAvatar = document.getElementById('profile-avatar');
function updateAvatar(){
  if (profileAvatar){
    profileAvatar.textContent = currentUserId ? currentUserId.charAt(0).toUpperCase() : '?';
  }
}
// Toggle dropdown and rebuild items each time avatar clicked
if(profileAvatar){
  profileAvatar.onclick = (e)=>{
    e.stopPropagation();
    if(profileMenu.style.display==='block'){
      profileMenu.style.display='none';
      return;
    }
    buildProfileMenu();
    profileMenu.style.display='block';
  };
  // hide menu on outside click
  document.addEventListener('click',()=>{profileMenu.style.display='none';});
}

function buildProfileMenu(){
  profileMenu.innerHTML='';
  // Login
  const loginBtn=document.createElement('button');
  loginBtn.textContent='Login';
  loginBtn.onclick=()=>{
    profileMenu.style.display='none';
    authContainer.style.display='block';
    chatContainer.style.display='none';
    signupBox.style.display='block';
    loginBox.style.display='none';
  };
  profileMenu.appendChild(loginBtn);
  // Sign up
  const signupBtnMenu=document.createElement('button');
  signupBtnMenu.textContent='Sign Up';
  signupBtnMenu.onclick=()=>{
    profileMenu.style.display='none';
    authContainer.style.display='block';
    chatContainer.style.display='none';
    signupBox.style.display='block';
    loginBox.style.display='none';
  };
  profileMenu.appendChild(signupBtnMenu);
  // Delete Account
  const delBtn=document.createElement('button');
  delBtn.textContent='Delete Account';
  delBtn.onclick=handleDeleteAccount;
  profileMenu.appendChild(delBtn);
  // Logout
  const logBtn=document.createElement('button');
  logBtn.textContent='Logout';
  logBtn.onclick=handleLogout;
  profileMenu.appendChild(logBtn);
}

function handleLogout(){
  profileMenu.style.display='none';
  if(!currentUserId) return;
  fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUserId})});
  localStorage.removeItem('currentUserId');
  currentUserId=null;
  updateAvatar();
  authContainer.style.display='block';
  chatContainer.style.display='none';
  signupBox.style.display='block';
  loginBox.style.display='none';
  if(socket) socket.disconnect();
}

async function handleDeleteAccount(){
  profileMenu.style.display='none';
  if(!currentUserId) return;
  if(!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  const res=await fetch('/api/delete-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUserId})});
  if(res.ok){
    alert('Account deleted successfully.');
    localStorage.clear();
    sessionStorage.clear();
    currentUserId=null;
    updateAvatar();
    authContainer.style.display='block';
    chatContainer.style.display='none';
    signupBox.style.display='block';
    loginBox.style.display='none';
    if(socket) socket.disconnect();
  }else{
    const data=await res.json();
    alert(data.message || 'Failed to delete account.');
  }
}

// --- Auto-login if userId exists in localStorage ---
const storedUserId = localStorage.getItem('currentUserId');
if (storedUserId) {
  currentUserId = storedUserId;
  updateAvatar();
  authContainer.style.display = 'none';
  chatContainer.style.display = 'block';
  initSocket();
  registerPush();
  fetchUsers();
} else {
  // Show signup page for new users
  authContainer.style.display = 'block';
  chatContainer.style.display = 'none';
  signupBox.style.display = 'block';
  loginBox.style.display = 'none';
}
// --------------------------------------------------

// Switch between login/signup
showLogin.onclick = () => {
  signupBox.style.display = 'none';
  loginBox.style.display = 'block';
};
showSignup.onclick = () => {
  loginBox.style.display = 'none';
  signupBox.style.display = 'block';
};

// Show signup page first by default
signupBox.style.display = 'block';
loginBox.style.display = 'none';

// Signup
signupBtn.onclick = async () => {
  const name = document.getElementById('signup-name').value.trim();
  const userId = document.getElementById('signup-userid').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !userId || !email || !password) {
    signupError.textContent = 'All fields are required.';
    return;
  }
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, userId, email, password })
  });
  const data = await res.json();
  if (res.ok) {
    signupError.textContent = '';
    currentUserId = userId;
    localStorage.setItem('currentUserId', userId);
    authContainer.style.display = 'none';
    chatContainer.style.display = 'block';
    updateAvatar();
    initSocket();
  registerPush();
    fetchUsers();
  } else {
    signupError.textContent = data.message || 'Signup failed.';
  }
};

// Login
loginBtn.onclick = async () => {
  const name = document.getElementById('login-name').value.trim();
  const userId = document.getElementById('login-userid').value.trim();
  const password = document.getElementById('login-password').value;
  if (!name || !userId || !password) {
    loginError.textContent = 'All fields are required.';
    return;
  }
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, userId, password })
  });
  const data = await res.json();
  if (res.ok) {
    loginError.textContent = '';
    currentUserId = userId;
    localStorage.setItem('currentUserId', userId); // Store user ID
    authContainer.style.display = 'none';
    chatContainer.style.display = 'block';
    updateAvatar();
    initSocket();
  registerPush();
    fetchUsers();
  } else {
    loginError.textContent = data.message || 'Login failed.';
  }
};

// Logout (guard element may not exist on auth page)
if (logoutBtn) logoutBtn.onclick = async () => {
  await fetch('/api/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUserId })
  });
  localStorage.removeItem('currentUserId'); // Remove user ID
  currentUserId = null;
  chattingWith = null;
  chatWith.textContent = '';
  chatBox.style.display = 'none';
  chatContainer.style.display = 'none';
  authContainer.style.display = 'block';
  signupBox.style.display = 'block';
  loginBox.style.display = 'none';
  if (socket) socket.disconnect();
};

// Delete Account
if (deleteBtn) deleteBtn.onclick = async () => {
  if (!currentUserId) return;
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  const res = await fetch('/api/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUserId })
  });
  if (res.ok) {
    alert('Account deleted successfully.');
    localStorage.clear();
    sessionStorage.clear();
    currentUserId = null;
    updateAvatar();
    authContainer.style.display = 'block';
    chatContainer.style.display = 'none';
    signupBox.style.display = 'block';
    loginBox.style.display = 'none';
    if (socket) socket.disconnect();
  } else {
    const data = await res.json();
    alert(data.message || 'Failed to delete account.');
  }
};

// Fetch users
async function fetchUsers() {
  const res = await fetch('/api/online-users');
  const data = await res.json();
  userList.innerHTML = '';
  const onlineUserIds = data.online || [];
  data.users.filter(u => u.userId !== currentUserId).forEach(user => {
    const li = document.createElement('li');
    // Create avatar container
    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'avatar-container';

    // Create avatar circle
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.textContent = user.name ? user.name.charAt(0).toUpperCase() : user.userId.charAt(0).toUpperCase();
    avatarContainer.appendChild(avatar);

    // If online, add green dot
    if (onlineUserIds.includes(user.userId)) {
      const dot = document.createElement('span');
      dot.className = 'online-dot';
      avatarContainer.appendChild(dot);
    }
    // Create name and id block
    const nameBlock = document.createElement('span');
    nameBlock.className = 'user-name-block';
    // Name first
    const nameRow = document.createElement('span');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = user.name || '';
    nameRow.appendChild(nameSpan);
    // 1px gap
    const gap = document.createElement('div');
    gap.style.height = '1px';
    // User ID with @
    const idSpan = document.createElement('span');
    idSpan.className = 'user-id';
    idSpan.textContent = '@' + user.userId;
    nameBlock.appendChild(nameRow);
    nameBlock.appendChild(gap);
    nameBlock.appendChild(idSpan);
    // Compose
    li.appendChild(avatarContainer);
    li.appendChild(nameBlock);
    li.onclick = () => {
      sessionStorage.setItem('chatTarget', user.userId);
      window.open('chat.html?userId=' + encodeURIComponent(user.userId), '_blank');
    };
    userList.appendChild(li);
  });
}

// Refresh user list every 5 seconds
setInterval(() => {
  if (currentUserId) fetchUsers();
}, 5000);

// === Local chat history helpers ===
function historyKey(uid, peer) {
  return `chat_history_${uid}_${peer}`;
}
function saveToHistory(entry) {
  const key = historyKey(entry.from, entry.to);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  arr.push(entry);
  localStorage.setItem(key, JSON.stringify(arr));
}
function loadHistory(uid, peer) {
  const key = historyKey(uid, peer);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  arr.forEach(it => addMessage(it.message, it.from === uid ? 'me' : 'them'));
}
// ----------------------------------

function initSocket() {
  socket = io();
  socket.emit('join', currentUserId);
  // Text messages
  socket.on('receive_message', ({ from, message, to, time }) => {
    const activeChats = JSON.parse(localStorage.getItem('activeChats') || '[]');
    // Only show alert if there is no active chat window for this sender
    if (from !== currentUserId && !activeChats.includes(from)) {
      alert(`New message from ${from}: ${message}`);
    }
    // persist
    saveToHistory({ from, to: currentUserId, message, time: time || Date.now(), type: 'text' });
  });

  // Voice messages
  socket.on('receive_voice', ({ from, audioType, dataUrl, id, to, time }) => {
    const activeChats = JSON.parse(localStorage.getItem('activeChats') || '[]');
    if (from !== currentUserId && !activeChats.includes(from)) {
      alert(`New voice message from ${from}`);
    }
    saveToHistory({ from, to: currentUserId, audioType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: time || Date.now(), type: 'voice' });
  });
}

function startChat(userId) {
  chattingWith = userId;
  chatWith.textContent = `Chatting with ${userId}`;
  chatBox.style.display = 'block';
  messagesDiv.innerHTML = '';
  loadHistory(currentUserId, chattingWith);
}

sendBtn.onclick = () => {
  const msg = messageInput.value.trim();
  if (!msg || !chattingWith) return;
  addMessage(msg, 'me');
  saveToHistory({ from: currentUserId, to: chattingWith, message: msg, time: Date.now(), type: 'text' });
  socket.emit('send_message', { to: chattingWith, from: currentUserId, message: msg });
  messageInput.value = '';
};

function addMessage(msg, who) {
  const div = document.createElement('div');
  div.className = 'message ' + who;
  div.textContent = msg;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

closeChatBtn.onclick = () => {
  chatBox.style.display = 'none';
  chattingWith = null;
  chatWith.textContent = '';
};
