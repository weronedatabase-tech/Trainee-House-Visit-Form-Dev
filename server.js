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

// Helper to load GAS config dynamically from backend/config.js
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

// =====================================================================
// MULTI-USER CONCURRENCY & CACHING ENGINE
// =====================================================================

// 1. Config Read Cache & Single-Flight Coalescing
// When multiple users load the app simultaneously, serve cached config (<5ms)
// and coalesce concurrent in-flight requests into one single GAS call.
const CONFIG_CACHE_TTL_MS = 30000; // 30 seconds TTL for fast multi-user reads
let configCache = {
  data: null,
  cachedAt: 0,
  inFlightPromise: null
};

// 2. Trainee History Short-Lived Cache (15s TTL)
const HISTORY_CACHE_TTL_MS = 15000;
const historyCache = new Map(); // traineeName -> { data, cachedAt }

// 3. Write Request Serialization Queue
// Google Apps Script LockService enforces a single script lock across executions.
// Serializing write mutations through a server queue eliminates lock collision timeouts (30s limit).
let writeQueueTail = Promise.resolve();

function executeWithWriteQueue(task) {
  const next = writeQueueTail.then(task, task);
  // Keep queue alive even on errors
  writeQueueTail = next.catch(() => {});
  return next;
}

// Low-level fetcher with exponential backoff & jitter
async function fetchGasWithRetry(apiUrl, payload, maxRetries = 3) {
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
        return JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Google Apps Script invalid JSON: ${text.slice(0, 120)}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Proxy attempt ${attempt}/${maxRetries} failed for action "${payload.action}"]: ${err.message}`);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 400 + Math.floor(Math.random() * 250);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error('Backend request failed after retries: ' + (lastError?.message || 'Lock or network timeout'));
}

// Multi-user API proxy to Google Apps Script
app.post('/api/action', async (req, res) => {
  const { apiUrl } = getGasConfig();
  const payload = req.body || {};
  const action = payload.action;

  if (!apiUrl) {
    return res.status(500).json({ error: 'Google Apps Script API URL not configured' });
  }

  // --- A. READ: getConfig (with multi-user caching + request coalescing) ---
  if (action === 'getConfig') {
    const isForceRefresh = Boolean(payload.forceRefresh);
    const now = Date.now();

    // Serve from cache if fresh and not forcing refresh
    if (!isForceRefresh && configCache.data && (now - configCache.cachedAt < CONFIG_CACHE_TTL_MS)) {
      return res.json(configCache.data);
    }

    // Coalesce concurrent requests: if a request is already in-flight, await it
    if (configCache.inFlightPromise && !isForceRefresh) {
      try {
        const result = await configCache.inFlightPromise;
        return res.json(result);
      } catch (e) {
        // Fall through to retry fetch below if existing in-flight failed
      }
    }

    // Initiate new fetch and share promise
    configCache.inFlightPromise = (async () => {
      try {
        const data = await fetchGasWithRetry(apiUrl, payload);
        configCache.data = data;
        configCache.cachedAt = Date.now();
        return data;
      } finally {
        configCache.inFlightPromise = null;
      }
    })();

    try {
      const data = await configCache.inFlightPromise;
      return res.json(data);
    } catch (err) {
      // If we have stale cache, serve it as graceful fallback on network hitch
      if (configCache.data) {
        console.warn('GAS fetch failed; returning stale cached config as fallback');
        return res.json(configCache.data);
      }
      return res.status(502).json({ error: err.message });
    }
  }

  // --- B. READ: getHistory (with short-lived cache per trainee) ---
  if (action === 'getHistory') {
    const traineeKey = String(payload.trainee || '').trim().toLowerCase();
    const now = Date.now();

    if (traineeKey && historyCache.has(traineeKey)) {
      const cached = historyCache.get(traineeKey);
      if (now - cached.cachedAt < HISTORY_CACHE_TTL_MS) {
        return res.json(cached.data);
      }
    }

    try {
      const data = await fetchGasWithRetry(apiUrl, payload);
      if (traineeKey) {
        historyCache.set(traineeKey, { data, cachedAt: Date.now() });
      }
      return res.json(data);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // --- C. MUTATIONS: submit, addColumn, renameColumn, changePassword ---
  // Route through write queue to avoid GAS LockService concurrency aborts
  const isMutation = ['submit', 'addColumn', 'renameColumn', 'changePassword'].includes(action);

  if (isMutation) {
    try {
      const result = await executeWithWriteQueue(async () => {
        const data = await fetchGasWithRetry(apiUrl, payload);

        // Invalidate read caches immediately upon successful mutation
        configCache.data = null;
        configCache.cachedAt = 0;

        if (action === 'submit' && payload.traineeName) {
          const key = String(payload.traineeName).trim().toLowerCase();
          historyCache.delete(key);
        }

        return data;
      });

      return res.json(result);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // --- D. OTHER ACTIONS (e.g. login, validateSettings, generateMockData) ---
  try {
    const result = await fetchGasWithRetry(apiUrl, payload);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// Health & Multi-User Status endpoint
app.get('/api/health', (req, res) => {
  const config = getGasConfig();
  res.json({
    status: 'online',
    platform: 'Google AI Studio',
    environment: config.env,
    cachedConfigAvailable: Boolean(configCache.data),
    cachedConfigAgeSeconds: configCache.cachedAt ? Math.round((Date.now() - configCache.cachedAt) / 1000) : null,
    historyCacheEntries: historyCache.size,
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
