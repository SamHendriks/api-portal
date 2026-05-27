require('dotenv').config();

const express = require('express');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { buildSchema } = require('graphql');
const { createHandler } = require('graphql-http/lib/use/express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { stmts } = require('./database');
const logger = require('./logger');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

app.use(express.static('public'));
app.use(express.json());

const httpServer = http.createServer(app);

// Log every request when it finishes — method, url, status code, response time
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.url}`, { status: res.statusCode, ms });
  });
  next();
});


// ─── SWAGGER DOCS ────────────────────────────────────────────────────────────

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Portal',
      version: '1.0.0',
      description: 'A showcase of REST, Webhooks, WebSockets, and GraphQL API integration patterns'
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    }
  },
  apis: ['./server.js']
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// ─── RATE LIMITING ───────────────────────────────────────────────────────────

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});

// Disabled in test environment so test suites don't hit the limit
const authLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: 'Too many login attempts, please try again in 15 minutes.' }
    });

app.use(generalLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);


// ─── AUTH ────────────────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string, example: sam }
 *               password: { type: string, example: secret123 }
 *     responses:
 *       201: { description: User registered successfully }
 *       400: { description: Missing username or password }
 *       409: { description: Username already taken }
 */
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Check the database — not an in-memory array
  if (stmts.findUser.get(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  stmts.insertUser.run(username, passwordHash);

  res.status(201).json({ message: 'User registered successfully' });
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login and receive a JWT token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string, example: sam }
 *               password: { type: string, example: secret123 }
 *     responses:
 *       200:
 *         description: Returns a JWT token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *       401: { description: Invalid credentials }
 */
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = stmts.findUser.get(username);

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current user info (protected route)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Returns the logged-in username }
 *       401: { description: No token provided }
 *       403: { description: Invalid or expired token }
 */
app.get('/auth/me', authenticate, (req, res) => {
  res.json({ message: `Hello ${req.user.username}, your token is valid.` });
});


// ─── PART 1: REST ────────────────────────────────────────────────────────────

// Cache lives in memory — TTL of 300 seconds (5 minutes)
// In production this would be Redis so cache survives server restarts
const cache = new NodeCache({ stdTTL: 300 }); // 300 seconds = 5 minutes

app.get('/api/countries', (req, res) => {
  const CACHE_KEY = 'countries_europe';
  const cached = cache.get(CACHE_KEY);

  if (cached) {
    // Serve from cache — no network call needed
    logger.info('GET /api/countries served from cache');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Cache miss — fetch from the external API
  logger.info('GET /api/countries cache miss — fetching from API');
  https.get('https://restcountries.com/v3.1/region/europe?fields=name,capital,population,flags', (externalRes) => {
    let data = '';
    externalRes.on('data', (chunk) => { data += chunk; });
    externalRes.on('end', () => {
      const parsed = JSON.parse(data);
      cache.set(CACHE_KEY, parsed); // Store in cache for next request
      res.setHeader('X-Cache', 'MISS');
      res.json(parsed);
    });
  }).on('error', (err) => {
    logger.error('Failed to fetch countries from API', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch data', detail: err.message });
  });
});


// ─── PART 2: WEBHOOKS ────────────────────────────────────────────────────────

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const body = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Persist to database instead of an in-memory array
  stmts.insertEvent.run(req.body.event, JSON.stringify(req.body.payload));
  res.json({ received: true });
});

app.get('/api/webhook-events', (req, res) => {
  const events = stmts.recentEvents.all().map(row => ({
    ...row,
    payload: JSON.parse(row.payload)
  }));
  res.json(events);
});

app.post('/api/simulate-webhook', (req, res) => {
  const eventTypes = ['order.placed', 'user.signup', 'payment.received', 'item.shipped'];
  const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];

  const body = JSON.stringify({
    event,
    payload: {
      id: Math.floor(Math.random() * 90000) + 10000,
      timestamp: new Date().toISOString(),
      data: { message: `Simulated ${event} event` }
    }
  });

  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const internalReq = http.request(options, () => res.json({ sent: true, event }));
  internalReq.on('error', (err) => res.status(500).json({ error: err.message }));
  internalReq.write(body);
  internalReq.end();
});


// ─── PART 3: WEBSOCKETS ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

const tickers = { SPIN: 142.50, NOVA: 87.30, FLUX: 215.00, AXON: 63.80 };

function nextPrice(current) {
  return Math.max(1, current + (Math.random() * 4 - 2));
}

wss.on('connection', (socket) => {
  logger.info('WebSocket client connected');
  socket.send(JSON.stringify({ type: 'status', message: 'Connected to live feed' }));

  const interval = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    for (const symbol in tickers) tickers[symbol] = nextPrice(tickers[symbol]);
    socket.send(JSON.stringify({
      type: 'prices',
      data: Object.entries(tickers).map(([symbol, price]) => ({ symbol, price: price.toFixed(2) })),
      timestamp: new Date().toISOString()
    }));
  }, 1000);

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      socket.send(JSON.stringify({
        type: 'echo',
        original: msg.text,
        serverNote: `Server received this at ${new Date().toLocaleTimeString()}`
      }));
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  socket.on('close', () => {
    logger.info('WebSocket client disconnected');
    clearInterval(interval);
  });
});


// ─── PART 4: GRAPHQL ─────────────────────────────────────────────────────────

const countriesData = [
  { name: 'Germany',      capital: 'Berlin',      population: 83200000,   region: 'Europe',   languages: ['German'],                   flag: '🇩🇪' },
  { name: 'France',       capital: 'Paris',        population: 67750000,   region: 'Europe',   languages: ['French'],                   flag: '🇫🇷' },
  { name: 'Netherlands',  capital: 'Amsterdam',    population: 17900000,   region: 'Europe',   languages: ['Dutch'],                    flag: '🇳🇱' },
  { name: 'Japan',        capital: 'Tokyo',        population: 125700000,  region: 'Asia',     languages: ['Japanese'],                 flag: '🇯🇵' },
  { name: 'South Korea',  capital: 'Seoul',        population: 51700000,   region: 'Asia',     languages: ['Korean'],                   flag: '🇰🇷' },
  { name: 'India',        capital: 'New Delhi',    population: 1380000000, region: 'Asia',     languages: ['Hindi', 'English'],         flag: '🇮🇳' },
  { name: 'Brazil',       capital: 'Brasília',     population: 214300000,  region: 'Americas', languages: ['Portuguese'],               flag: '🇧🇷' },
  { name: 'Canada',       capital: 'Ottawa',       population: 38200000,   region: 'Americas', languages: ['English', 'French'],        flag: '🇨🇦' },
  { name: 'Mexico',       capital: 'Mexico City',  population: 128900000,  region: 'Americas', languages: ['Spanish'],                  flag: '🇲🇽' },
  { name: 'Nigeria',      capital: 'Abuja',        population: 218500000,  region: 'Africa',   languages: ['English'],                  flag: '🇳🇬' },
  { name: 'South Africa', capital: 'Pretoria',     population: 60000000,   region: 'Africa',   languages: ['Zulu', 'Xhosa', 'English'], flag: '🇿🇦' },
  { name: 'Egypt',        capital: 'Cairo',        population: 104000000,  region: 'Africa',   languages: ['Arabic'],                   flag: '🇪🇬' },
];

const schema = buildSchema(`
  type Country {
    name: String
    capital: String
    population: Int
    region: String
    languages: [String]
    flag: String
  }

  type Query {
    countries: [Country]
    countriesByRegion(region: String!): [Country]
    country(name: String!): Country
  }
