const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Portfolio State ──────────────────────────────────────────
let portfolio = {
  balance: 350000.00, // BRL
  holdings: {
    BTC: 0.5,
    ETH: 4.2,
    BNB: 12.0,
    SOL: 25.0,
    ADA: 1500,
    DOT: 80,
    MATIC: 2000,
    DOGE: 5000,
  },
  transactions: [],
  deposits: [],
  withdrawals: [],
};

// ── Base Prices (BRL) ────────────────────────────────────────
let prices = {
  BTC:  { price: 485000, change: 2.34 },
  ETH:  { price: 18500,  change: 1.12 },
  BNB:  { price: 2350,   change: -0.85 },
  SOL:  { price: 890,    change: 3.67 },
  ADA:  { price: 3.25,   change: -1.23 },
  DOT:  { price: 42.50,  change: 0.98 },
  MATIC:{ price: 4.80,   change: 2.15 },
  DOGE: { price: 1.02,   change: -0.54 },
};

// ── Price History for Charts ─────────────────────────────────
let priceHistory = {};
Object.keys(prices).forEach(symbol => {
  priceHistory[symbol] = [];
  const base = prices[symbol].price;
  for (let i = 59; i >= 0; i--) {
    const variance = (Math.random() - 0.5) * base * 0.04;
    priceHistory[symbol].push({
      time: Date.now() - i * 10000,
      price: parseFloat((base + variance).toFixed(2)),
    });
  }
});

// ── Simulate Real-Time Price Updates ────────────────────────
function updatePrices() {
  Object.keys(prices).forEach(symbol => {
    const current = prices[symbol].price;
    const volatility = symbol === 'DOGE' ? 0.015 : 0.008;
    const change = (Math.random() - 0.49) * current * volatility;
    prices[symbol].price = parseFloat(Math.max(current + change, 0.01).toFixed(2));
    prices[symbol].change = parseFloat(
      (((prices[symbol].price - priceHistory[symbol][0].price) /
        priceHistory[symbol][0].price) * 100).toFixed(2)
    );

    priceHistory[symbol].push({
      time: Date.now(),
      price: prices[symbol].price,
    });
    if (priceHistory[symbol].length > 120) {
      priceHistory[symbol].shift();
    }
  });

  // Broadcast to all clients
  const payload = JSON.stringify({ type: 'prices', data: prices, history: priceHistory });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

setInterval(updatePrices, 2000);

// ── WebSocket ────────────────────────────────────────────────
wss.on('connection', ws => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'init', data: prices, history: priceHistory, portfolio }));

  ws.on('message', msg => {
    try {
      const { type, payload } = JSON.parse(msg);
      if (type === 'getPortfolio') {
        ws.send(JSON.stringify({ type: 'portfolio', data: portfolio }));
      }
    } catch (e) {}
  });

  ws.on('close', () => console.log('Client disconnected'));
});

// ── REST API ─────────────────────────────────────────────────

// Get prices
app.get('/api/prices', (req, res) => res.json(prices));

// Get portfolio
app.get('/api/portfolio', (req, res) => {
  const totalHoldings = Object.entries(portfolio.holdings).reduce((sum, [sym, amt]) => {
    return sum + (prices[sym] ? prices[sym].price * amt : 50000);
  }, 50000);
  res.json({ ...portfolio, totalHoldings, totalAssets: portfolio.balance + totalHoldings });
});

// BUY
app.post('/api/trade/buy', (req, res) => {
  const { symbol, amount, type } = req.body; // amount in BRL or crypto
  if (!prices[symbol]) return res.status(400).json({ error: 'Ativo inválido' });

  const price = prices[symbol].price;
  let brlCost, cryptoAmount;

  if (type === 'brl') {
    brlCost = parseFloat(amount);
    cryptoAmount = brlCost / price;
  } else {
    cryptoAmount = parseFloat(amount);
    brlCost = cryptoAmount * price;
  }

  if (brlCost > portfolio.balance) {
    return res.status(400).json({ error: 'Saldo insuficiente' });
  }

  portfolio.balance -= brlCost;
  portfolio.holdings[symbol] = (portfolio.holdings[symbol] || 0) + cryptoAmount;

  const tx = {
    id: Date.now(),
    type: 'buy',
    symbol,
    amount: cryptoAmount,
    price,
    total: brlCost,
    timestamp: new Date().toISOString(),
  };
  portfolio.transactions.unshift(tx);

  broadcastPortfolio();
  res.json({ success: true, transaction: tx, newBalance: portfolio.balance });
});

