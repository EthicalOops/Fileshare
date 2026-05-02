require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('SMTP_USER:', process.env.SMTP_USER || 'NOT SET');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET');

// ── Directories ───────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(__dirname, 'files.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function readDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    req.fileId = id;
    cb(null, id + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const id = req.fileId || path.parse(req.file.filename).name;
    const db = readDB();
    db[id] = {
      id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: req.file.size,
      sizeFormatted: formatBytes(req.file.size),
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      downloads: 0
    };
    writeDB(db);
    res.json({ success: true, id, shareUrl: `/share/${id}`, file: db[id] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

// ── File metadata ─────────────────────────────────────────────────────────────
app.get('/api/file/:id', (req, res) => {
  const db = readDB();
  const file = db[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json(file);
});

// ── Download ──────────────────────────────────────────────────────────────────
app.get('/download/:id', (req, res) => {
  const db = readDB();
  const file = db[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing.' });
  file.downloads += 1;
  writeDB(db);
  res.download(filePath, file.originalName);
});

// ── Send email via Resend HTTP API ────────────────────────────────────────────
app.post('/send-email', async (req, res) => {
  const { to, fileId, shareUrl } = req.body;

  if (!to || !fileId || !shareUrl) return res.status(400).json({ error: 'Missing fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Invalid email.' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Email not configured. Add RESEND_API_KEY in Railway variables.' });

  const db = readDB();
  const file = db[fileId];
  if (!file) return res.status(404).json({ error: 'File not found.' });

  const fullUrl = shareUrl.startsWith('http') ? shareUrl : `https://${req.headers.host}${shareUrl}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'FileDropp <onboarding@resend.dev>',
        to: [to],
        subject: `Someone shared a file with you: ${file.originalName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
            <h2>Someone shared a file with you</h2>
            <p><strong>${file.originalName}</strong> (${file.sizeFormatted})</p>
            <a href="${fullUrl}" style="display:inline-block;margin:16px 0;padding:14px 28px;background:#e8ff47;color:#111;text-decoration:none;border-radius:4px;font-weight:700;">
              Download File
            </a>
            <p style="color:#888;font-size:0.8rem;">Or copy: <a href="${fullUrl}">${fullUrl}</a></p>
          </div>
        `
      })
    });

    const data = await response.json();
    console.log('Resend response:', JSON.stringify(data));

    if (!response.ok) throw new Error(data.message || JSON.stringify(data));

    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Share page ────────────────────────────────────────────────────────────────
app.get('/share/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`\n🚀 FileShare running at http://localhost:${PORT}\n`));
