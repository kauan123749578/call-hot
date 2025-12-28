const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const next = require('next');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// WebSocket Server para signaling (isola em /ws para não conflitar com WebSocket do Next)
const wss = new WebSocket.Server({ server, path: '/ws' });

// Armazena as salas de call (em produção, use Redis ou DB)
const calls = new Map(); // callId -> { videoUrl, hostId, guests: Set }

// Persistência simples em arquivo (para não perder calls ao reiniciar)
const dataDir = path.join(__dirname, 'data');
const callsFile = path.join(dataDir, 'calls.json');
const usersFile = path.join(dataDir, 'users.json');
const sessionsFile = path.join(dataDir, 'sessions.json');
const eventsFile = path.join(dataDir, 'events.json');
const salesFile = path.join(dataDir, 'sales.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(callsFile)) fs.writeFileSync(callsFile, JSON.stringify({ calls: [] }, null, 2));
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
  if (!fs.existsSync(sessionsFile)) fs.writeFileSync(sessionsFile, JSON.stringify({ sessions: [] }, null, 2));
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, JSON.stringify({ events: [] }, null, 2));
  if (!fs.existsSync(salesFile)) fs.writeFileSync(salesFile, JSON.stringify({ sales: [] }, null, 2));
}

function readJson(filePath, fallback) {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendEvent(evt) {
  const store = readJson(eventsFile, { events: [] });
  store.events = Array.isArray(store.events) ? store.events : [];
  store.events.push(evt);
  writeJson(eventsFile, store);
}

function listEvents(limit = 5000) {
  const store = readJson(eventsFile, { events: [] });
  const arr = Array.isArray(store.events) ? store.events : [];
  return arr.slice(Math.max(0, arr.length - limit));
}

function listSales() {
  const store = readJson(salesFile, { sales: [] });
  return Array.isArray(store.sales) ? store.sales : [];
}

function saveSales(sales) {
  writeJson(salesFile, { sales });
}

function parseCurrencyToNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  // aceita "R$50,90", "50.90", "50,90", "1.234,56", "1,234.56"
  const raw = input.replace(/\s/g, '').replace(/^R\$/i, '');
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  let normalized = raw;
  if (hasComma && hasDot) {
    // decide qual é decimal pelo último separador
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastComma > lastDot) {
      // decimal = ','  -> remove '.' milhares
      normalized = raw.replace(/\./g, '').replace(',', '.');
    } else {
      // decimal = '.'  -> remove ',' milhares
      normalized = raw.replace(/,/g, '');
    }
  } else if (hasComma) {
    // decimal = ',' (pt-BR)
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // se tiver exatamente 2 casas após o último '.', tratar como decimal
    const lastDot = raw.lastIndexOf('.');
    const decimals = raw.length - lastDot - 1;
    if (decimals === 2) {
      normalized = raw.replace(/,/g, '');
    } else {
      // provável milhares
      normalized = raw.replace(/\./g, '');
    }
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

function addSale({ callId, amount, note, userId }) {
  const sales = listSales();
  const item = { id: uuidv4(), callId, amount, note: note || null, at: new Date().toISOString(), userId: userId || null };
  sales.push(item);
  saveSales(sales);
  appendEvent({ id: uuidv4(), type: 'sale_marked', callId, at: item.at, amount: item.amount, userId: userId || null });
  return item;
}

function serializeCalls() {
  const out = [];
  for (const [callId, call] of calls.entries()) {
    out.push({
      callId,
      title: call.title || null,
      videoUrl: call.videoUrl,
      callerName: call.callerName || null,
      callerAvatarUrl: call.callerAvatarUrl || null,
      expiresAt: call.expiresAt ? new Date(call.expiresAt).toISOString() : null,
      expectedAmount: typeof call.expectedAmount === 'number' ? call.expectedAmount : null,
      ownerUserId: call.ownerUserId || null,
      createdAt: call.createdAt ? new Date(call.createdAt).toISOString() : new Date().toISOString()
    });
  }
  out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return out;
}

function persistCalls() {
  try {
    ensureDataDir();
    fs.writeFileSync(callsFile, JSON.stringify({ calls: serializeCalls() }, null, 2));
  } catch (e) {
    console.error('Erro ao persistir calls:', e);
  }
}

function loadCallsFromDisk() {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(callsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.calls) ? parsed.calls : [];
    items.forEach((item) => {
      if (!item?.callId || !item?.videoUrl) return;
      calls.set(item.callId, {
        title: item.title || null,
        videoUrl: item.videoUrl,
        callerName: item.callerName || null,
        callerAvatarUrl: item.callerAvatarUrl || null,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
        expectedAmount: typeof item.expectedAmount === 'number' ? item.expectedAmount : null,
        ownerUserId: item.ownerUserId || null,
        hostId: null,
        guests: new Set(),
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date()
      });
    });
  } catch (e) {
    console.error('Erro ao carregar calls do disco:', e);
  }
}