// SELL
app.post('/api/trade/sell', (req, res) => {
  const { symbol, amount, type } = req.body;
  if (!prices[symbol]) return res.status(400).json({ error: 'Ativo inválido' });

  const price = prices[symbol].price;
  let cryptoAmount, brlReceived;

  if (type === 'brl') {
    brlReceived = parseFloat(amount);
    cryptoAmount = brlReceived / price;
  } else {
    cryptoAmount = parseFloat(amount);
    brlReceived = cryptoAmount * price;
  }

  if ((portfolio.holdings[symbol] || 0) < cryptoAmount) {
    return res.status(400).json({ error: 'Saldo de cripto insuficiente' });
  }

  portfolio.holdings[symbol] -= cryptoAmount;
  portfolio.balance += brlReceived;

  const tx = {
    id: Date.now(),
    type: 'sell',
    symbol,
    amount: cryptoAmount,
    price,
    total: brlReceived,
    timestamp: new Date().toISOString(),
  };
  portfolio.transactions.unshift(tx);

  broadcastPortfolio();
  res.json({ success: true, transaction: tx, newBalance: portfolio.balance });
});


app.post('/api/deposit', async (req, res) => {

  const { amount } = req.body;
  const value = parseFloat(amount);

  if (!value || value <= 0) {
    return res.status(400).json({
      error: 'Valor inválido'
    });
  }

  try {

    const response = await axios.post(
      'https://api.mercadopago.com/v1/payments',
      {
        transaction_amount: value,
        description: 'Deposito TradeCrypto',
        payment_method_id: 'pix',
        payer: {
          email: 'nexttradecrypto@gmail.com'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID()
        }
      }
    );

    const pixData =
      response.data.point_of_interaction?.transaction_data;

    const deposit = {
      id: response.data.id,
      amount: value,
      status: response.data.status,
      qrCode: pixData?.qr_code || '',
      qrCodeBase64: pixData?.qr_code_base64 || '',
      ticketUrl: pixData?.ticket_url || '',
      timestamp: new Date().toISOString()
    };

    portfolio.deposits.unshift(deposit);

    res.json({
      success: true,
      deposit
    });

  } catch (err) {

    console.error(
      err.response?.data || err.message || err
    );

    res.status(500).json({
      success: false,
      error: err.response?.data?.message || 'Erro ao gerar PIX'
    });

  }

});







  

app.post('/api/withdraw', async (req, res) => {
  const { amount, pixKey } = req.body;
  const value = parseFloat(amount);

  if (!value || value <= 0) {
    return res.status(400).json({ error: 'Valor inválido' });
  }

  if (value > portfolio.balance) {
    return res.status(400).json({ error: 'Saldo insuficiente' });
  }

  try {
    const response = await axios.post(
      'https://api.mercadopago.com/v1/transfers',
      {
        amount: value,
        target: {
          type: "pix",
          value: pixKey
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    portfolio.balance -= value;

    const withdrawal = {
      id: response.data.id,
      amount: value,
      pixKey,
      status: response.data.status,
      timestamp: new Date().toISOString()
    };

    portfolio.withdrawals.unshift(withdrawal);
    broadcastPortfolio();

    res.json({ success: true, withdrawal, newBalance: portfolio.balance });

  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).json({ error: 'Erro ao enviar PIX' });
  }
});





app.post('/api/pix/webhook', (req, res) => {
  const signature = req.headers['x-signature'] || req.headers['x-mp-signature'];
  const body = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.warn("Assinatura inválida!");
    return res.status(401).send("Invalid signature");
  }

  const data = req.body;
  console.log("Webhook PIX válido:", data);

  // Atualizar depósito
  const deposit = portfolio.deposits.find(d => d.id === data.data.id);
  if (deposit) deposit.status = data.data.status;

  // Atualizar saque
  const withdrawal = portfolio.withdrawals.find(w => w.id === data.data.id);
  if (withdrawal) withdrawal.status = data.data.status;

  res.sendStatus(200);
});



// ── Broadcast portfolio to all ───────────────────────────────
function broadcastPortfolio() {
  const totalHoldings = Object.entries(portfolio.holdings).reduce((sum, [sym, amt]) => {
    return sum + (prices[sym] ? prices[sym].price * amt : 0);
  }, 0);
  const payload = JSON.stringify({
    type: 'portfolio',
    data: { ...portfolio, totalHoldings, totalAssets: portfolio.balance + totalHoldings },
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 CryptoTrade running on http://localhost:${PORT}`));
