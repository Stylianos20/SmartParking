const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// --- Auth Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    
    // Wenn es eine API-Anfrage ist (z.B. eine Reservierung), 401 senden.
    if (req.headers['accept']?.includes('application/json') || req.xhr) {
        return res.status(401).json({ message: "Nicht angemeldet." });
    }
    
    // 💡 Empfehlung: Wenn der User nicht für /parking angemeldet ist, leiten wir direkt zum Login weiter.
    // In diesem Fall wäre es besser, direkt zur Login-Seite weiterzuleiten, 
    // falls die Route /parking/api/spots in dieser Middleware geschützt wäre, 
    // aber wir behalten es bei /users/login, um Konsistenz zu gewährleisten.
    res.redirect('/users/login');
}

// --- GET /register ---
router.get('/register', (req, res) => {
    res.render('register', { 
        title: 'Konto registrieren', 
        error: null, 
        success: null
    });
});

// --- POST /register ---
router.post('/register', async (req, res) => {
    const { firstName, lastName, email, password, vehicleLicense } = req.body;
    if (!email || !password || !firstName || !lastName || !vehicleLicense) {
        return res.render('register', { title: 'Konto registrieren', error: 'Bitte alle Felder ausfüllen' });
    }
    try {
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) return res.render('register', { title: 'Konto registrieren', error: 'E-Mail bereits registriert' });

        const passwordHash = await bcrypt.hash(password, 10);
        await db.registerUser({
            id: crypto.randomUUID(),
            firstName,
            lastName,
            email,
            passwordHash,
            vehicleLicense,
            creationDate: new Date().toISOString()
        });

        // 💡 NACH DER ERFOLGREICHEN REGISTRIERUNG: Weiterleitung zur Login-Seite
        res.render('login', { title: 'Anmelden', success: 'Registrierung erfolgreich! Bitte melden Sie sich jetzt an.', error: null });
    } catch (err) {
        console.error(err);
        res.render('register', { title: 'Konto registrieren', error: 'Serverfehler. Bitte später erneut versuchen.' });
    }
});

// --- GET /login ---
router.get('/login', (req, res) => {
    res.render('login', { title: 'Anmelden', error: null, success: null });
});


// --- POST /login ---
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db.getUserByEmail(email);
        if (!user) return res.render('login', { title: 'Anmelden', error: 'Benutzer nicht gefunden' });

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.render('login', { title: 'Anmelden', error: 'Falsches Passwort' });

        req.session.userId = user.id;
        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            vehicleLicense: user.vehicleLicense,
            creationDate: user.creationDate
        };

        req.session.save(err => {
            if (err) console.error(err);
            // 🔑 KORREKTUR: Nach erfolgreichem Login zur Parkplatz-Seite umleiten.
            // Dies zwingt den Browser, JSparking.js mit dem neuen Status neu zu laden.
            res.redirect('/parking');
        });
    } catch (err) {
        console.error(err);
        res.render('login', { title: 'Anmelden', error: 'Serverfehler' });
    }
});

// --- GET /profil ---
router.get('/profil', isAuthenticated, (req, res) => {
    res.render('profil', { title: 'Mein Profil', user: req.session.user, error: null });
});

// --- GET /logout ---
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error(err);
        
        // Lösche das Session-Cookie und leite zur Parkplatz-Übersicht um, 
        // um den Client-Status zu aktualisieren (isLoggedIn = false).
        res.clearCookie('connect.sid'); 
        // 🔑 KORREKTUR: Nach erfolgreichem Logout zur Parkplatz-Seite umleiten.
        res.redirect('/parking'); 
    });
});

// --- GET /status ---
router.get('/status', (req, res) => {
    if (req.session.user) {
        res.json({ isLoggedIn: true, userId: req.session.user.id });
    } else {
        res.json({ isLoggedIn: false, userId: null });
    }
});



// --- PASSWORT ZURÜCKSETZEN ---

// 1. GET /forgot-password (Die Seite anzeigen)
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { title: 'Passwort vergessen', error: null, success: null });
});

// 2. POST /forgot-password (E-Mail prüfen & Token senden)
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await db.getUserByEmail(email);
        if (!user) {
            // Aus Sicherheitsgründen oft die gleiche Nachricht wie beim Erfolg
            return res.render('forgot-password', { title: 'Passwort vergessen', error: 'Email nicht gefunden.', success: null });
        }

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 Stunde gültig

        await db.updateUser(user);

        // E-Mail Konfiguration (Beispiel für Gmail oder Azure Communication Services)
 const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        // Dies verhindert, dass Azure die Verbindung abbricht
        rejectUnauthorized: false 
    }
});

        const resetUrl = `https://${req.headers.host}/users/reset/${token}`;
        
        await transporter.sendMail({
            to: user.email,
            subject: 'Passwort zurücksetzen - SmartParking',
            text: `Klicken Sie hier, um Ihr Passwort zurückzusetzen: ${resetUrl}`
        });

        res.render('forgot-password', { title: 'Passwort vergessen', error: null, success: 'E-Mail wurde gesendet!' });
    } catch (err) {
        console.error("DEBUG E-MAIL FEHLER:", err); // Zeigt Details im Azure Log-Stream
    res.render('forgot-password', { 
        title: 'Passwort vergessen', 
        error: `Fehler: ${err.message}`, // Zeigt den genauen Fehler auf der Webseite an
        success: null 
    });
    }
});

// 3. GET /reset/:token - Seite anzeigen
router.get('/reset/:token', async (req, res) => {
    try {
        const user = await db.getUserByResetToken(req.params.token);
        
        if (!user || user.resetPasswordExpires < Date.now()) {
            return res.render('forgot-password', { 
                title: 'Passwort vergessen', 
                error: 'Der Link ist ungültig oder abgelaufen.', 
                success: null 
            });
        }
        
        res.render('reset-password', { 
            title: 'Neues Passwort vergeben', 
            token: req.params.token, 
            error: null 
        });
    } catch (err) {
        res.redirect('/users/forgot-password');
    }
});

// 4. POST /reset/:token - Passwort speichern
router.post('/reset/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        // User suchen
        const user = await db.getUserByResetToken(token);
        if (!user || user.resetPasswordExpires < Date.now()) {
            return res.render('forgot-password', { 
                title: 'Passwort vergessen', 
                error: 'Token ungültig.', 
                success: null 
            });
        }

        // 1. Neues Passwort hashen
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password, salt);

        // 2. Token Felder leeren (Wichtig: auf null setzen für Cosmos DB)
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;

        // 3. Datenbank Update
        // WICHTIG: Deine db.updateUser(user) muss funktionieren!
        await db.updateUser(user);

        // 4. Erfolg: Zurück zum Login
        res.render('login', { 
            title: 'Anmelden', 
            success: 'Dein Passwort wurde geändert. Du kannst dich jetzt einloggen.', 
            error: null 
        });

    } catch (err) {
        console.error("Fehler beim Passwort-Reset:", err);
        res.render('reset-password', { 
            title: 'Neues Passwort', 
            error: 'Fehler beim Speichern in der Datenbank.', 
            token: req.params.token 
        });
    }
});



module.exports = router;