const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');


const app = express();
const server = http.createServer(app);
// Increase buffer size to allow base64 audio payload (~50MB)
const io = socketIo(server, { maxHttpBufferSize: 5e7 });

const USERS_FILE = path.join(__dirname, 'users.json');
let onlineUsers = {};

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Push Notification helpers ----------------
const SUBS_FILE = path.join(__dirname, 'subs.json');
function readSubs(){ if(!fs.existsSync(SUBS_FILE)) return []; return JSON.parse(fs.readFileSync(SUBS_FILE)); }
function writeSubs(arr){ fs.writeFileSync(SUBS_FILE, JSON.stringify(arr, null, 2)); }

webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.PUBLIC_VAPID_KEY || 'REPLACE_WITH_PUBLIC_VAPID_KEY',
  process.env.PRIVATE_VAPID_KEY || 'REPLACE_WITH_PRIVATE_VAPID_KEY'
);
function sendPushToUser(userId, payload){
  const list = readSubs();
  const rec = list.find(s=>s.userId===userId);
  if(!rec) return;
  webpush.sendNotification(rec.sub, JSON.stringify(payload)).catch(err=>console.warn('[push] error', err));
}
// ------------------------------------------------------------

// Helper to read users
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}
// Helper to write users
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Signup endpoint
app.post('/api/signup', (req, res) => {
  const { name, userId, email, password } = req.body;
  let users = readUsers();
  if (users.find(u => u.userId === userId || u.email === email)) {
    return res.status(400).json({ message: 'User already exists' });
  }
  users.push({ name, userId, email, password });
  writeUsers(users);
  // Auto-login: mark this user as online immediately after successful signup
  onlineUsers[userId] = true;
  res.json({ message: 'Signup successful', userId });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { name, userId, password } = req.body;
  let users = readUsers();
  const user = users.find(u => u.userId === userId && u.name === name && u.password === password);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  onlineUsers[userId] = true;
  res.json({ message: 'Login successful', userId });
});

// Get all users (for user list) and online status
app.get('/api/online-users', (req, res) => {
  const users = readUsers().map(u => ({ userId: u.userId, name: u.name }));
  const online = Object.keys(onlineUsers);
  res.json({ users, online });
});

// Logout endpoint
app.post('/api/save-sub',(req,res)=>{
  const {userId, sub}=req.body;
  if(!userId||!sub) return res.status(400).json({message:'userId and sub required'});
  let list = readSubs();
  const idx = list.findIndex(x=>x.userId===userId);
  if(idx>-1) list[idx].sub=sub; else list.push({userId, sub});
  writeSubs(list);
  res.json({message:'saved'});
});

app.post('/api/logout', (req, res) => {
  const { userId } = req.body;
  delete onlineUsers[userId];
  res.json({ message: 'Logged out' });
});

// Delete account endpoint
app.post('/api/delete-account', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId required' });
  let users = readUsers();
  const originalLen = users.length;
  users = users.filter(u => u.userId !== userId);
  if (users.length === originalLen) {
    return res.status(404).json({ message: 'User not found' });
  }
  writeUsers(users);
  delete onlineUsers[userId];
  res.json({ message: 'Account deleted' });
});

// Socket.IO for chat
io.on('connection', (socket) => {
  console.log(`[Socket.IO] A user connected with socket ID: ${socket.id}`);
  let currentUser = null;


  // Client will explicitly emit 'join' once it knows its userId. If desired, auto-join can be implemented here after user auth.
  socket.on('join', (userId) => {
    console.log(`[Socket.IO] Socket ID ${socket.id} is joining room: ${userId}`);
    currentUser = userId;
    socket.join(userId);
  });

  socket.on('send_message', ({ to, from, message, id }) => {
    console.log(`[Socket.IO] Received message from ${from} to ${to}. Broadcasting to rooms: [${to}, ${from}]`);
    const messageData = { from, to, message, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_message', messageData);
    io.to(from).emit('receive_message', messageData);
    // Push notification to receiver
    try{sendPushToUser(to,{title:'New message', body:`${from}: ${message}`, url:`/chat.html?userId=${from}`});}catch(e){}

  });

  socket.on('send_image', ({ to, from, image, id }) => {
    console.log(`[Socket.IO] Received image from ${from} to ${to}. Broadcasting to rooms: [${to}, ${from}]`);
    const imageData = { from, to, image, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_image', imageData);
    io.to(from).emit('receive_image', imageData);
  });

  // Voice message transfer
  socket.on('send_voice', ({ to, from, audioType, dataUrl, id }) => {
    console.log(`[Socket.IO] Voice message from ${from} to ${to}`);
    const voiceData = { from, to, audioType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_voice', voiceData);
    io.to(from).emit('receive_voice', voiceData);
  });

  // Generic file transfer (e.g., PDF, docx, etc.)
  socket.on('send_file', ({ to, from, fileName, fileType, dataUrl, id }) => {
  });

  // Generic file transfer (e.g., PDF, docx, etc.)
  socket.on('send_file', ({ to, from, fileName, fileType, dataUrl, id }) => {
    console.log(`[Socket.IO] Received file '${fileName}' (${fileType}) from ${from} to ${to}. Broadcasting.`);
    const fileData = { from, to, fileName, fileType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_file', fileData);
    io.to(from).emit('receive_file', fileData);
  });

  // delete messages
  socket.on('delete_message', ({ ids, to, from }) => {
    console.log(`[Socket.IO] Delete request for ids ${ids.join(',')} from ${from} affecting ${to}`);
    io.to(to).emit('delete_message', { ids });
    io.to(from).emit('delete_message', { ids });
  });

  // Voice call signaling
  socket.on('call_user', ({ to, from, offer }) => {
    console.log(`[Socket.IO] ${from} is calling ${to}`);
    io.to(to).emit('incoming_call', { from, offer });
    try{sendPushToUser(to,{title:'Incoming call', body:`${from} is calling…`, url:`/chat.html?userId=${from}`});}catch(e){}

  });

  socket.on('call_signal', ({ to, from, data }) => {
    io.to(to).emit('call_signal', { from, data });
  });

  socket.on('end_call', ({ to, from }) => {
    io.to(to).emit('call_ended');
    io.to(from).emit('call_ended');
  });

    // video signalling
  socket.on('video_call',({to,from,offer})=>{io.to(to).emit('incoming_video',{from,offer});
  try{sendPushToUser(to,{title:'Incoming video call', body:`${from} is video calling…`, url:`/chat.html?userId=${from}`});}catch(e){}
});
  socket.on('video_signal',({to,from,data})=>{io.to(to).emit('video_signal',{from,data});});
  socket.on('video_end',({to,from})=>{io.to(to).emit('video_ended');io.to(from).emit('video_ended');});

  socket.on('disconnect', () => {
    if (currentUser) {
      // Optional: log disconnection
      // console.log(`[Socket.IO] User ${currentUser} with socket ID ${socket.id} disconnected.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
