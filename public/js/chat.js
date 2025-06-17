// chat.js - handles chat logic for chat.html (opened in new tab)

const urlParams = new URLSearchParams(window.location.search);
const chattingWith = urlParams.get('userId') || sessionStorage.getItem('chatTarget');

const chatHeaderName = document.getElementById('chat-header-name');
const chatHeaderId = document.getElementById('chat-header-id');
const chatAvatar = document.querySelector('.chat-avatar');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const chatForm = document.getElementById('chat-form');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPanel = document.getElementById('emoji-panel');
const voiceBtn = document.getElementById('voice-btn');
const moreBtn = document.getElementById('more-btn');
const callBtn = document.getElementById('call-btn');
const remoteAudio = document.getElementById('remote-audio');
let localStream = null;
let peerConnection = null;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

if (!chattingWith) {
  alert('No chat target specified. Please open a chat from the user list.');
  // don't close, allow user to navigate back
}
// Set header info (a real app would fetch this from a server)
chatHeaderName.textContent = chattingWith; // Using userId as name for now
chatHeaderId.textContent = '@' + chattingWith;
chatAvatar.textContent = chattingWith.charAt(0).toUpperCase();

// Get current userId from localStorage (ensure this is set on login)
const currentUserId = localStorage.getItem('currentUserId');

// --- Active Chat Tracking --- //
function getActiveChats() {
  return JSON.parse(localStorage.getItem('activeChats') || '[]');
}

function setActiveChats(chats) {
  localStorage.setItem('activeChats', JSON.stringify(chats));
}

// On load, add this chat to the active list
let activeChats = getActiveChats();
if (!activeChats.includes(chattingWith)) {
  activeChats.push(chattingWith);
  setActiveChats(activeChats);
}

// On close, remove this chat from the active list
window.addEventListener('beforeunload', () => {
  let currentActiveChats = getActiveChats();
  const index = currentActiveChats.indexOf(chattingWith);
  if (index > -1) {
    currentActiveChats.splice(index, 1);
    setActiveChats(currentActiveChats);
  }
});
// -------------------------- //

/************** MOBILE TOOLBAR TOGGLE **************/
if (moreBtn) {
  moreBtn.addEventListener('click', () => {
    chatForm.classList.toggle('show-tools');
  });
}
/***************************************************/

// === Local chat history persistence ===
function historyKey() {
  return `chat_history_${currentUserId}_${chattingWith}`;
}
function deletedKey() {
  const pair = [currentUserId, chattingWith].sort();
  return `deleted_ids_${pair[0]}_${pair[1]}`;
}

function loadHistory() {
  if (!currentUserId || !chattingWith) return;
  const raw = localStorage.getItem(historyKey());
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    const deletedArr = JSON.parse(localStorage.getItem(deletedKey())||'[]');
    arr.forEach(item => {
      if (deletedArr.includes(item.id)) return;
      if (item.type === 'text') {
        addMessage(item.from, item.message, new Date(item.time), item.id);
      } else if (item.type === 'file') {
        addMessage(item.from, {
          fileName: item.fileName,
          fileType: item.fileType,
          dataUrl: item.dataUrl,
          image: item.fileType.startsWith('image/') ? item.dataUrl : undefined,
          video: item.fileType.startsWith('video/') ? item.dataUrl : undefined,
        }, new Date(item.time), item.id);
      } else if(item.type==='voice'){
        addMessage(item.from, { audioType:item.audioType, dataUrl:item.dataUrl }, new Date(item.time), item.id);
      }
    });
  } catch {}
}

function saveToHistory(entry) {
  const key = historyKey();
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  arr.push(entry);
  localStorage.setItem(key, JSON.stringify(arr));
}

// Load existing history on startup
loadHistory();
// =====================================

// ---- Selection & Drag-to-Delete UI ----
let selectedIds = new Set();
// create trash zone (floating action button)
const trashZone = document.createElement('div');
trashZone.id = 'trash-zone';
trashZone.innerHTML = '🗑️';
document.body.appendChild(trashZone);

