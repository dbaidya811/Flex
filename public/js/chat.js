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

// Receive file (image/pdf/etc.)
socket.on('receive_file', ({ from, to, fileName, fileType, dataUrl, time }) => {
  if (from === currentUserId) return; // already rendered locally
  const isChatting = (to === chattingWith && from === currentUserId) || (to === currentUserId && from === chattingWith);
  if (isChatting) {
    addMessage(from, { fileName, fileType, dataUrl }, new Date(time));
    saveToHistory({ from, to, fileName, fileType, dataUrl, time, type: 'file' });
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
      <img src="${dataUrl}" alt="Preview">
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
    image: file.type.startsWith('image/') ? dataUrl : undefined
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
          <img src="${content.image}" alt="${content.fileName}" style="max-width: 200px; max-height: 200px; border-radius: 8px;">
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
