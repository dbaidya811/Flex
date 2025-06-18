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
const videoBtn = document.getElementById('video-btn');
const videoOverlay = document.getElementById('video-overlay');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const endVideoBtn = document.getElementById('end-video-btn');
let videoPeer = null;
let videoStream = null;
const remoteAudio = document.getElementById('remote-audio');
let localStream = null;
let peerConnection = null;
const rtcConfig = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',   username:'openrelayproject', credential:'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username:'openrelayproject', credential:'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject', credential:'openrelayproject' }
] };

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

// Global event delegation for double-click on file messages
messagesDiv.addEventListener('dblclick', (ev) => {
  const target = ev.target;
  const messageDiv = target.closest('.message');
  
  if (!messageDiv) return;
  
  const mid = messageDiv.getAttribute('data-mid');
  if (!mid) return;
  
  // Check if click is on file message elements or text message
  const isFileMessage = target.closest('.file-message');
  const isVoiceMessage = target.closest('.voice-message');
  const isChatMedia = target.classList.contains('chat-media');
  const isFileLink = target.closest('.file-link');
  const isMessageDiv = target === messageDiv;
  const isMessageTime = target.closest('.message-time');
  const isDeleteBtn = target.closest('.delete-btn');
  
  if (isFileMessage || isVoiceMessage || isChatMedia || isFileLink || isMessageDiv || isMessageTime || isDeleteBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    
    // Get the message content from the DOM
    let copyText = '';
    const fileInfo = messageDiv.querySelector('.file-info');
    const fileName = messageDiv.querySelector('.file-name');
    const voiceMessage = messageDiv.querySelector('.voice-message');
    
    if (fileInfo) {
      copyText = fileInfo.textContent;
    } else if (fileName) {
      copyText = fileName.textContent;
    } else if (voiceMessage) {
      copyText = 'Voice Message';
    } else {
      // For text messages, get the text content excluding time and delete button
      const messageContent = messageDiv.cloneNode(true);
      const timeElement = messageContent.querySelector('.message-time');
      const deleteElement = messageContent.querySelector('.delete-btn');
      if (timeElement) timeElement.remove();
      if (deleteElement) deleteElement.remove();
      copyText = messageContent.textContent.replace(/[\n\r]/g, ' ').trim();
    }
    
    const isSent = messageDiv.classList.contains('sent');
    showContextMenu(ev, mid, copyText, isSent);
  }
});

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
    if(el){
      el.classList.add('fade-out');
      setTimeout(()=>el.remove(),300);
    }
  });
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
  
  const menu=document.createElement('div');
  menu.className='msg-context-menu';
  
  // Position menu at click point
  menu.style.top=ev.clientY+'px';
  menu.style.left=ev.clientX+'px';
  
  const copyBtn=document.createElement('button');
  copyBtn.textContent='📋 Copy';
  copyBtn.onclick=()=>{ 
    if(copyText) {
      navigator.clipboard.writeText(copyText);
      // Show feedback
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
      }, 1000);
    }
    menu.remove(); 
  };
  
  const delBtn=document.createElement('button');
  delBtn.textContent='🗑️ Delete (Local)';
  delBtn.onclick=()=>{ 
    performLocalDelete([mid]); 
    menu.remove(); 
  };
  
  const delAllBtn=document.createElement('button');
  delAllBtn.textContent='🗑️ Delete for All';
  delAllBtn.onclick=()=>{ 
    performDelete([mid]); 
    menu.remove(); 
  };
  
  [copyBtn, delBtn, delAllBtn].forEach(b=>menu.appendChild(b));
  document.body.appendChild(menu);
  
  // Reposition menu to ensure it stays within viewport
  const rect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Adjust horizontal position
  if(rect.right > viewportWidth) {
    menu.style.left = (ev.clientX - rect.width - 8) + 'px';
  }
  
  // Adjust vertical position
  if(rect.bottom > viewportHeight) {
    menu.style.top = (ev.clientY - rect.height - 8) + 'px';
  }
  
  // Close menu when clicking outside
  setTimeout(()=>{
    document.addEventListener('click', ()=>menu.remove(), { once:true });
  }, 0);
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
  
  // Single click handler for media files to show fullscreen preview
  messagesDiv.addEventListener('click', (e)=>{
    const target = e.target;
    if(!target.classList.contains('chat-media')) return;
    
    // Only handle single clicks, double-clicks are handled by global event delegation
    if(e.detail !== 1) return;
    
    const messageDiv = target.closest('.message');
    if(!messageDiv) return;

    // Show fullscreen preview
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
// Join personal room for private or media signaling
socket.emit('join', currentUserId);
console.log('[Socket] joined room', currentUserId);
// If this tab was auto-opened due to an incoming video call
(function(){
  const pending = sessionStorage.getItem('pendingVideoOffer');
  if(!pending) return;
  try {
    const {from, offer} = JSON.parse(pending);
    if(from === chattingWith && offer){
      handleVideoOffer(from, offer);
    }
  } catch{}
  sessionStorage.removeItem('pendingVideoOffer');
})();

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
  console.log('CALL DEBUG: currentUserId:', currentUserId, 'chattingWith:', chattingWith);
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
        remoteAudio.play().catch(()=>{});
  };
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('DEBUG - Emitting call_user with to:', chattingWith, 'from:', currentUserId);
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
        remoteAudio.play().catch(()=>{});
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
  console.log('DEBUG - Incoming call from:', from, 'Current user:', currentUserId, 'Chatting with:', chattingWith);
  console.log('DEBUG - Caller ID (from):', from);
  console.log('DEBUG - This should be the person who initiated the call');
  // The 'from' parameter should always be the person who is calling
  // Even if we're currently chatting with someone else
  const callerId = from; // This is the person who initiated the call
  const accept = confirm(`${callerId} is calling you. Accept?`);
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
/********** Video Call logic ***********/
async function initVideoStream(){
  if(videoStream) return videoStream;
  console.log('DEBUG - Initializing video stream');
  try {
    // Request both video and audio with specific constraints
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    console.log('DEBUG - Video stream obtained:', videoStream.getTracks().length, 'tracks');
    console.log('DEBUG - Tracks:', videoStream.getTracks().map(t => t.kind));
    
    if(localVideo) {
      localVideo.srcObject = videoStream;
      localVideo.muted = true; // Mute local video to prevent echo
      localVideo.play().catch(err=>console.log('Local video play error:', err));
      console.log('DEBUG - Local video set');
    }
    return videoStream;
  } catch(err) {
    console.error('DEBUG - Error getting video stream:', err);
    // Try with just video if audio fails
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      console.log('DEBUG - Video-only stream obtained');
      if(localVideo) {
        localVideo.srcObject = videoStream;
        localVideo.muted = true;
        localVideo.play().catch(err=>console.log('Local video play error:', err));
      }
      return videoStream;
    } catch(videoErr) {
      console.error('DEBUG - Error getting video-only stream:', videoErr);
      throw videoErr;
    }
  }
}
function closeVideoPeer(){
  console.log('DEBUG - Closing video peer');
  if(videoBtn) videoBtn.textContent='🎥';
  if(videoPeer){
    videoPeer.close();
    videoPeer=null;
    console.log('DEBUG - Video peer closed');
  }
  if(videoOverlay) videoOverlay.style.display='none';
  if(remoteVideo) remoteVideo.srcObject=null;
  if(localVideo && videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
    localVideo.srcObject = null;
    console.log('DEBUG - Video streams stopped and cleaned up');
  }
}
async function startVideoCall(){
  if(!chattingWith) return;
  console.log('DEBUG - Starting video call to:', chattingWith);
  
  try {
    await initVideoStream();
    videoPeer = new RTCPeerConnection(rtcConfig);
    
    // Add all tracks from the stream
    videoStream.getTracks().forEach(track => {
      console.log('DEBUG - Adding track to peer connection:', track.kind);
      videoPeer.addTrack(track, videoStream);
    });
    
    videoPeer.onicecandidate = e => {
      if(e.candidate) {
        console.log('DEBUG - Sending ICE candidate');
        socket.emit('video_signal', {to: chattingWith, from: currentUserId, data: {candidate: e.candidate}});
      }
    };
    
    videoPeer.ontrack = e => {
      console.log('DEBUG - Received remote video stream');
      if(remoteVideo) {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.play().catch(err => console.log('Remote video play error:', err));
      }
    };
    
    videoPeer.oniceconnectionstatechange = () => {
      console.log('DEBUG - ICE connection state:', videoPeer.iceConnectionState);
    };
    
    const offer = await videoPeer.createOffer();
    await videoPeer.setLocalDescription(offer);
    console.log('DEBUG - Emitting video_call to', chattingWith);
    socket.emit('video_call', {to: chattingWith, from: currentUserId, offer});
    
    if(videoOverlay) videoOverlay.style.display = 'flex';
    if(videoBtn) videoBtn.textContent = '🔴';
    console.log('DEBUG - Video overlay displayed');
  } catch(err) {
    console.error('DEBUG - Error starting video call:', err);
    alert('Failed to start video call. Please check camera and microphone permissions.');
  }
}
async function handleVideoOffer(from, offer){
  console.log('DEBUG - Handling video offer from:', from);
  
  try {
    await initVideoStream();
    videoPeer = new RTCPeerConnection(rtcConfig);
    
    // Add all tracks from the stream
    videoStream.getTracks().forEach(track => {
      console.log('DEBUG - Adding track to peer connection:', track.kind);
      videoPeer.addTrack(track, videoStream);
    });
    
    videoPeer.onicecandidate = e => {
      if(e.candidate) {
        console.log('DEBUG - Sending ICE candidate');
        socket.emit('video_signal', {to: from, from: currentUserId, data: {candidate: e.candidate}});
      }
    };
    
    videoPeer.ontrack = e => {
      console.log('DEBUG - Received remote video stream in handleVideoOffer');
      if(remoteVideo) {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.play().catch(err => console.log('Remote video play error:', err));
      }
    };
    
    videoPeer.oniceconnectionstatechange = () => {
      console.log('DEBUG - ICE connection state:', videoPeer.iceConnectionState);
    };
    
    await videoPeer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await videoPeer.createAnswer();
    await videoPeer.setLocalDescription(answer);
    socket.emit('video_signal', {to: from, from: currentUserId, data: {answer}});
    
    if(videoOverlay) videoOverlay.style.display = 'flex';
    if(videoBtn) videoBtn.textContent = '🔴';
    console.log('DEBUG - Video overlay displayed in handleVideoOffer');
  } catch(err) {
    console.error('DEBUG - Error handling video offer:', err);
    alert('Failed to accept video call. Please check camera and microphone permissions.');
  }
}
async function handleVideoAnswer(answer){
  if(videoPeer) {
    try {
      console.log('DEBUG - Handling video answer');
      await videoPeer.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('DEBUG - Video answer handled successfully');
    } catch(err) {
      console.error('DEBUG - Error handling video answer:', err);
    }
  }
}
function handleVideoCandidate(c){
  if(videoPeer) {
    try {
      console.log('DEBUG - Handling video candidate');
      videoPeer.addIceCandidate(new RTCIceCandidate(c));
      console.log('DEBUG - Video candidate added successfully');
    } catch(err) {
      console.error('DEBUG - Error handling video candidate:', err);
    }
  }
}
if(videoBtn){
  videoBtn.addEventListener('click', () => {
    console.log('DEBUG - Video button clicked, current videoPeer:', videoPeer);
    if(videoPeer){
      console.log('DEBUG - Ending video call');
      socket.emit('video_end', {to: chattingWith, from: currentUserId});
      closeVideoPeer();
      videoBtn.textContent = '🎥';
    } else {
      console.log('DEBUG - Starting video call');
      startVideoCall().catch(err => {
        console.error('DEBUG - Failed to start video call:', err);
        videoBtn.textContent = '🎥';
      });
    }
  });
}
if(endVideoBtn){
  endVideoBtn.addEventListener('click', () => {
    console.log('DEBUG - End video button clicked');
    socket.emit('video_end', {to: chattingWith, from: currentUserId});
    closeVideoPeer();
  });
}
// socket listeners
socket.on('incoming_video', async ({from, offer}) => {
  console.log('DEBUG - Incoming video call from:', from, 'Current user:', currentUserId);
  console.log('DEBUG - Video caller ID (from):', from);
  const videoCallerId = from; // Explicitly use the caller's ID
  if(confirm(`${videoCallerId} is video calling you. Accept?`)){
    console.log('DEBUG - Video call accepted, handling offer');
    try {
      await handleVideoOffer(from, offer);
    } catch(err) {
      console.error('DEBUG - Failed to handle video offer:', err);
      alert('Failed to accept video call. Please check camera and microphone permissions.');
    }
  } else {
    console.log('DEBUG - Video call rejected');
    socket.emit('video_end', {to: from, from: currentUserId});
  }
});
socket.on('video_signal', ({from, data}) => {
  console.log('DEBUG - Video signal from:', from, 'data type:', Object.keys(data));
  if(data.answer) {
    console.log('DEBUG - Handling video answer');
    handleVideoAnswer(data.answer);
  } else if(data.candidate) {
    console.log('DEBUG - Handling video candidate');
    handleVideoCandidate(data.candidate);
  }
});
socket.on('video_ended', () => {
  console.log('DEBUG - Video call ended');
  alert('Video call ended');
  closeVideoPeer();
});
/********** End Video ***********/
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
socket.on('receive_file', ({ from, to, fileName, fileType, dataUrl, time, id }) => {
  if (from === currentUserId) return; // already rendered locally
  const isChatting = (to === chattingWith && from === currentUserId) || (to === currentUserId && from === chattingWith);
  if (isChatting) {
    const imageFlag = fileType && fileType.startsWith('image/') ? dataUrl : undefined;
    const videoFlag = fileType && fileType.startsWith('video/') ? dataUrl : undefined;
    addMessage(from, { fileName, fileType, dataUrl, image: imageFlag, video: videoFlag }, new Date(time), id);
    saveToHistory({ from, to, fileName, fileType, dataUrl, image: imageFlag, video: videoFlag, time, id, type: 'file' });
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
  if (id) {
    messageDiv.setAttribute('data-mid', id);
  }

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
