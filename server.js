require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup SQLite Database
const db = new sqlite3.Database('./kluvert_arena.db', (err) => {
    if (err) {
        console.error('Database opening error: ', err.message);
    } else {
        console.log('Connected to SQLite Database.');
        // Create tables immediately upon connection
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`, (err) => {
                if (!err) {
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('quick_stake', '4')`);
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('cl_stake', '150')`);
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_warning', '')`);
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('whatsapp_link', '')`);
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_link', '')`);
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('tiktok_link', '')`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS matches (
                token TEXT PRIMARY KEY,
                player1_phone TEXT,
                player2_phone TEXT,
                stake_amount REAL,
                status TEXT,
                winner_phone TEXT
            )`);
        });
    }
});

// Helper: Get setting value from database
function getSetting(key) {
    return new Promise((resolve) => {
        db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
            resolve(row ? row.value : null);
        });
    });
}

// Helper: Paystack Direct MoMo Charge (For staking)
async function triggerMomoPrompt(phone, network, amount) {
  try {
    const customerPhone = phone ? phone.trim() : "0551234987";
    const testProvider = network ? network.toLowerCase() : "mtn";

    const response = await axios.post(
      'https://api.paystack.co/charge',
      {
        amount: Math.round(amount * 100),
        email: `player_${Date.now()}@kluvertsoccer.com`,
        currency: 'GHS',
        mobile_money: { phone: customerPhone, provider: testProvider }
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` 
        } 
      }
    );
    return response.data;
  } catch (error) {
    console.error('MoMo Prompt Details:', error.response?.data || error.message);
    return null;
  }
}

// Helper: Automatically send payout to winner via Paystack Transfers
async function sendWinnerPayout(phone, network, prizeAmount, playerName) {
  try {
    const recipientRes = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: "mobile_money",
        name: playerName,
        account_number: phone,
        bank_code: network.toLowerCase() === 'mtn' ? 'MTN' : (network.toLowerCase() === 'vod' ? 'VOD' : 'ATL'),
        currency: "GHS"
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    if (!recipientRes.data.status) {
      console.error("Failed to create transfer recipient");
      return null;
    }

    const recipientCode = recipientRes.data.data.recipient_code;

    const transferRes = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: "balance",
        amount: Math.round(prizeAmount * 100),
        recipient: recipientCode,
        reason: `Prize payout for winning match on Kluvert Soccer Arena`
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    return transferRes.data;
  } catch (error) {
    console.error('Payout Error:', error.response?.data || error.message);
    return null;
  }
}

// =================================================================
// SYSTEM STATUS & SOCIAL LINKS API
// =================================================================
app.get('/api/system-status', async (req, res) => {
    const warning = await getSetting('admin_warning') || "";
    const whatsapp = await getSetting('whatsapp_link') || "";
    const telegram = await getSetting('telegram_link') || "";
    const tiktok = await getSetting('tiktok_link') || "";

    res.json({
        isOnline: true,
        warning: warning,
        whatsapp: whatsapp,
        telegram: telegram,
        tiktok: tiktok
    });
});

app.post('/api/admin/warning', express.json(), async (req, res) => {
    const { key, message } = req.body;
    if (key !== 'kluvertSecret2026') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    db.run(`UPDATE settings SET value = ? WHERE key = 'admin_warning'`, [message || ""], (err) => {
        if (err) {
            return res.status(500).json({ success: false });
        }
        res.json({ success: true, warning: message || "" });
    });
});

// =================================================================
// 1. PUBLIC HOME PAGE
// =================================================================
app.get('/', (req, res) => {
  res.send(`
    <body style="background:#0d1117; color:#fff; font-family:Arial; text-align:center; padding-top:50px;">
        <title>Kluvert Soccer Arena</title>
        <h1>⚽ KLUVERT SOCCER ARENA</h1>
        <p style="color:#8b949e;">Welcome! Please use your authorized access link to enter the staking dashboard.</p>
    </body>
  `);
});

// =================================================================
// 2. SECURED PLAYER STAKE DASHBOARD ROUTE
// =================================================================
app.get('/stake-dash', async (req, res) => {
    const secretPass = req.query.key;
    const STAKE_PASSWORD = 'kluvertStake2026';

    if (secretPass !== STAKE_PASSWORD) {
        return res.status(403).send(`
            <body style="background:#0d1117; color:#fff; font-family:Arial; text-align:center; padding-top:50px;">
                <title>Access Denied - Kluvert Soccer Arena</title>
                <h1 style="color:#f85149;">Access Denied! 🚫</h1>
                <p style="color:#8b949e;">You are not authorized to view the player stake dashboard.</p>
            </body>
        `);
    }

    const quickStake = await getSetting('quick_stake') || 4;
    const clStake = await getSetting('cl_stake') || 150;

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kluvert Soccer Arena - Stake Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #0d1117; color: #fff; text-align: center; padding: 20px; margin: 0; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; max-width: 450px; margin: 0 auto 15px auto; padding: 0 5px; }
        #status-indicator { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #8b949e; }
        #status-dot { width: 9px; height: 9px; border-radius: 50%; background-color: gray; }
        #admin-warning-banner { display: none; background-color: #d29922; color: #000; padding: 10px; border-radius: 6px; margin: 0 auto 15px auto; max-width: 450px; font-weight: bold; font-size: 14px; text-align: center; box-sizing: border-box; }
        .card { background: #161b22; border: 1px solid #30363d; padding: 30px; border-radius: 12px; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        h1 { color: #58a6ff; font-size: 24px; margin-bottom: 20px; text-transform: uppercase; }
        .form-group { margin-bottom: 15px; text-align: left; }
        label { display: block; margin-bottom: 5px; font-size: 14px; color: #8b949e; }
        input, select { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 14px; background: #238636; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; margin-top: 10px; }
        button:hover { background: #2ea043; }
        .parsec-btn { background: #1f6feb; display: inline-block; padding: 16px; text-decoration: none; color: #fff; border-radius: 6px; font-weight: bold; margin-top: 15px; width: 100%; box-sizing: border-box; }
        .parsec-btn:hover { background: #388bfd; }
        .social-container { display: flex; justify-content: space-between; gap: 8px; margin-top: 20px; }
        .social-btn { flex: 1; padding: 10px; border-radius: 6px; text-decoration: none; color: #fff; font-weight: bold; font-size: 12px; text-align: center; display: none; }
        .whatsapp { background: #25d366; }
        .telegram { background: #0088cc; }
        .tiktok { background: #000; border: 1px solid #30363d; }
        #status { margin-top: 15px; font-weight: bold; color: #e3b341; }
    </style>
</head>
<body>
    <div class="top-bar">
        <div id="status-indicator">
            <span id="status-dot"></span>
            <span id="status-text">Checking status...</span>
        </div>
    </div>

    <div id="admin-warning-banner"></div>

    <div class="card" id="main-card">
        <h1>Kluvert Soccer Arena ⚽</h1>
        
        <div class="form-group">
            <label for="mode">Select Game Mode:</label>
            <select id="mode" onchange="updateAmount()">
                <option value="quick">Quick Match (Stake: ${quickStake} GHS)</option>
                <option value="champions_league">Champions League (Stake: ${clStake} GHS)</option>
            </select>
        </div>

        <div class="form-group">
            <label for="phone">MoMo Number:</label>
            <input type="tel" id="phone" value="" placeholder="e.g. 0241234567" required />
        </div>

        <div class="form-group">
            <label for="network">Network Provider:</label>
            <select id="network">
                <option value="mtn">MTN</option>
                <option value="vod">Telecel / Vodafone</option>
                <option value="atl">AT / AirtelTigo</option>
            </select>
        </div>

        <div class="form-group">
            <label for="amount">Stake Amount (GHS):</label>
            <input type="number" id="amount" value="${quickStake}" readonly />
        </div>

        <button onclick="placeStake()">STAKE & FIND OPPONENT 🚀</button>
        <div id="status"></div>

        <!-- DYNAMIC SOCIAL LINKS -->
        <div class="social-container">
            <a id="wa-btn" href="#" class="social-btn whatsapp" target="_blank">WhatsApp</a>
            <a id="tg-btn" href="#" class="social-btn telegram" target="_blank">Telegram</a>
            <a id="tk-btn" href="#" class="social-btn tiktok" target="_blank">TikTok</a>
        </div>
    </div>

    <script>
        const stakes = {
            quick: ${quickStake},
            champions_league: ${clStake}
        };

        function updateAmount() {
            const mode = document.getElementById('mode').value;
            document.getElementById('amount').value = stakes[mode];
        }

        async function checkSystemStatus() {
            try {
                const res = await fetch('/api/system-status');
                const data = await res.json();

                const dot = document.getElementById('status-dot');
                const text = document.getElementById('status-text');
                if (dot && text) {
                    dot.style.backgroundColor = data.isOnline ? '#3fb950' : '#f85149';
                    text.textContent = data.isOnline ? 'Arena Online' : 'Arena Offline';
                }

                const banner = document.getElementById('admin-warning-banner');
                if (banner) {
                    if (data.warning && data.warning.trim() !== "") {
                        banner.textContent = "⚠️ WARNING: " + data.warning;
                        banner.style.display = 'block';
                    } else {
                        banner.style.display = 'none';
                    }
                }

                // Handle Social Links Dynamically
                const waBtn = document.getElementById('wa-btn');
                if (data.whatsapp && data.whatsapp.trim() !== "") {
                    waBtn.href = data.whatsapp;
                    waBtn.style.display = 'block';
                } else {
                    waBtn.style.display = 'none';
                }

                const tgBtn = document.getElementById('tg-btn');
                if (data.telegram && data.telegram.trim() !== "") {
                    tgBtn.href = data.telegram;
                    tgBtn.style.display = 'block';
                } else {
                    tgBtn.style.display = 'none';
                }

                const tkBtn = document.getElementById('tk-btn');
                if (data.tiktok && data.tiktok.trim() !== "") {
                    tkBtn.href = data.tiktok;
                    tkBtn.style.display = 'block';
                } else {
                    tkBtn.style.display = 'none';
                }

            } catch (e) {
                const dot = document.getElementById('status-dot');
                const text = document.getElementById('status-text');
                if (dot && text) {
                    dot.style.backgroundColor = '#f85149';
                    text.textContent = 'Arena Offline';
                }
            }
        }

        checkSystemStatus();
        setInterval(checkSystemStatus, 5000);

        async function placeStake() {
            const phone = document.getElementById('phone').value;
            const network = document.getElementById('network').value;
            const amount = document.getElementById('amount').value;
            const statusDiv = document.getElementById('status');

            statusDiv.style.color = '#e3b341';
            statusDiv.innerText = 'Triggering MoMo prompt...';

            try {
                const res = await fetch('/stake', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, network, amount })
                });
                const data = await res.json();

                if(data.success) {
                    statusDiv.style.color = '#3fb950';
                    statusDiv.innerText = 'Payment successful! Loading game room...';
                    
                    setTimeout(() => {
                        document.getElementById('main-card').innerHTML = \`
                            <h1 style="color: #3fb950;">Stake Confirmed! ✅</h1>
                            <p style="color: #8b949e; margin-bottom: 20px;">Your payment was successful. Click below to enter the Parsec game room and start playing!</p>
                            
                            <a href="https://parsec.gg/g/3HBcsMhvECjJ4WiHxGP9sHjlVZP/91bc0c8e/" class="parsec-btn" target="_blank">
                                JOIN PARSEC GAME ROOM 🎮
                            </a>
                        \`;
                    }, 2000);

                } else {
                    statusDiv.style.color = '#f85149';
                    statusDiv.innerText = 'Failed: ' + (data.message || 'Check terminal log.');
                }
            } catch(e) {
                statusDiv.style.color = '#f85149';
                statusDiv.innerText = 'Error connecting to server.';
            }
        }
    </script>
</body>
</html>
  `);
});

// =================================================================
// 3. SECURED ADMIN DASHBOARD ROUTE
// =================================================================
app.get('/admin', async (req, res) => {
    const secretPass = req.query.key;
    const ADMIN_PASSWORD = 'kluvertSecret2026';

    if (secretPass !== ADMIN_PASSWORD) {
        return res.status(403).send(`
            <body style="background:#0d1117; color:#fff; font-family:Arial; text-align:center; padding-top:50px;">
                <title>Access Denied - Kluvert Soccer Arena</title>
                <h1 style="color:#f85149;">Access Denied! 🚫</h1>
                <p style="color:#8b949e;">You are not authorized to view the admin dashboard.</p>
            </body>
        `);
    }

    const quickStake = await getSetting('quick_stake');
    const clStake = await getSetting('cl_stake');
    const adminWarning = await getSetting('admin_warning') || "";
    const whatsappLink = await getSetting('whatsapp_link') || "";
    const telegramLink = await getSetting('telegram_link') || "";
    const tiktokLink = await getSetting('tiktok_link') || "";

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Kluvert Soccer Arena</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #0d1117; color: #fff; text-align: center; padding: 40px 20px; }
        .card { background: #161b22; border: 1px solid #30363d; padding: 30px; border-radius: 12px; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5); text-align: left; }
        h1 { color: #f85149; font-size: 22px; margin-bottom: 20px; text-transform: uppercase; text-align: center; }
        h3 { color: #58a6ff; font-size: 16px; margin-top: 20px; border-top: 1px solid #30363d; padding-top: 15px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-size: 14px; color: #8b949e; }
        input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 14px; background: #1f6feb; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; margin-top: 10px; }
        button:hover { background: #388bfd; }
        .warning-btn { background: #d29922; color: #000; }
        .warning-btn:hover { background: #e3b341; }
        .social-btn { background: #238636; }
        .social-btn:hover { background: #2ea043; }
        .back-link { display: block; margin-top: 20px; color: #8b949e; font-size: 12px; text-decoration: none; text-align: center; }
        .back-link:hover { color: #58a6ff; }
        #warning-status, #social-status { margin-top: 10px; font-size: 13px; text-align: center; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h1>⚙️ Admin Control Panel</h1>
        
        <form action="/admin/update?key=kluvertSecret2026" method="POST">
            <div class="form-group">
                <label for="quick_stake">Quick Match Stake (GHS):</label>
                <input type="number" id="quick_stake" name="quick_stake" value="${quickStake}" required />
            </div>
            <div class="form-group">
                <label for="cl_stake">Champions League Stake (GHS):</label>
                <input type="number" id="cl_stake" name="cl_stake" value="${clStake}" required />
            </div>
            <button type="submit">SAVE NEW STAKES 💾</button>
        </form>

        <h3>⚠️ Broadcast Warning Banner</h3>
        <div class="form-group">
            <label for="warning_message">Warning Text (Leave empty to clear):</label>
            <input type="text" id="warning_message" value="${adminWarning}" placeholder="e.g. Do not send money to any player!" />
        </div>
        <button type="button" class="warning-btn" onclick="updateWarning()">PUBLISH WARNING 📢</button>
        <div id="warning-status"></div>

        <h3>🌐 Manage Social Links</h3>
        <div class="form-group">
            <label for="whatsapp_link">WhatsApp Link:</label>
            <input type="text" id="whatsapp_link" value="${whatsappLink}" placeholder="https://chat.whatsapp.com/..." />
        </div>
        <div class="form-group">
            <label for="telegram_link">Telegram Link:</label>
            <input type="text" id="telegram_link" value="${telegramLink}" placeholder="https://t.me/..." />
        </div>
        <div class="form-group">
            <label for="tiktok_link">TikTok Link:</label>
            <input type="text" id="tiktok_link" value="${tiktokLink}" placeholder="https://tiktok.com/@..." />
        </div>
        <button type="button" class="social-btn" onclick="updateSocials()">SAVE SOCIAL LINKS 🔗</button>
        <div id="social-status"></div>

        <a href="/stake-dash?key=kluvertStake2026" class="back-link">🚀 Go to Player Stake Dashboard</a>
    </div>

    <script>
        async function updateWarning() {
            const message = document.getElementById('warning_message').value;
            const statusDiv = document.getElementById('warning-status');
            
            try {
                const res = await fetch('/api/admin/warning', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'kluvertSecret2026', message })
                });
                const data = await res.json();
                if (data.success) {
                    statusDiv.style.color = '#3fb950';
                    statusDiv.innerText = 'Warning banner updated successfully!';
                } else {
                    statusDiv.style.color = '#f85149';
                    statusDiv.innerText = 'Failed to update warning.';
                }
            } catch (e) {
                statusDiv.style.color = '#f85149';
                statusDiv.innerText = 'Network error updating warning.';
            }
        }

        async function updateSocials() {
            const whatsapp = document.getElementById('whatsapp_link').value;
            const telegram = document.getElementById('telegram_link').value;
            const tiktok = document.getElementById('tiktok_link').value;
            const statusDiv = document.getElementById('social-status');
            
            try {
                const res = await fetch('/api/admin/socials', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'kluvertSecret2026', whatsapp, telegram, tiktok })
                });
                const data = await res.json();
                if (data.success) {
                    statusDiv.style.color = '#3fb950';
                    statusDiv.innerText = 'Social links updated successfully!';
                } else {
                    statusDiv.style.color = '#f85149';
                    statusDiv.innerText = 'Failed to update social links.';
                }
            } catch (e) {
                statusDiv.style.color = '#f85149';
                statusDiv.innerText = 'Network error updating social links.';
            }
        }
    </script>
</body>
</html>
    `);
});

app.post('/api/admin/socials', express.json(), async (req, res) => {
    const { key, whatsapp, telegram, tiktok } = req.body;
    if (key !== 'kluvertSecret2026') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    db.run(`UPDATE settings SET value = ? WHERE key = 'whatsapp_link'`, [whatsapp || ""]);
    db.run(`UPDATE settings SET value = ? WHERE key = 'telegram_link'`, [telegram || ""]);
    db.run(`UPDATE settings SET value = ? WHERE key = 'tiktok_link'`, [tiktok || ""], (err) => {
        if (err) {
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

app.post('/admin/update', (req, res) => {
    const secretPass = req.query.key;
    if (secretPass !== 'kluvertSecret2026') {
        return res.status(403).send('Access Denied');
    }

    const { quick_stake, cl_stake } = req.body;

    db.run(`UPDATE settings SET value = ? WHERE key = 'quick_stake'`, [quick_stake]);
    db.run(`UPDATE settings SET value = ? WHERE key = 'cl_stake'`, [cl_stake], (err) => {
        if (err) {
            return res.status(500).send("Error updating settings");
        }
        res.redirect('/admin?key=kluvertSecret2026');
    });
});

// =================================================================
// 4. STAKE ENDPOINT
// =================================================================
app.post('/stake', async (req, res) => {
  const { phone, network, amount } = req.body;
  
  console.log(`\n🎮 HOST COMMISSION: Processing ${amount} GHS stake from ${phone}`);

  const result = await triggerMomoPrompt(phone, network, amount);

  if (result && result.status) {
    console.log("✅ MOMO PROMPT SUCCESS:", result.data.display_text || "Prompt sent successfully!");
    return res.json({ success: true, data: result });
  } else {
    return res.json({ success: false, message: result ? result.message : 'Charge failed' });
  }
});

// =================================================================
// 5. AUTOMATED MATCH-RESULT ENDPOINT
// =================================================================
app.post('/api/match-result', async (req, res) => {
    const { matchToken, player1Score, player2Score, isPenalty, isGrandFinal, runnerUpNetwork } = req.body;

    db.get(`SELECT * FROM matches WHERE token = ?`, [matchToken], async (err, match) => {
        if (err || !match) {
            return res.status(404).json({ success: false, message: 'Invalid or expired match token.' });
        }

        if (player1Score === player2Score && !isPenalty) {
            db.run(`UPDATE matches SET status = 'PENALTIES_ACTIVE' WHERE token = ?`, [matchToken]);
            return res.json({ 
                success: true, 
                status: 'PENALTIES_ACTIVE', 
                message: 'Match tied at full time. Triggering penalty shootout state.' 
            });
        }

        const winnerPhone = player1Score > player2Score ? match.player1_phone : match.player2_phone;
        const loserPhone = winnerPhone === match.player1_phone ? match.player2_phone : match.player1_phone;
        
        const totalPool = match.stake_amount * 2; 

        let winnerPayout = 0;
        let runnerUpPayout = 0;
        let ownerCommission = 0;

        if (isGrandFinal) {
            winnerPayout = 700;        
            runnerUpPayout = 15;       
            ownerCommission = totalPool - (winnerPayout + runnerUpPayout);
            if (ownerCommission < 0) ownerCommission = 0; 
        } else {
            ownerCommission = totalPool * 0.10;
            winnerPayout = totalPool - ownerCommission;
        }

        db.run(`UPDATE matches SET status = 'COMPLETED', winner_phone = ? WHERE token = ?`, [winnerPhone, matchToken], async (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, message: 'Database error saving match result.' });
            }

            const winnerPayoutResult = await sendWinnerPayout(winnerPhone, 'mtn', winnerPayout, "Kluvert Arena Champion");

            let runnerUpResult = null;
            if (isGrandFinal && runnerUpPayout > 0) {
                runnerUpResult = await sendWinnerPayout(loserPhone, runnerUpNetwork || 'mtn', runnerUpPayout, "Kluvert Arena Runner-Up");
            }

            if (winnerPayoutResult && winnerPayoutResult.status) {
                return res.json({ 
                    success: true, 
                    status: 'COMPLETED', 
                    winner: winnerPhone, 
                    winnerPayout: winnerPayout,
                    runnerUp: isGrandFinal ? loserPhone : null,
                    runnerUpPayout: runnerUpPayout,
                    ownerProfit: ownerCommission,
                    message: 'Match concluded, payouts sent, and owner profit secured automatically!'
                });
            } else {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Match finished, but automated payout transfer failed. Check terminal logs.' 
                });
            }
        });
    });
});

// =================================================================
// START SERVER
// =================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(`⚽ KLUVERT SOCCER ARENA IS LIVE ON PORT ${PORT}`);
  console.log(`==============================================\n`);
});