function updateTrashState() {
  if (selectedIds.size > 0) {
    trashZone.classList.add('active');
  } else {
    trashZone.classList.remove('active');
  }
}

function performDelete(ids) {
  if (!ids.length) return;
  // remove locally DOM
  ids.forEach(id => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (el) {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }
  });
  // update localStorage
  // track deleted ids list
  const delKey = deletedKey();
  const deletedArr = JSON.parse(localStorage.getItem(delKey)||'[]');
  ids.forEach(id=>{
    if(!deletedArr.includes(id)) deletedArr.push(id);
  });
  localStorage.setItem(delKey, JSON.stringify(deletedArr));
  // update localStorage history
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey())) || []; } catch{}
  history = history.filter(m => !ids.includes(m.id));
  localStorage.setItem(historyKey(), JSON.stringify(history));
  // notify server
  socket.emit('delete_message', { ids, to: chattingWith, from: currentUserId });
  // reset
  selectedIds.clear();
  updateTrashState();
}

// ---- Local delete (no broadcast) ----
function performLocalDelete(ids){
  if(!ids.length) return;
  ids.forEach(id=>{
    const el=document.querySelector(`[data-mid="${id}"]`);
    if(el){el.classList.add('fade-out');setTimeout(()=>el.remove(),300);} });
  const delKey=deletedKey();
  const deletedArr=JSON.parse(localStorage.getItem(delKey)||'[]');
  ids.forEach(id=>{ if(!deletedArr.includes(id)) deletedArr.push(id); });
  localStorage.setItem(delKey, JSON.stringify(deletedArr));
  let history=[];
  try{history=JSON.parse(localStorage.getItem(historyKey()))||[];}catch{}
  history=history.filter(m=>!ids.includes(m.id));
  localStorage.setItem(historyKey(), JSON.stringify(history));
  selectedIds.clear();
  updateTrashState();
}
// ---- Context menu ----
function showContextMenu(ev, mid, copyText, isSent){
  ev.preventDefault();
  document.querySelectorAll('.msg-context-menu').forEach(m=>m.remove());
  if(!document.getElementById('ctx-style')){
    const style=document.createElement('style');
    style.id='ctx-style';
    style.textContent=`.msg-context-menu{position:fixed;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.15);z-index:1000;} .msg-context-menu button{display:block;width:100%;padding:6px 10px;border:none;background:none;text-align:left;cursor:pointer;font-size:14px;} .msg-context-menu button:hover{background:#f0f0f0;}`;
    document.head.appendChild(style);
  }
  const menu=document.createElement('div');
  menu.className='msg-context-menu';
  menu.style.top=ev.clientY+'px';
  // Default anchor at click point then adjust after insertion
  menu.style.left=ev.clientX+'px';
  const copyBtn=document.createElement('button');
  copyBtn.textContent='Copy';
  copyBtn.onclick=()=>{ if(copyText) navigator.clipboard.writeText(copyText); menu.remove(); };
  const delBtn=document.createElement('button');
  delBtn.textContent='Delete';
  delBtn.onclick=()=>{ performLocalDelete([mid]); menu.remove(); };
  const delAllBtn=document.createElement('button');
  delAllBtn.textContent='Delete for All';
  delAllBtn.onclick=()=>{ performDelete([mid]); menu.remove(); };
  [copyBtn, delBtn, delAllBtn].forEach(b=>menu.appendChild(b));
  document.body.appendChild(menu);
  // After added, reposition horizontally opposite of message side
  const rect = menu.getBoundingClientRect();
  if(isSent){
    // message on right, place menu left of click so it points inward
    menu.style.left = (ev.clientX - rect.width - 8) + 'px';
  }else{
    // message on left, place menu right of click
    menu.style.left = (ev.clientX + 8) + 'px';
  }
  setTimeout(()=>{document.addEventListener('click', ()=>menu.remove(), { once:true});},0);
}