function isExpired(call) {
  if (!call?.expiresAt) return false;
  const t = new Date(call.expiresAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() > t;
}

// Cria pasta de uploads se não existir
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Pasta para avatares
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

// Configuração do Multer para upload de vídeos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024 // Aumentado para 1GB (era 500MB)
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo são permitidos'));
    }
  }
});

// Upload de avatar (imagem)
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas arquivos de imagem são permitidos'));
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));
app.use(cookieParser());
// IMPORTANTE: index:false para o Next.js poder responder "/" (senão cai no public/index.html)
app.use(express.static('public', { index: false }));
app.use('/uploads', express.static('public/uploads'));

// Auth helpers (session cookie)
const SESSION_COOKIE = 'cs_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getSession(sessionId) {
  const store = readJson(sessionsFile, { sessions: [] });
  const s = (store.sessions || []).find((x) => x.sessionId === sessionId);
  if (!s) return null;
  const created = new Date(s.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  if (Date.now() - created > SESSION_MAX_AGE_MS) return null;
  return s;
}

function requireAuth(req, res, nextFn) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return res.status(401).json({ error: 'Não autenticado' });
  const s = getSession(sid);
  if (!s) return res.status(401).json({ error: 'Sessão inválida' });
  req.userId = s.userId;
  nextFn();
}

function setSession(res, userId) {
  const store = readJson(sessionsFile, { sessions: [] });
  const sessionId = crypto.randomBytes(24).toString('hex');
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  store.sessions.push({ sessionId, userId, createdAt: new Date().toISOString() });
  writeJson(sessionsFile, store);
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_MAX_AGE_MS
  });
}

function clearSession(req, res) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const store = readJson(sessionsFile, { sessions: [] });
    store.sessions = (store.sessions || []).filter((x) => x.sessionId !== sid);
    writeJson(sessionsFile, store);
  }
  res.clearCookie(SESSION_COOKIE);
}

// Auth endpoints
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string') return res.status(400).json({ error: 'usuário é obrigatório' });
  if (!password || typeof password !== 'string' || password.length < 3) {
    return res.status(400).json({ error: 'password deve ter pelo menos 3 caracteres' });
  }
  const store = readJson(usersFile, { users: [] });
  store.users = Array.isArray(store.users) ? store.users : [];
  const exists = store.users.some((u) => (u.username || '').toLowerCase() === username.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Usuário já cadastrado' });
  const userId = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  store.users.push({ userId, username, passwordHash, createdAt: new Date().toISOString() });
  writeJson(usersFile, store);
  setSession(res, userId);
  res.json({ ok: true, userId, username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string') return res.status(400).json({ error: 'usuário é obrigatório' });
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'password é obrigatório' });
  const store = readJson(usersFile, { users: [] });
  const user = (store.users || []).find((u) => (u.username || u.email || '').toLowerCase() === username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
  setSession(res, user.userId);
  res.json({ ok: true, userId: user.userId, username: user.username || user.email });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return res.status(401).json({ error: 'Não autenticado' });
  const s = getSession(sid);
  if (!s) return res.status(401).json({ error: 'Sessão inválida' });
  const store = readJson(usersFile, { users: [] });
  const user = (store.users || []).find((u) => u.userId === s.userId);
  if (!user) return res.status(401).json({ error: 'Sessão inválida' });
  res.json({ ok: true, userId: user.userId, username: user.username || user.email });
});
// Rotas HTML dinâmicas (para funcionar com /call/:id, /host/:id, etc.)
app.get('/call/:callId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'call.html'));
});

