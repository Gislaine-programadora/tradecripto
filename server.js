require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./tradecrypto.db');

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            balance REAL DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            amount REAL,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

app.get('/', (req, res) => {
    res.send('TradeCrypto API Online');
});

app.post('/user/create', (req, res) => {

    const { username } = req.body;

    db.run(
        `INSERT INTO users(username,balance) VALUES(?,0)`,
        [username],
        function(err){

            if(err){
                return res.status(400).json({
                    success:false,
                    error:err.message
                });
            }

            res.json({
                success:true,
                userId:this.lastID
            });
        }
    );
});

app.get('/user/:id', (req,res)=>{

    db.get(
        `SELECT * FROM users WHERE id=?`,
        [req.params.id],
        (err,row)=>{

            if(err){
                return res.status(500).json(err);
            }

            res.json(row);
        }
    );
});

app.post('/deposit', (req,res)=>{

    const { userId, amount } = req.body;

    db.run(
        `UPDATE users SET balance = balance + ? WHERE id=?`,
        [amount,userId],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            db.run(
                `INSERT INTO transactions(user_id,type,amount,status)
                 VALUES(?,?,?,'CONFIRMED')`,
                [userId,'DEPOSIT',amount]
            );

            res.json({
                success:true,
                credited:amount
            });
        }
    );
});

app.post('/withdraw', (req,res)=>{

    const { userId, amount } = req.body;

    db.get(
        `SELECT balance FROM users WHERE id=?`,
        [userId],
        (err,user)=>{

            if(err){
                return res.status(500).json(err);
            }

            if(!user){
                return res.status(404).json({
                    success:false,
                    error:'Usuário não encontrado'
                });
            }

            if(user.balance < amount){
                return res.status(400).json({
                    success:false,
                    error:'Saldo insuficiente'
                });
            }

            db.run(
                `UPDATE users
                 SET balance = balance - ?
                 WHERE id=?`,
                [amount,userId]
            );

            db.run(
                `INSERT INTO transactions(user_id,type,amount,status)
                 VALUES(?,?,?,'PENDING')`,
                [userId,'WITHDRAW',amount]
            );

            res.json({
                success:true,
                status:'PENDING'
            });
        }
    );
});

app.get('/transactions/:userId',(req,res)=>{

    db.all(
        `SELECT * FROM transactions
         WHERE user_id=?
         ORDER BY id DESC`,
        [req.params.userId],
        (err,rows)=>{

            if(err){
                return res.status(500).json(err);
            }

            res.json(rows);
        }
    );
});




app.get('/users', (req, res) => {

    db.all(
        'SELECT * FROM users',
        [],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);

        }
    );

});

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            balance REAL DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            amount REAL,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.get(
        "SELECT * FROM users WHERE username=?",
        ["admin"],
        (err, row) => {

            if (err) {
                console.log(err);
                return;
            }

            if (!row) {

                db.run(
                    "INSERT INTO users(username,balance) VALUES(?,?)",
                    ["admin", 10000],
                    function(err){

                        if(err){
                            console.log(err);
                            return;
                        }

                        console.log("Admin criado ID:", this.lastID);
                    }
                );

            } else {

                console.log("Admin existente ID:", row.id);

            }

        }
    );

});

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

server.on("error", (err) => {
    console.error("Erro no servidor:", err);
});

process.on("uncaughtException", (err) => {
    console.error("ERRO NÃO TRATADO:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("PROMISE REJEITADA:", err);
});

setInterval(() => {
    console.log("Servidor ativo:", new Date().toLocaleTimeString());
}, 10000);

const path = require('path');

app.get('/trade', (req, res) => {
    res.sendFile(path.join(__dirname, 'trade.html'));
});