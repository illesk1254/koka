// Egyszerű szerver. Indítás: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PASSWORD = '951753';
const users = {};
const left = new Set(); // akik kiléptek: a még úton lévő jelzésük se tegye vissza őket // id -> adatok (csak a memóriában, újraindításkor törlődik)

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

  if (req.method === 'POST' && req.url === '/api/sync') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    if (b.id && !left.has(b.id)) {
      users[b.id] = {
        name: String(b.name || '').slice(0, 40),
        car: String(b.car || '').slice(0, 40),
        available: !!b.available,
        point: Number(b.point) || 0,
        help: !!b.help,
        seen: Date.now(),
      };
    }
    return send(res, 200, { ok: true, users: Object.entries(users).map(([id, u]) => ({ id, ...u })) });
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
