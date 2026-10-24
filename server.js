// Egyszerű szerver. Indítás: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PASSWORD = '951753';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '753159'; // ezt cseréld le!
const INACTIVE_MS = 30 * 60 * 1000; // ennyi jelzés nélküli idő után "inaktív" az autó (30 perc)

const users = {};       // id -> adatok (csak a memóriában, újraindításkor törlődik)
const left = new Set(); // akik kiléptek vagy ki lettek léptetve
const cmds = {};        // id -> 'clear' (levétel a pontról) vagy 'unhelp' (segélykérés lezárása)

// Rendszámok: fájlba is mentjük, hogy a szerver újraindítását túlélje (ha a tárhely engedi)
const PLATE_FILE = path.join(__dirname, 'rendszamok.json');
let plates = [];
try { plates = JSON.parse(fs.readFileSync(PLATE_FILE, 'utf-8')); } catch (e) { plates = []; }
const savePlates = () => fs.writeFile(PLATE_FILE, JSON.stringify(plates), () => {});
const plateKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9ÁÉÍÓÖŐÚÜŰ]/g, '');

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

const list = () => Object.entries(users).map(([id, u]) => ({ id, ...u, inactive: Date.now() - u.seen > INACTIVE_MS }));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

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
    } else if (b.action === 'unhelp' && users[b.id]) {
      users[b.id].help = false;
      cmds[b.id] = 'unhelp';
    }
    return send(res, 200, { ok: true });
  }

  // ---- Rendszámok ----
  if (req.method === 'POST' && req.url === '/api/plates/add') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    const plate = clean(b.plate, 14).toUpperCase();
    const key = plateKey(plate);
    if (key.length < 2) return send(res, 400, { ok: false, error: 'Írj be egy rendszámot!' });
    const type = clean(b.type, 40);
    const point = Number(b.point) || 0;
    const by = clean((users[b.id] && users[b.id].name) || b.name, 40);
    const now = Date.now();
    const old = plates.find((p) => p.key === key);
    if (old) {
      old.n += 1; old.last = now; old.point = point || old.point;
      if (type) old.type = type;
      old.by = by; old.byId = b.id || old.byId;
      savePlates();
      return send(res, 200, { ok: true, dup: true, n: old.n });
    }
    if (plates.length >= 3000) return send(res, 400, { ok: false, error: 'Tele a lista.' });
    plates.push({ pid: Math.random().toString(36).slice(2, 10) + now.toString(36), key, plate, type, point, by, byId: b.id || '', first: now, last: now, n: 1 });
    savePlates();
    return send(res, 200, { ok: true, dup: false });
  }

  if (req.method === 'POST' && req.url === '/api/plates/del') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    const p = plates.find((x) => x.pid === b.pid);
    if (p && (b.apw === ADMIN_PASSWORD || (b.id && p.byId === b.id))) {
      plates = plates.filter((x) => x.pid !== b.pid);
      savePlates();
    }
    return send(res, 200, { ok: true });
  }

  // ---- Folyamatos szinkron ----
  if (req.method === 'POST' && req.url === '/api/sync') {
    const b = await readBody(req);
    if (b.pw !== PASSWORD) return send(res, 401, { ok: false });
    if (b.id && left.has(b.id)) return send(res, 200, { ok: true, kicked: true, users: list(), plates });
    let reset = false;
    if (b.id) {
      const c = cmds[b.id];
      delete cmds[b.id];
      const u = {
        name: clean(b.name, 40),
        car: clean(b.car, 40),
        available: !!b.available,
        point: Number(b.point) || 0,
        help: !!b.help,
        seen: Date.now(),
      };
      if (c === 'clear') { u.point = 0; u.help = false; reset = 'clear'; }
      else if (c === 'unhelp') { u.help = false; reset = 'unhelp'; }
      users[b.id] = u;
    }
    return send(res, 200, { ok: true, reset, users: list(), plates });
  }

  const f = FILES[req.url.split('?')[0]];
  if (f) {
    fs.readFile(path.join(__dirname, f[0]), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Hiányzik a fájl: ' + f[0]); }
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Nincs ilyen oldal');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('A szerver fut! Nyisd meg: http://localhost:' + PORT);
});
