require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ── In-memory file store (works on Railway) ───────────────────────────────────
const fileStore = {};

// ── Multer - store in memory ──────────────────────────────────────────────────
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const id = uuidv4();
    fileStore[id] = {
      id,
      originalName: req.file.originalname,
      size: req.file.size,
      sizeFormatted: formatBytes(req.file.size),
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      downloads: 0,
      buffer: req.file.buffer
    };

    res.json({ 
      success: true, 
      id, 
      shareUrl: `/share/${id}`,
      file: { ...fileStore[id], buffer: undefined }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

// ── File metadata ─────────────────────────────────────────────────────────────
app.get('/api/file/:id', (req, res) => {
  const file = fileStore[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const { buffer, ...meta } = file;
  res.json(meta);
});

// ── Download ──────────────────────────────────────────────────────────────────
app.get('/download/:id', (req, res) => {
  const file = fileStore[req.params.id];
  if (!file) return res.status(404).json({ error: 'File not found.' });
  file.downloads += 1;
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
  res.setHeader('Content-Type', file.mimetype);
  res.send(file.buffer);
});

// ── Send email via Resend HTTP API ────────────────────────────────────────────
app.post('/send-email', async (req, res) => {
  const { to, fileId, shareUrl } = req.body;
  if (!to || !fileId || !shareUrl) return res.status(400).json({ error: 'Missing fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Invalid email.' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Email not configured. Add RESEND_API_KEY in Railway variables.' });

  const file = fileStore[fileId];
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
