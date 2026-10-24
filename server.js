// Egyszerű szerver. Indítás: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PASSWORD = '951753';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '753159'; // ezt cseréld le!
const users = {};      // id -> adatok (csak a memóriában, újraindításkor törlődik)
const left = new Set(); // akik kiléptek vagy ki lettek léptetve
const cmds = {};       // id -> 'clear' (admin levette a pontról)

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/terkep.jpg': ['terkep.jpg', 'image/jpeg'],
  '/riasztas.mp3': ['riasztas.mp3', 'audio/mpeg'],
};

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const list = () => Object.entries(users).map(([id, u]) => ({ id, ...u }));

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') {
    const b = await readBody(req);
    return send(res, b.pw === PASSWORD ? 200 : 401, { ok: b.pw === PASSWORD });
  }

  if (req.method === 'POST' && req.url === '/api/leave') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    delete users[b.id];
    left.add(b.id);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/admin/check') {
    const b = await readBody(req);
    return send(res, b.apw === ADMIN_PASSWORD ? 200 : 401, { ok: b.apw === ADMIN_PASSWORD });
  }

  if (req.method === 'POST' && req.url === '/api/admin/action') {
    const b = await readBody(req);
    if (b.apw !== ADMIN_PASSWORD) return send(res, 401, { ok: false });
    if (b.action === 'kick') {
      delete users[b.id];
      delete cmds[b.id];
      left.add(b.id);
    } else if (b.action === 'clear' && users[b.id]) {
      users[b.id].point = 0;
      users[b.id].help = false;
      cmds[b.id] = 'clear';
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/api/sync') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    if (b.id && left.has(b.id)) return send(res, 200, { ok: true, kicked: true, users: list() });
    let reset = false;
    if (b.id) {
      if (cmds[b.id] === 'clear') {
        delete cmds[b.id];
        reset = true;
        users[b.id] = { name: String(b.name || '').slice(0, 40), car: String(b.car || '').slice(0, 40),
          available: !!b.available, point: 0, help: false, seen: Date.now() };
      } else {
        users[b.id] = {
          name: String(b.name || '').slice(0, 40),
          car: String(b.car || '').slice(0, 40),
          available: !!b.available,
          point: Number(b.point) || 0,
          help: !!b.help,
          seen: Date.now(),
        };
      }
    }
    return send(res, 200, { ok: true, reset, users: list() });
  }

  const f = FILES[req.url.split('?')[0]];
  if (f) {
    fs.readFile(path.join(__dirname, f[0]), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Hiányzik a fájl: ' + f[0]); }
      res.writeHead(200, { 'Content-Type': f[1] });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Nincs ilyen oldal');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('A szerver fut! Nyisd meg: http://localhost:' + PORT);
});
