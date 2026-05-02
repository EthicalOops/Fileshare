require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Email transporter ─────────────────────────────────────────────────────────
console.log('SMTP_USER:', process.env.SMTP_USER || 'NOT SET');
console.log('SMTP_PASS:', process.env.SMTP_PASS ? 'SET' : 'NOT SET');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ── Directories ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(__dirname, 'files.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Multer config ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    req.fileId = id;
    cb(null, id + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB limit
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

// Upload a file
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

    res.json({
      success: true,
      id,
      shareUrl: `/share/${id}`,
      file: db[id]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

// Get file metadata
app.get('/api/file/:id', (req, res) => {
  const db = readDB();
  const file = db[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json(file);
});

// Download a file
app.get('/download/:id', (req, res) => {
  const db = readDB();
  const file = db[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });

  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk.' });

  // Increment download count
  file.downloads += 1;
  writeDB(db);

  res.download(filePath, file.originalName);
});

// Send share link via email
app.post('/send-email', async (req, res) => {
  const { to, fileId, shareUrl } = req.body;

  if (!to || !fileId || !shareUrl) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return res.status(503).json({ error: 'Email is not configured on this server. See .env.example.' });
  }

  const db = readDB();
  const file = db[fileId];
  if (!file) return res.status(404).json({ error: 'File not found.' });

  const fullUrl = shareUrl.startsWith('http') ? shareUrl : `http://localhost:${PORT}${shareUrl}`;

  try {
    await transporter.sendMail({
      from: `"FileDropp" <${process.env.SMTP_USER}>`,
      to,
      subject: `📦 Someone shared a file with you: ${file.originalName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#f0f0f0;border-radius:8px;overflow:hidden;">
          <div style="background:#111;padding:28px 32px;border-bottom:1px solid #222;">
            <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.02em;">📦 FileDropp</span>
          </div>
          <div style="padding:32px;">
            <p style="font-size:1rem;margin:0 0 8px;">A file has been shared with you:</p>
            <div style="background:#0f0f00;border:1px solid #e8ff47;border-radius:4px;padding:16px;margin:20px 0;">
              <div style="font-family:monospace;font-size:0.9rem;color:#e8ff47;font-weight:700;">${file.originalName}</div>
              <div style="font-family:monospace;font-size:0.75rem;color:#555;margin-top:4px;">${file.sizeFormatted} · ${file.mimetype}</div>
            </div>
            <a href="${fullUrl}" style="display:block;background:#e8ff47;color:#0a0a0a;text-decoration:none;padding:16px;border-radius:4px;text-align:center;font-weight:700;font-size:1rem;letter-spacing:0.05em;">
              ⬇ Download File
            </a>
            <p style="font-size:0.75rem;color:#555;margin-top:20px;font-family:monospace;">
              Or copy this link:<br>
              <a href="${fullUrl}" style="color:#e8ff47;">${fullUrl}</a>
            </p>
          </div>
          <div style="padding:16px 32px;border-top:1px solid #222;">
            <p style="font-size:0.65rem;color:#444;font-family:monospace;margin:0;">Sent via FileDropp · No login required</p>
          </div>
        </div>
      `
    });

    res.json({ success: true, message: `Email sent to ${to}` });
  } catch (err) {
    console.error('Email error full:', JSON.stringify({ message: err.message, code: err.code, response: err.response }));
    res.status(500).json({ error: err.message });
  }
});

// Serve share page for any /share/:id route
app.get('/share/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`\n🚀 FileShare running at http://localhost:${PORT}\n`);
});