app.get('/host/:callId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Simulador: "chamada" com vídeo (sem WebRTC)
app.get('/video/:callId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'video.html'));
});

// Rota para criar uma nova call
app.post('/api/create-call', requireAuth, (req, res) => {
  const { videoUrl, callerName, callerAvatarUrl, title, expiresInMinutes, expectedAmount } = req.body;
  
  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl é obrigatório' });
  }

  let expectedAmountNum = null;
  if (expectedAmount !== undefined && expectedAmount !== null && expectedAmount !== '') {
    const n = parseCurrencyToNumber(expectedAmount);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'expectedAmount deve ser número > 0' });
    // arredonda 2 casas
    expectedAmountNum = Math.round(n * 100) / 100;
  }

  let expiresAt = null;
  if (expiresInMinutes !== undefined && expiresInMinutes !== null && expiresInMinutes !== '') {
    const mins = Number(expiresInMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      return res.status(400).json({ error: 'expiresInMinutes deve ser um número > 0' });
    }
    expiresAt = new Date(Date.now() + mins * 60 * 1000);
  }

  const callId = uuidv4();
  calls.set(callId, {
    title: typeof title === 'string' ? title : null,
    videoUrl,
    callerName: typeof callerName === 'string' ? callerName : null,
    callerAvatarUrl: typeof callerAvatarUrl === 'string' ? callerAvatarUrl : null,
    expiresAt,
    expectedAmount: expectedAmountNum,
    ownerUserId: req.userId || null,
    hostId: null,
    guests: new Set(),
    createdAt: new Date()
  });
  persistCalls();

  appendEvent({
    id: uuidv4(),
    type: 'call_created',
    callId,
    at: new Date().toISOString(),
    userId: req.userId || null
  });

  // Se informou valor, registra venda automaticamente na criação do link
  let sale = null;
  if (expectedAmountNum && expectedAmountNum > 0) {
    sale = addSale({
      callId,
      amount: expectedAmountNum,
      note: 'Venda registrada na criação do link',
      userId: req.userId || null
    });
  }

  res.json({ 
    callId, 
    url: `/call/${callId}`,
    hostUrl: `/host/${callId}`,
    ringUrl: `/ring/${callId}`,
    videoUrlPage: `/video/${callId}`,
    sale
  });
});

// Rota para upload de vídeo
app.post('/api/upload-video', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const videoUrl = `/uploads/${req.file.filename}`;
  res.json({ videoUrl, filename: req.file.filename });
});

// Rota para upload de avatar
app.post('/api/upload-avatar', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  res.json({ avatarUrl, filename: req.file.filename });
});

// Rota para obter informações da call
app.get('/api/call/:callId', (req, res) => {
  const { callId } = req.params;
  const call = calls.get(callId);

  if (!call) {
    return res.status(404).json({ error: 'Call não encontrada' });
  }

  if (isExpired(call)) {
    return res.status(410).json({ error: 'Link expirado' });
  }

  // Log básico: quando o lead consulta a call (sem sessão)
  const sid = req.cookies?.[SESSION_COOKIE];
  const isAuthed = sid ? !!getSession(sid) : false;
  if (!isAuthed) {
    appendEvent({ id: uuidv4(), type: 'ring_open', callId, at: new Date().toISOString() });
  }

  res.json({
    callId,
    title: call.title || null,
    videoUrl: call.videoUrl,
    callerName: call.callerName,
    callerAvatarUrl: call.callerAvatarUrl,
    expiresAt: call.expiresAt ? new Date(call.expiresAt).toISOString() : null,
    hasHost: !!call.hostId,
    guestsCount: call.guests.size
  });
});

// Lista calls persistidas (para dashboard multi-dispositivo)
app.get('/api/calls', requireAuth, (req, res) => {
  const list = serializeCalls()
    .filter((c) => !c.ownerUserId || c.ownerUserId === req.userId)
    .map((c) => ({
    ...c,
    expired: c.expiresAt ? Date.now() > new Date(c.expiresAt).getTime() : false
  }));
  res.json({ calls: list });
});