`);

const root = {
  countries: () => countriesData,
  countriesByRegion: ({ region }) =>
    countriesData.filter(c => c.region.toLowerCase() === region.toLowerCase()),
  country: ({ name }) =>
    countriesData.find(c => c.name.toLowerCase() === name.toLowerCase()) ?? null,
};

app.use('/graphql', createHandler({ schema, rootValue: root }));


// ─── DATABASE STATS ───────────────────────────────────────────────────────────

// Returns live counts from the database — used by the portal's DB panel
app.get('/api/db-stats', (req, res) => {
  res.json({
    users:         stmts.countUsers.get().count,
    webhookEvents: stmts.countEvents.get().count,
    recentEvents:  stmts.recentEvents.all().map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }))
  });
});


// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────

// This catches any error passed to next(err) anywhere in the app
// The four-parameter signature is what tells Express this is an error handler
app.use((err, req, res, next) => {
  logger.error(err.message, {
    stack: err.stack,
    method: req.method,
    url: req.url
  });
  res.status(err.status || 500).json({ error: 'Something went wrong' });
});

// Catch unhandled promise rejections so the process doesn't silently die
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});


// ─── START ────────────────────────────────────────────────────────────────────

// Only bind to a port when run directly — when required by tests, skip this
// so Supertest can control the lifecycle itself
if (require.main === module) {
  httpServer.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { app, httpServer };
