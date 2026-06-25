const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const STATIC_DIR = __dirname;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = 'myhabits_data';
const PASS_KEY = 'myhabits_pass';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const DEFAULT_DATA = { habits: [], completions: {} };

function hashPass(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// --- Redis helpers ---
async function redisGet(key) {
  if (!REDIS_URL) return null;
  try {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const json = await res.json();
    let val = json.result || null;
    if (val && typeof val === 'string') {
      try { val = JSON.parse(val); } catch {}
    }
    return val;
  } catch { return null; }
}

async function redisSet(key, value) {
  if (!REDIS_URL) return;
  await fetch(`${REDIS_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

// --- Storage ---
const DATA_FILE = path.join(__dirname, 'data.json');

async function loadData() {
  if (REDIS_URL) {
    try {
      const raw = await redisGet(DATA_KEY);
      if (!raw) return DEFAULT_DATA;
      if (typeof raw === 'object') return raw;
      return JSON.parse(raw);
    } catch { return DEFAULT_DATA; }
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return DEFAULT_DATA; }
}

async function saveData(data) {
  if (REDIS_URL) {
    await redisSet(DATA_KEY, JSON.stringify(data));
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Auth check ---
async function checkAuth(req, res) {
  const authHeader = req.headers['x-auth-token'];
  if (!authHeader) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No token' }));
    return false;
  }
  const storedHash = await redisGet(PASS_KEY);
  if (!storedHash) return true; // no password set yet
  if (authHeader !== storedHash) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Wrong password' }));
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // --- Auth API ---

  // Check if password exists
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    const storedHash = await redisGet(PASS_KEY);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hasPassword: !!storedHash }));
    return;
  }

  // Set password (first time only)
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    const existing = await redisGet(PASS_KEY);
    if (existing) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password already set' }));
      return;
    }
    const body = JSON.parse(await readBody(req));
    const hash = hashPass(body.password);
    await redisSet(PASS_KEY, hash);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, token: hash }));
    return;
  }

  // Login
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const hash = hashPass(body.password);
    const storedHash = await redisGet(PASS_KEY);
    if (hash === storedHash) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token: hash }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong password' }));
    }
    return;
  }

  // --- Data API (protected) ---

  if (url.pathname === '/api/data' && req.method === 'GET') {
    if (!(await checkAuth(req, res))) return;
    const data = await loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname === '/api/data' && req.method === 'POST') {
    if (!(await checkAuth(req, res))) return;
    try {
      const data = JSON.parse(await readBody(req));
      await saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
    }
    return;
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(STATIC_DIR, filePath);
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MyHabits server running on http://localhost:${PORT}`);
  console.log(REDIS_URL ? '[OK] Using Upstash Redis for storage' : '[OK] Using local file for storage');
});
