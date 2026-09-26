import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to load GAS config dynamically
function getGasConfig() {
  try {
    const configPath = path.join(__dirname, 'backend', 'config.js');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const envMatch = content.match(/APP_ENVIRONMENT\s*=\s*["']([^"']+)["']/);
      const expUrlMatch = content.match(/EXP_API_URL\s*=\s*["']([^"']+)["']/);
      const prodUrlMatch = content.match(/PROD_API_URL\s*=\s*["']([^"']+)["']/);

      const env = process.env.APP_ENVIRONMENT || (envMatch ? envMatch[1] : 'Exp');
      const expUrl = expUrlMatch ? expUrlMatch[1] : '';
      const prodUrl = prodUrlMatch ? prodUrlMatch[1] : '';
      const apiUrl = env === 'Exp' ? expUrl : prodUrl;

      return { env, apiUrl, expUrl, prodUrl };
    }
  } catch (err) {
    console.error('Error reading backend/config.js:', err);
  }
  return {
    env: process.env.APP_ENVIRONMENT || 'Exp',
    apiUrl: 'https://script.google.com/macros/s/AKfycbzsU73hNlYm9vqAY4Mn80s_6KMP79eLCi11u8d56NkO_1iDp7a0ew09OWOdvfhzK75T/exec'
  };
}

// Multi-user API proxy to Google Apps Script with exponential backoff for lock contention
app.post('/api/action', async (req, res) => {
  const { apiUrl } = getGasConfig();
  const payload = req.body;

  if (!apiUrl) {
    return res.status(500).json({ error: 'Google Apps Script API URL not configured' });
  }

  // Handle concurrent request contention on GAS LockService with backoff
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Google Apps Script HTTP status: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return res.json(json);
      } catch (parseErr) {
        throw new Error(`Google Apps Script invalid JSON: ${text.slice(0, 100)}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Proxy attempt ${attempt}/${maxRetries} failed]: ${err.message}`);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 400 + Math.floor(Math.random() * 200);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return res.status(502).json({
    error: 'Backend request failed after retries: ' + (lastError?.message || 'Lock or network timeout')
  });
});

app.get('/api/health', (req, res) => {
  const config = getGasConfig();
  res.json({
    status: 'online',
    platform: 'Google AI Studio',
    environment: config.env,
    timestamp: new Date().toISOString()
  });
});

// Cache control headers for static files (anti-caching for fresh multi-user updates)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`House Visit Form running on port ${PORT} (0.0.0.0)`);
});