// Renomeia call
app.patch('/api/call/:callId', requireAuth, (req, res) => {
  const { callId } = req.params;
  const call = calls.get(callId);
  if (!call) return res.status(404).json({ error: 'Call não encontrada' });
  if (call.ownerUserId && call.ownerUserId !== req.userId) return res.status(403).json({ error: 'Sem permissão' });

  const { title, expiresInMinutes, expireNow, clearExpiry } = req.body || {};
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return res.status(400).json({ error: 'title deve ser string' });
  }

  call.title = (typeof title === 'string' && title.trim()) ? title.trim() : null;

  if (expireNow === true) {
    call.expiresAt = new Date(Date.now() - 1000);
  } else if (clearExpiry === true) {
    call.expiresAt = null;
  } else if (expiresInMinutes !== undefined && expiresInMinutes !== null && expiresInMinutes !== '') {
    const mins = Number(expiresInMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      return res.status(400).json({ error: 'expiresInMinutes deve ser um número > 0' });
    }
    call.expiresAt = new Date(Date.now() + mins * 60 * 1000);
  }

  calls.set(callId, call);
  persistCalls();
  res.json({ ok: true, callId, title: call.title, expiresAt: call.expiresAt ? new Date(call.expiresAt).toISOString() : null });
});

// Apagar call (remove também vendas/eventos relacionados)
app.delete('/api/call/:callId', requireAuth, (req, res) => {
  const { callId } = req.params;
  const call = calls.get(callId);
  if (!call) return res.status(404).json({ error: 'Call não encontrada' });
  if (call.ownerUserId && call.ownerUserId !== req.userId) return res.status(403).json({ error: 'Sem permissão' });

  calls.delete(callId);
  persistCalls();

  // remove vendas relacionadas
  const salesStore = readJson(salesFile, { sales: [] });
  salesStore.sales = (Array.isArray(salesStore.sales) ? salesStore.sales : []).filter((s) => s.callId !== callId);
  writeJson(salesFile, salesStore);

  // remove eventos relacionados
  const evtStore = readJson(eventsFile, { events: [] });
  evtStore.events = (Array.isArray(evtStore.events) ? evtStore.events : []).filter((e) => e.callId !== callId);
  writeJson(eventsFile, evtStore);

  appendEvent({ id: uuidv4(), type: 'call_deleted', callId, at: new Date().toISOString(), userId: req.userId || null });
  res.json({ ok: true });
});

// Track público (lead) para eventos específicos
app.post('/api/track', (req, res) => {
  const { callId, type } = req.body || {};
  if (typeof callId !== 'string' || !calls.get(callId)) return res.status(400).json({ error: 'callId inválido' });
  const allowed = new Set(['call_answer', 'video_open', 'call_end']);
  if (typeof type !== 'string' || !allowed.has(type)) return res.status(400).json({ error: 'type inválido' });
  appendEvent({ id: uuidv4(), type, callId, at: new Date().toISOString() });
  res.json({ ok: true });
});

// Histórico (privado)
app.get('/api/history', requireAuth, (req, res) => {
  const events = listEvents(8000);
  // filtra por owner quando possível
  const mine = events.filter((e) => {
    const c = calls.get(e.callId);
    return !c?.ownerUserId || c.ownerUserId === req.userId;
  });
  res.json({ events: mine });
});

// Vendas (privado)
app.get('/api/sales', requireAuth, (req, res) => {
  const sales = listSales().filter((s) => {
    const c = calls.get(s.callId);
    return !c?.ownerUserId || c.ownerUserId === req.userId;
  });
  res.json({ sales });
});

app.post('/api/sales', requireAuth, (req, res) => {
  const { callId, amount, note } = req.body || {};
  if (typeof callId !== 'string' || !calls.get(callId)) return res.status(400).json({ error: 'callId inválido' });
  const c = calls.get(callId);
  if (c?.ownerUserId && c.ownerUserId !== req.userId) return res.status(403).json({ error: 'Sem permissão' });
  const amt = parseCurrencyToNumber(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount deve ser número > 0' });
  const item = addSale({ callId, amount: Math.round(amt * 100) / 100, note: typeof note === 'string' ? note : null, userId: req.userId || null });
  res.json({ ok: true, sale: item });
});

// Next.js (dashboard moderna / ring UI)
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: __dirname });
const nextHandler = nextApp.getRequestHandler();

