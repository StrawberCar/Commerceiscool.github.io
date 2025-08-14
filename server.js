// server.js
// Minimal upload server for SocialNet
// Usage:
//   1) npm init -y
//   2) npm install express multer
//   3) node server.js
// Visit: http://localhost:3000

const express = require('express');
const multer  = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure art folder and posts.txt exist
const ART_DIR = path.join(__dirname, 'art');
const POSTS_TXT = path.join(__dirname, 'posts.txt');
if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });
if (!fs.existsSync(POSTS_TXT)) fs.writeFileSync(POSTS_TXT, '# filename.ext, Quote here, username\n');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ART_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'upload', ext).replace(/[^\w.-]+/g, '_');
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    cb(null, `${base}_${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml)/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files allowed'), ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.use(express.static(__dirname, { extensions: ['html'] })); // serves index.html, posts.txt
app.use('/art', express.static(ART_DIR, { maxAge: 0 }));

app.post('/upload', upload.single('image'), (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const quote = (req.body.quote || '').trim();
    if (!req.file) return res.status(400).json({ ok: false, error: 'No image uploaded.' });
    if (!username || !quote) return res.status(400).json({ ok: false, error: 'Missing username or quote.' });

    const filename = req.file.filename;
    // Append to posts.txt
    const line = `${filename}, "${quote.replace(/[\r\n]+/g,' ').trim()}", ${username}\n`;
    fs.appendFileSync(POSTS_TXT, line);

    res.json({ ok: true, filename, username, quote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Upload failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ SocialNet server running at http://localhost:${PORT}`);
});
