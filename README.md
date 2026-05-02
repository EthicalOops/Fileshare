# FileDropp 📦

A self-hosted file sharing website. Upload a file, get a shareable link. Anyone with the link can download it. No login required.

## Features
- Drag & drop or click to upload
- Instant shareable links (e.g. `http://yoursite.com/share/abc123`)
- Download count tracking
- Supports any file type up to 100 MB
- No accounts, no login required
- Beautiful dark UI

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open in browser
```
http://localhost:3000
```

---

## How it works

1. **Upload page** (`/`) — drag & drop or select a file
2. **Get a link** — e.g. `http://localhost:3000/share/550e8400-e29b-41d4-a716-446655440000`
3. **Share the link** — anyone with it can download the file

---

## Project Structure

```
fileshare/
├── server.js          ← Express backend
├── package.json
├── files.json         ← Created automatically (file metadata)
├── uploads/           ← Created automatically (stored files)
└── public/
    ├── index.html     ← Upload page
    └── share.html     ← Download/share page
```

---

## Deploying Online

To make this accessible from other devices/the internet:

### Option A: Use a VPS (DigitalOcean, Linode, etc.)
1. Upload this folder to your server
2. Run `npm install && npm start`
3. Point your domain to the server IP
4. Use [nginx](https://nginx.org) as a reverse proxy on port 80/443

### Option B: Use Railway (easiest free option)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) and connect your repo
3. Railway will auto-detect and deploy it

### Option C: Use Render
1. Push to GitHub
2. Connect at [render.com](https://render.com)
3. Set start command to `node server.js`

---

## Configuration

Edit `server.js` to change:
- **Port**: `const PORT = process.env.PORT || 3000`
- **File size limit**: `limits: { fileSize: 100 * 1024 * 1024 }` (currently 100 MB)

---

## Notes

- Files are stored locally in the `uploads/` folder
- Metadata is stored in `files.json`
- For production use, consider storing files on S3/Cloudflare R2 instead of disk