// ===== Full-screen media viewer =====
(function initMediaViewer(){
  if(document.getElementById('media-viewer-overlay')) return;
  const overlay=document.createElement('div');
  overlay.id='media-viewer-overlay';
  overlay.style='position:fixed;inset:0;display:none;justify-content:center;align-items:center;background:rgba(0,0,0,0.8);z-index:2000;';
  document.body.appendChild(overlay);
  overlay.addEventListener('click',()=>{overlay.style.display='none';overlay.innerHTML='';currentScale=1;});
  let currentScale=1;
  function setZoom(el,delta){
    currentScale=Math.min(5,Math.max(1,currentScale+(delta>0?-0.1:0.1)));
    el.style.transform=`scale(${currentScale})`;
  }
  overlay.addEventListener('wheel',e=>{
    const media=overlay.querySelector('.viewer-media');
    if(media) setZoom(media,e.deltaY);
    e.preventDefault();
  },{passive:false});
  // delegation
  messagesDiv.addEventListener('click', (e)=>{
    const target = e.target;
    if(!target.classList.contains('chat-media')) return;
    const messageDiv = target.closest('.message');
    if(!messageDiv) return;
    const mid = messageDiv.getAttribute('data-mid');
    const isSent = messageDiv.classList.contains('sent');

    // If double-click (detail===2) show context menu instead of fullscreen preview
    if(e.detail === 2){
      e.preventDefault();
      const copyText = target.getAttribute('alt') || '';
      showContextMenu(e, mid, copyText, isSent);
      return;
    }

    // Single click – show fullscreen preview
    const src = target.src || target.currentSrc;
    overlay.innerHTML='';
    let elem;
    if(target.dataset.type==='image'){
      elem=document.createElement('img');
      elem.src=src;
      elem.style='max-width:90vw;max-height:90vh;cursor:zoom-in;transition:transform 0.2s ease;';
    }else{
      elem=document.createElement('video');
      elem.src=src;
      elem.controls=true;
      elem.style='max-width:90vw;max-height:90vh;';
    }
    elem.className='viewer-media';
    overlay.appendChild(elem);
    overlay.style.display='flex';
    currentScale=1;
    e.stopPropagation();
  });
})();
// ====================================

// drag events for trashZone
trashZone.addEventListener('dragover', e => { e.preventDefault(); trashZone.classList.add('drag-over'); });
trashZone.addEventListener('dragleave', () => trashZone.classList.remove('drag-over'));
trashZone.addEventListener('drop', e => {
  e.preventDefault();
  trashZone.classList.remove('drag-over');
  const ids = Array.from(selectedIds);
  performDelete(ids);
});
// -------------------------------

// ---------------------------------
// Initialise socket immediately
const socket = io();

/********** Voice Call logic ***********/
async function initLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream;
  } catch (err) {
    alert('Microphone permission denied');
    throw err;
  }
}

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }
}

async function startCall() {
  if (!chattingWith) return;
  await initLocalStream();
  peerConnection = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('call_signal', { to: chattingWith, from: currentUserId, data: { candidate: e.candidate } });
    }
  };
  peerConnection.ontrack = e => {
    if (remoteAudio) remoteAudio.srcObject = e.streams[0];
  };
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('call_user', { to: chattingWith, from: currentUserId, offer });
}

async function handleIncomingOffer(from, offer) {
  await initLocalStream();
  peerConnection = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.onicecandidate = e => {
    if (e.candidate) socket.emit('call_signal', { to: from, from: currentUserId, data: { candidate: e.candidate } });
  };
  peerConnection.ontrack = e => {
    if (remoteAudio) remoteAudio.srcObject = e.streams[0];
  };
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call_signal', { to: from, from: currentUserId, data: { answer } });
}