// WebSocket signaling
wss.on('connection', (ws, req) => {
  let clientId = null;
  let callId = null;
  let role = null; // 'host' ou 'guest'

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'join':
          callId = data.callId;
          role = data.role;
          clientId = data.clientId || uuidv4();
          
          // Armazena informações no WebSocket para uso nas funções de broadcast
          ws.callId = callId;
          ws.role = role;
          ws.clientId = clientId;

          const call = calls.get(callId);
          if (!call) {
            ws.send(JSON.stringify({ type: 'error', message: 'Call não encontrada' }));
            return;
          }

          if (role === 'host') {
            call.hostId = clientId;
            // Notifica todos os guests que o host entrou
            broadcastToGuests(callId, { type: 'host-joined' });
          } else if (role === 'guest') {
            call.guests.add(clientId);
            // Notifica o host que um guest entrou
            broadcastToHost(callId, { type: 'guest-joined', guestId: clientId });
          }

          ws.send(JSON.stringify({ 
            type: 'joined', 
            clientId, 
            callId,
            videoUrl: call.videoUrl 
          }));
          break;

        case 'offer':
          // Host envia offer para guest
          if (role === 'host') {
            broadcastToGuest(callId, data.targetGuestId, {
              type: 'offer',
              offer: data.offer,
              hostId: clientId
            });
          }
          break;

        case 'answer':
          // Guest responde com answer
          if (role === 'guest') {
            broadcastToHost(callId, {
              type: 'answer',
              answer: data.answer,
              guestId: clientId
            });
          }
          break;

        case 'ice-candidate':
          // Envia ICE candidate
          if (role === 'host') {
            broadcastToGuest(callId, data.targetGuestId, {
              type: 'ice-candidate',
              candidate: data.candidate
            });
          } else if (role === 'guest') {
            broadcastToHost(callId, {
              type: 'ice-candidate',
              candidate: data.candidate,
              guestId: clientId
            });
          }
          break;

        case 'ready':
          // Guest está pronto para receber áudio
          if (role === 'guest') {
            broadcastToHost(callId, {
              type: 'guest-ready',
              guestId: clientId
            });
          }
          break;

        case 'play':
          // Host sinaliza para iniciar vídeo
          if (role === 'host') {
            broadcastToGuests(callId, {
              type: 'play',
              timestamp: Date.now()
            });
          }
          break;
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    if (callId && role) {
      const call = calls.get(callId);
      if (call) {
        if (role === 'host') {
          call.hostId = null;
          broadcastToGuests(callId, { type: 'host-left' });
        } else if (role === 'guest') {
          call.guests.delete(clientId);
          broadcastToHost(callId, { type: 'guest-left', guestId: clientId });
        }
      }
    }
  });
});

// Funções auxiliares para broadcast
function broadcastToHost(callId, message) {
  const call = calls.get(callId);
  if (!call || !call.hostId) return;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && 
        client.callId === callId && 
        client.role === 'host' &&
        client.clientId === call.hostId) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastToGuest(callId, guestId, message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && 
        client.callId === callId && 
        client.role === 'guest' &&
        client.clientId === guestId) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastToGuests(callId, message) {
  const call = calls.get(callId);
  if (!call) return;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && 
        client.callId === callId && 
        client.role === 'guest' &&
        call.guests.has(client.clientId)) {
      client.send(JSON.stringify(message));
    }
  });
}

const PORT = process.env.PORT || 8080;

async function start() {
  loadCallsFromDisk();
  await nextApp.prepare();

  // Deixa o Next responder tudo que não for /api, /uploads, /call/:id, /host/:id, /video/:id
  app.all('*', (req, res) => nextHandler(req, res));

  server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📹 Crie uma call: POST http://localhost:${PORT}/api/create-call`);
  });
}

start().catch((e) => {
  console.error('Falha ao iniciar servidor:', e);
  process.exit(1);
});

