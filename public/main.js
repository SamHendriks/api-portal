// ─── DATABASE STATS ──────────────────────────────────────────────────────────

const dbRefreshBtn  = document.getElementById('db-refresh-btn');
const dbUserCount   = document.getElementById('db-user-count');
const dbEventCount  = document.getElementById('db-event-count');
const dbEventsBody  = document.getElementById('db-events-body');

async function loadDbStats() {
  try {
    const res  = await fetch('/api/db-stats');
    const data = await res.json();

    dbUserCount.textContent  = data.users;
    dbEventCount.textContent = data.webhookEvents;

    dbEventsBody.innerHTML = '';
    if (data.recentEvents.length === 0) {
      dbEventsBody.innerHTML = '<tr><td colspan="3" style="color:#555">No events yet — simulate some webhooks first</td></tr>';
      return;
    }

    data.recentEvents.forEach(event => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${event.id}</td>
        <td>${event.event_name}</td>
        <td>${new Date(event.received_at).toLocaleString()}</td>
      `;
      dbEventsBody.appendChild(tr);
    });
  } catch (err) {
    dbEventsBody.innerHTML = `<tr><td colspan="3" style="color:#f87171">${err.message}</td></tr>`;
  }
}

dbRefreshBtn.addEventListener('click', loadDbStats);
loadDbStats(); // Load on page open


// ─── AUTH: JWT ───────────────────────────────────────────────────────────────

const authTogglePw    = document.getElementById('auth-toggle-pw');
const authUsername    = document.getElementById('auth-username');
const authPassword    = document.getElementById('auth-password');
const authRegisterBtn = document.getElementById('auth-register-btn');
const authLoginBtn    = document.getElementById('auth-login-btn');
const authMeBtn       = document.getElementById('auth-me-btn');
const authStatus      = document.getElementById('auth-status');
const authResponse    = document.getElementById('auth-response');

// Store the token in memory (sessionStorage would survive page refresh — fine for demos)
let jwtToken = null;

authTogglePw.addEventListener('click', () => {
  const isHidden = authPassword.type === 'password';
  authPassword.type = isHidden ? 'text' : 'password';
  authTogglePw.textContent = isHidden ? '🙈' : '👁';
});

async function authRequest(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

authRegisterBtn.addEventListener('click', async () => {
  const result = await authRequest('/auth/register', {
    username: authUsername.value.trim(),
    password: authPassword.value
  });
  authStatus.style.color = result.error ? '#f87171' : '#2dd4bf';
  authStatus.textContent = result.error ?? result.message;
});

authLoginBtn.addEventListener('click', async () => {
  const result = await authRequest('/auth/login', {
    username: authUsername.value.trim(),
    password: authPassword.value
  });

  if (result.error) {
    authStatus.style.color = '#f87171';
    authStatus.textContent = result.error;
    return;
  }

  // Store the token so we can attach it to future requests
  jwtToken = result.token;
  authStatus.style.color = '#2dd4bf';
  authStatus.textContent = `Token received: ${jwtToken.slice(0, 40)}...`;
});

authMeBtn.addEventListener('click', async () => {
  // Attach the token in the Authorization header — this is the standard pattern
  const res = await fetch('/auth/me', {
    headers: jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}
  });
  const data = await res.json();
  authResponse.textContent = JSON.stringify(data, null, 2);
});


// ─── PART 4: GRAPHQL ─────────────────────────────────────────────────────────

const presetQueries = {
  all: `{
  countries {
    name
    capital
    population
    region
    languages
    flag
  }
}`,
  minimal: `{
  countries {
    name
    capital
  }
}`,
  region: `{
  countriesByRegion(region: "Asia") {
    name
    capital
    population
    flag
  }
}`,
  single: `{
  country(name: "Japan") {
    name
    capital
    population
    languages
    flag
  }
}`
};

const gqlQuery    = document.getElementById('gql-query');
const gqlRunBtn   = document.getElementById('gql-run-btn');
const gqlResponse = document.getElementById('gql-response');
const presetBtns  = document.querySelectorAll('.preset-btn');

// Load the "all fields" preset on startup
gqlQuery.value = presetQueries.all;

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    gqlQuery.value = presetQueries[btn.dataset.preset];
  });
});

gqlRunBtn.addEventListener('click', async () => {
  gqlRunBtn.disabled = true;
  gqlResponse.textContent = '// Running query...';

  try {
    // GraphQL always uses POST to the single /graphql endpoint
    // The query is sent as JSON in the request body
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gqlQuery.value })
    });

    const result = await response.json();

    // Pretty-print the JSON so it's easy to read
    gqlResponse.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    gqlResponse.textContent = `Error: ${err.message}`;
  } finally {
    gqlRunBtn.disabled = false;
  }
});


// ─── PART 3: WEBSOCKETS ──────────────────────────────────────────────────────

const wsConnectBtn  = document.getElementById('ws-connect-btn');
const wsIndicator   = document.getElementById('ws-indicator');
const wsState       = document.getElementById('ws-state');
const tickerGrid    = document.getElementById('ticker-grid');
const wsInput       = document.getElementById('ws-input');
const wsSendBtn     = document.getElementById('ws-send-btn');
const wsMessages    = document.getElementById('ws-messages');

let socket = null;
let prevPrices = {};

function setWsConnected(connected) {
  wsIndicator.className = 'ws-dot ' + (connected ? 'connected' : 'disconnected');
  wsState.textContent   = connected ? 'Connected' : 'Disconnected';
  wsConnectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  wsInput.disabled    = !connected;
  wsSendBtn.disabled  = !connected;
}

function addMessage(text, type) {
  const div = document.createElement('div');
  div.className = `ws-message ${type}`;
  div.textContent = text;
  wsMessages.prepend(div);
}

wsConnectBtn.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
    return;
  }

  // ws:// is the WebSocket equivalent of http://
  // The browser upgrades the connection from HTTP to WebSocket automatically
  socket = new WebSocket('ws://localhost:3000');

  socket.addEventListener('open', () => {
    setWsConnected(true);
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'status') {
      addMessage(`Server: ${msg.message}`, 'server');
    }

    if (msg.type === 'prices') {
      tickerGrid.innerHTML = '';
      msg.data.forEach(({ symbol, price }) => {
        const prev = prevPrices[symbol];
        const direction = prev == null ? '' : price > prev ? 'up' : price < prev ? 'down' : '';
        prevPrices[symbol] = price;

        const card = document.createElement('div');
        card.className = 'ticker-card';
        card.innerHTML = `
          <div class="symbol">${symbol}</div>
          <div class="price ${direction}">$${price}</div>
        `;
        tickerGrid.appendChild(card);
      });
    }

    if (msg.type === 'echo') {
      addMessage(`Server echo: "${msg.original}" — ${msg.serverNote}`, 'server');
    }
  });

  socket.addEventListener('close', () => {
    setWsConnected(false);
    socket = null;
  });
});

wsSendBtn.addEventListener('click', () => {
  const text = wsInput.value.trim();
  if (!text || !socket) return;

  // Send a message from the browser to the server
  socket.send(JSON.stringify({ text }));
  addMessage(`You: ${text}`, 'sent');
  wsInput.value = '';
});

wsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') wsSendBtn.click();
});


// ─── PART 2: WEBHOOKS ────────────────────────────────────────────────────────

const simulateBtn = document.getElementById('simulate-btn');
const webhookStatus = document.getElementById('webhook-status');
const webhookLog = document.getElementById('webhook-log');

let knownEventIds = new Set();

// Send a request to our server telling it to simulate an incoming webhook
simulateBtn.addEventListener('click', async () => {
  simulateBtn.disabled = true;
  webhookStatus.textContent = 'Sending simulated event...';

  try {
    const response = await fetch('/api/simulate-webhook', { method: 'POST' });
    const data = await response.json();
    webhookStatus.textContent = `Event sent: ${data.event}`;
  } catch (err) {
    webhookStatus.textContent = `Error: ${err.message}`;
  } finally {
    simulateBtn.disabled = false;
  }
});

// Poll our server every 2 seconds for new webhook events
async function pollWebhookEvents() {
  try {
    const response = await fetch('/api/webhook-events');
    const events = await response.json();

    events.forEach(event => {
      if (knownEventIds.has(event.id)) return; // Skip ones we've already shown
      knownEventIds.add(event.id);

      const row = document.createElement('div');
      row.className = 'event-row';

      const time = new Date(event.receivedAt).toLocaleTimeString();

      row.innerHTML = `
        <div class="event-type">${event.event}</div>
        <div class="event-payload">ID: ${event.payload.id} &nbsp;|&nbsp; ${event.payload.data.message}</div>
        <div class="event-meta">Received at ${time}</div>
      `;

      // Add new events to the top of the log
      webhookLog.prepend(row);
    });

  } catch (err) {
    // Silently ignore poll errors
  }
}

setInterval(pollWebhookEvents, 2000);


// ─── PART 1: REST ────────────────────────────────────────────────────────────

const btn = document.getElementById('fetch-btn');
const status = document.getElementById('status');
const results = document.getElementById('results');

btn.addEventListener('click', async () => {
  // Disable the button and show a loading message while we wait
  btn.disabled = true;
  status.textContent = 'Fetching data...';
  results.innerHTML = '';

  try {
    // Call OUR server — not the external API directly
    const response = await fetch('/api/countries');

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    // Parse the JSON the server sent back
    const countries = await response.json();

    status.textContent = `Loaded ${countries.length} countries`;

    // Build a card for each country and add it to the page
    countries.forEach(country => {
      const card = document.createElement('div');
      card.className = 'country-card';

      const capital = country.capital ? country.capital[0] : 'N/A';
      const population = country.population.toLocaleString();

      card.innerHTML = `
        <img src="${country.flags.svg}" alt="Flag of ${country.name.common}">
        <h3>${country.name.common}</h3>
        <p>Capital: ${capital}</p>
        <p>Population: ${population}</p>
      `;

      results.appendChild(card);
    });

  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    // Re-enable the button whether it succeeded or failed
    btn.disabled = false;
  }
});