async function handleAnswer(answer) {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleCandidate(candidate) {
  if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

if (callBtn) {
  callBtn.addEventListener('click', async () => {
    if (peerConnection) {
      // already in call, end it
      socket.emit('end_call', { to: chattingWith, from: currentUserId });
      closePeerConnection();
      callBtn.textContent = '📞';
    } else {
      callBtn.textContent = '🔴';
      startCall();
    }
  });
}

// Socket listeners for call
socket.on('incoming_call', async ({ from, offer }) => {
  const accept = confirm(`${from} is calling. Accept?`);
  if (!accept) {
    socket.emit('end_call', { to: from, from: currentUserId });
    return;
  }
  callBtn.textContent = '🔴';
  await handleIncomingOffer(from, offer);
});

socket.on('call_signal', async ({ from, data }) => {
  if (data.answer) {
    await handleAnswer(data.answer);
  } else if (data.candidate) {
    handleCandidate(data.candidate);
  }
});

socket.on('call_ended', () => {
  alert('Call ended');
  closePeerConnection();
  callBtn.textContent = '📞';
});
/****************************************/ 
// ---------------------------------
// Receive delete broadcast
// receive voice
socket.on('receive_voice', ({ from, audioType, dataUrl, id, time })=>{
  if (from === currentUserId) return; // already rendered locally
  addMessage(from, { audioType, dataUrl }, new Date(time), id);
  saveToHistory({ from, to: currentUserId, audioType, dataUrl, id, time, type:'voice' });
});

socket.on('delete_message', ({ ids }) => {
  if (!Array.isArray(ids) || !ids.length) return;
  ids.forEach(id => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (el) el.remove();
  });
  // remove from history
  const delKey = deletedKey();
  const deletedArr = JSON.parse(localStorage.getItem(delKey)||'[]');
  ids.forEach(id=>{ if(!deletedArr.includes(id)) deletedArr.push(id); });
  localStorage.setItem(delKey, JSON.stringify(deletedArr));
  // remove from history
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey())) || []; } catch{}
  history = history.filter(m => !ids.includes(m.id));
  localStorage.setItem(historyKey(), JSON.stringify(history));
});


// Join a room for this user to receive direct messages
if (currentUserId) {
  socket.emit('join', currentUserId);
}

// Send message
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = messageInput.value.trim();

  if (!currentUserId) {
    alert('Could not send message: User not identified. Please close this tab and log in again.');
    return;
  }

  if (!msg) {
    return;
  }

  const messageData = {
    to: chattingWith,
    from: currentUserId,
    message: msg,
  };

  const id = Date.now().toString(36) + Math.random().toString(36).substr(2,5);
  addMessage(currentUserId, msg, new Date(), id);
  messageData.id = id;
  socket.emit('send_message', messageData);
  saveToHistory({ ...messageData, id, type: 'text' });
  messageInput.value = '';
  messageInput.focus();
});

// Receive message
socket.on('receive_message', ({ from, to, message, time, id }) => {
  console.log('[Chat.js] Received message event:', { from, to, currentUserId, chattingWith });
  // Robustly check if the message is part of the current conversation
  if (from === currentUserId) return; // already rendered locally
  const isChatting = (to === chattingWith && from === currentUserId) || (to === currentUserId && from === chattingWith);
  if (isChatting) {
    addMessage(from, message, new Date(time), id);
    saveToHistory({ from, to, message, time, id, type: 'text' });
  }
});
socket.on('receive_file', ({ from, to, fileName, fileType, dataUrl, time }) => {
  if (from === currentUserId) return; // already rendered locally
  const isChatting = (to === chattingWith && from === currentUserId) || (to === currentUserId && from === chattingWith);
  if (isChatting) {
    const imageFlag = fileType && fileType.startsWith('image/') ? dataUrl : undefined;
    const videoFlag = fileType && fileType.startsWith('video/') ? dataUrl : undefined;
    addMessage(from, { fileName, fileType, dataUrl, image: imageFlag, video: videoFlag }, new Date(time));
    saveToHistory({ from, to, fileName, fileType, dataUrl, image: imageFlag, video: videoFlag, time, type: 'file' });
  }
});

// Handle file attachment click
// ===== Emoji Picker =====
const emojis = ['😀','😂','😊','😍','😘','😎','🤔','😢','😡','👍','🙏','🔥','🎉','❤️','💔','✨','✅','❌','⚽','🏀','🥳','😴','🙌','🤖','👀','🤩'];
function buildEmojiPanel(){
  emojiPanel.innerHTML='';
  emojis.forEach(e=>{
    const span=document.createElement('span');
    span.textContent=e;
    span.onclick=(ev)=>{
      messageInput.value+=e;
      messageInput.focus();
      emojiPanel.style.display='none';
    };
    emojiPanel.appendChild(span);
  });
}
if(emojiBtn){
  emojiBtn.onclick=(e)=>{
    e.stopPropagation();
    if(emojiPanel.style.display==='block'){
      emojiPanel.style.display='none';
      return;
    }
    if(!emojiPanel.hasChildNodes()) buildEmojiPanel();
    emojiPanel.style.display='block';
  };
  document.addEventListener('click',()=>{emojiPanel.style.display='none';});
}
// ========================

