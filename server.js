require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup SQLite Database for Dynamic Settings & Matches
const db = new sqlite3.Database('./kluvert_arena.db', (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite Database.');
});

// Initialize Settings Table (Stores dynamic stakes)
db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
)`);

// Initialize Matches Table (Stores automated match tokens and states)
db.run(`CREATE TABLE IF NOT EXISTS matches (
    token TEXT PRIMARY KEY,
    player1_phone TEXT,
    player2_phone TEXT,
    stake_amount REAL,
    status TEXT,
    winner_phone TEXT
)`);

// Default settings if none exist
db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('quick_stake', '4')`);
db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('cl_stake', '150')`);

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
        reason: `Prize payout for winning match on Kluvert Arena`
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
// 1. PUBLIC HOME PAGE
// =================================================================
app.get('/', (req, res) => {
  res.send(`
    <body style="background:#0d1117; color:#fff; font-family:Arial; text-align:center; padding-top:50px;">
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
    <title>KLUVERT SOCCER ARENA - Stake Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #0d1117; color: #fff; text-align: center; padding: 40px 20px; }
        .card { background: #161b22; border: 1px solid #30363d; padding: 30px; border-radius: 12px; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        h1 { color: #58a6ff; font-size: 24px; margin-bottom: 20px; text-transform: uppercase; }
        .form-group { margin-bottom: 15px; text-align: left; }
        label { display: block; margin-bottom: 5px; font-size: 14px; color: #8b949e; }
        input, select { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 14px; background: #238636; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; margin-top: 10px; }
        button:hover { background: #2ea043; }
        #status { margin-top: 15px; font-weight: bold; color: #e3b341; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Player Stake Dashboard ⚽</h1>
        
        <div class="form-group">
            <label for="mode">Select Game Mode:</label>
            <select id="mode" onchange="updateAmount()">
                <option value="quick">Quick Match (Stake: ${quickStake} GHS)</option>
                <option value="champions_league">Champions League (Stake: ${clStake} GHS)</option>
            </select>
        </div>

        <div class="form-group">
            <label for="phone">MoMo Number:</label>
            <input type="tel" id="phone" value="0591538085" placeholder="0591538085" required />
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
                    statusDiv.innerText = 'Prompt sent! Approve transaction on phone.';
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
// 3. SECURED ADMIN DASHBOARD ROUTE (Password Locked)
// =================================================================
app.get('/admin', async (req, res) => {
    const secretPass = req.query.key;
    const ADMIN_PASSWORD = 'kluvertSecret2026';

    if (secretPass !== ADMIN_PASSWORD) {
        return res.status(403).send(`
            <body style="background:#0d1117; color:#fff; font-family:Arial; text-align:center; padding-top:50px;">
                <h1 style="color:#f85149;">Access Denied! 🚫</h1>
                <p style="color:#8b949e;">You are not authorized to view the admin dashboard.</p>
            </body>
        `);
    }

    const quickStake = await getSetting('quick_stake');
    const clStake = await getSetting('cl_stake');

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Kluvert Arena</title>
    <style>
        body { font-family: Arial, sans-serif; background-color: #0d1117; color: #fff; text-align: center; padding: 40px 20px; }
        .card { background: #161b22; border: 1px solid #30363d; padding: 30px; border-radius: 12px; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.5); text-align: left; }
        h1 { color: #f85149; font-size: 22px; margin-bottom: 20px; text-transform: uppercase; text-align: center; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-size: 14px; color: #8b949e; }
        input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #fff; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 14px; background: #1f6feb; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; margin-top: 10px; }
        button:hover { background: #388bfd; }
        .back-link { display: block; margin-top: 20px; color: #8b949e; font-size: 12px; text-decoration: none; text-align: center; }
        .back-link:hover { color: #58a6ff; }
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
        <a href="/stake-dash?key=kluvertStake2026" class="back-link">🚀 Go to Player Stake Dashboard</a>
    </div>
</body>
</html>
    `);
});

// Handle Admin Updates
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
// 5. AUTOMATED MACHINE MATCH-RESULT & OWNER PROFIT SPLIT ENDPOINT
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

            console.log(`\n[FINANCIAL SPLIT REPORT]:`);
            console.log(`- Total Pool Collected: ${totalPool} GHS`);
            console.log(`- Winner Payout: ${winnerPayout} GHS`);
            console.log(`- Runner-Up Payout: ${runnerUpPayout} GHS`);
            console.log(`- Owner Profit: ${ownerCommission} GHS 🚀`);

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