/************** VOICE MESSAGE LOGIC **************/
let mediaRecorder=null;
let voiceChunks=[];
let isRecording=false;

async function startVoiceRecording(){
  if(isRecording) return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder=new MediaRecorder(stream);
    voiceChunks=[];
    mediaRecorder.ondataavailable=e=>{if(e.data.size>0) voiceChunks.push(e.data);} ;
    mediaRecorder.onstop=()=>{
      if(!voiceChunks.length) return;
      const blob=new Blob(voiceChunks,{type:mediaRecorder.mimeType||'audio/webm'});
      const reader=new FileReader();
      reader.onloadend=()=>{
        const dataUrl=reader.result;
        sendVoiceMessage(dataUrl,blob.type);
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    isRecording=true;
    voiceBtn.classList.add('recording');
    // auto stop after 60s
    setTimeout(()=>{if(isRecording) stopVoiceRecording();},60000);
  }catch(err){
    console.error('Mic access',err);
    alert('Microphone access denied. Allow permission and try again.');
  }
}
function stopVoiceRecording(){
  if(!isRecording) return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t=>t.stop());
  isRecording=false;
  voiceBtn.classList.remove('recording');
}
function sendVoiceMessage(dataUrl,audioType){
  if(!currentUserId||!chattingWith) return;
  const id=Date.now().toString(36)+Math.random().toString(36).substr(2,5);
  addMessage(currentUserId,{audioType,dataUrl},new Date(),id);
  const payload={to:chattingWith,from:currentUserId,audioType,dataUrl,id,time:Date.now()};
  socket.emit('send_voice',payload);
  saveToHistory({...payload,type:'voice'});
}
if(voiceBtn){
  voiceBtn.addEventListener('mousedown',startVoiceRecording);
  voiceBtn.addEventListener('touchstart',startVoiceRecording);
  ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=>voiceBtn.addEventListener(ev,stopVoiceRecording));
}
/*************************************************/
// ========================

// File upload handling
attachBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const dataUrl = await readFileAsDataURL(file);
    
    // If it's an image, show preview first
    if (file.type.startsWith('image/')) {
      showImagePreview(dataUrl, file.name, () => {
        // This function will be called when user confirms sending
        sendFileMessage(dataUrl, file);
      });
    } else {
      // For non-image files, send directly
      sendFileMessage(dataUrl, file);
    }
  } catch (error) {
    console.error('Error reading file:', error);
    alert('Error uploading file. Please try again.');
  }
});

// Function to show image preview
function showImagePreview(dataUrl, fileName, onConfirm) {
  // Create preview container
  const previewContainer = document.createElement('div');
  previewContainer.className = 'image-preview-container';
  
  // Create preview content
  previewContainer.innerHTML = `
    <div class="image-preview">
      <img class="chat-media" data-type="image" src="${dataUrl}" alt="Preview">
      <div class="image-preview-info">
        <div class="image-name">${fileName}</div>
        <div class="image-preview-buttons">
          <button class="cancel-btn">Cancel</button>
          <button class="send-btn">Send</button>
        </div>
      </div>
    </div>
  `;

  // Add to messages area
  messagesDiv.appendChild(previewContainer);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Add event listeners
  const cancelBtn = previewContainer.querySelector('.cancel-btn');
  const sendBtn = previewContainer.querySelector('.send-btn');

  cancelBtn.addEventListener('click', () => {
    previewContainer.remove();
    fileInput.value = ''; // Reset file input
  });

  sendBtn.addEventListener('click', () => {
    previewContainer.remove();
    onConfirm();
  });
}

// Function to send file message
function sendFileMessage(dataUrl, file) {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2,5);
  
  // Add message locally
  addMessage(currentUserId, {
    fileName: file.name,
    fileType: file.type,
    dataUrl: dataUrl,
    image: file.type.startsWith('image/') ? dataUrl : undefined,
    video: file.type.startsWith('video/') ? dataUrl : undefined
  }, new Date(), id);

  // Send to server
  socket.emit('send_file', {
    to: chattingWith,
    from: currentUserId,
    fileName: file.name,
    fileType: file.type,
    dataUrl: dataUrl,
    id: id
  });

  // Save to history
  saveToHistory({
    from: currentUserId,
    to: chattingWith,
    fileName: file.name,
    fileType: file.type,
    dataUrl: dataUrl,
    id: id,
    time: new Date().toISOString(),
    video: file.type.startsWith('video/') ? dataUrl : undefined,
    type: 'file'
  });

  // Clear the input
  fileInput.value = '';
}

// Helper function to read file as Data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Update addMessage function to handle file messages
function addMessage(sender, content, time, id = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender === currentUserId ? 'sent' : 'received'}`;
  if (id) messageDiv.setAttribute('data-mid', id);

  let messageContent = '';
  if (typeof content === 'string') {
    // Text message
    messageContent = content;
  } else if (content.fileName) {
    // File message
    if (content.image) {
      // Image file
      messageContent = `
        <div class="file-message">
          <img class="chat-media" data-type="image" src="${content.image}" alt="${content.fileName}" style="max-width: 200px; max-height: 200px; border-radius: 8px;">
          <div class="file-info">${content.fileName}</div>
        </div>
      `;
    } else if (content.video || (content.fileType && content.fileType.startsWith('video/'))) {
      // Video file
      const videoSrc = content.video || content.dataUrl;
      messageContent = `
        <div class="file-message">
          <video class="chat-media" data-type="video" controls style="max-width: 240px; max-height: 200px; border-radius: 8px;">
            <source src="${videoSrc}" type="${content.fileType || 'video/mp4'}">
            Your browser does not support the video tag.
          </video>
          <div class="file-info">${content.fileName}</div>
        </div>
      `;
    } else {
      // Other file type
      messageContent = `
        <div class="file-message">
          <a href="${content.dataUrl}" download="${content.fileName}" class="file-link">
            <div class="file-icon">📎</div>
            <div class="file-info">
              <div class="file-name">${content.fileName}</div>
              <div class="file-type">${content.fileType}</div>
            </div>
          </a>
        </div>
      `;
    }
  } else if (content.audioType) {
    // Voice message
    messageContent = `
      <div class="voice-message">
        <audio controls>
          <source src="${content.dataUrl}" type="${content.audioType}">
          Your browser does not support the audio element.
        </audio>
      </div>
    `;
  }

  messageDiv.innerHTML = `
    ${messageContent}
    <span class="message-time">${formatTime(time)}</span>
    <span class="delete-btn">🗑️</span>
  `;

  // Add drag functionality
  messageDiv.draggable = true;
  messageDiv.addEventListener('dragstart', () => {
    selectedIds.add(id);
    updateTrashState();
  });
  messageDiv.addEventListener('dragend', () => {
    selectedIds.delete(id);
    updateTrashState();
  });

  // Double-click context menu
  messageDiv.addEventListener('dblclick', (ev) => {
    if(!id) return;
    const copyText = typeof content === 'string' ? content : (content.fileName ? content.fileName : '');
    const isSent = messageDiv.classList.contains('sent');
    showContextMenu(ev, id, copyText, isSent);
  });

  // Add click to select
  messageDiv.addEventListener('click', () => {
    if (selectedIds.size > 0) {
      messageDiv.classList.toggle('selected');
      if (messageDiv.classList.contains('selected')) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      updateTrashState();
    }
  });

  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function formatTime(date) {
  if (!date || isNaN(date)) {
    date = new Date();
  }
  let h = date.getHours();
  let m = date.getMinutes();
  let ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12; // The hour '0' should be '12'
  m = m < 10 ? '0' + m : m;
  return h + ':' + m + ' ' + ampm;
}
