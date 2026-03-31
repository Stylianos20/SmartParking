const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// --- Auth Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    if (req.headers['accept']?.includes('application/json') || req.xhr) {
        return res.status(401).json({ message: "Nicht angemeldet." });
    }
    // Ansonsten zur Login-Seite umleiten.
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
        // 1. Check, ob die E-Mail schon existiert
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
            return res.render('register', { title: 'Konto registrieren', error: 'E-Mail bereits registriert' });
        }

        // 2. NEU: Check, ob das Kennzeichen schon existiert
        const plateUpper = vehicleLicense.toUpperCase();
        const userQuery = {
            query: "SELECT * FROM u WHERE u.vehicleLicense = @plate",
            parameters: [{ name: "@plate", value: plateUpper }]
        };
        const { resources: usersWithPlate } = await db.userContainer.items.query(userQuery).fetchAll();

        if (usersWithPlate.length > 0) {
            return res.render('register', { 
                title: 'Konto registrieren', 
                error: 'Dieses Kennzeichen ist bereits mit einem anderen Konto verknüpft.' 
            });
        }

        // 3. Wenn alles okay ist: Passwort hashen und User anlegen
        const passwordHash = await bcrypt.hash(password, 10);
        await db.registerUser({
            id: crypto.randomUUID(),
            firstName,
            lastName,
            email,
            passwordHash,
            vehicleLicense: plateUpper, 
            creationDate: new Date().toISOString()
        });

        res.render('login', { 
            title: 'Anmelden', 
            success: 'Registrierung erfolgreich! Bitte melden Sie sich jetzt an.', 
            error: null 
        });

    } catch (err) {
        console.error("Registrierungsfehler:", err);
        res.render('register', { 
            title: 'Konto registrieren', 
            error: 'Serverfehler. Bitte später erneut versuchen.' 
        });
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
            res.redirect('/parking');
        });
    } catch (err) {
        console.error(err);
        res.render('login', { title: 'Anmelden', error: 'Serverfehler' });
    }
});

router.get('/profil', isAuthenticated, async (req, res) => {
    try {
        // 1. Alle Reservierungen holen (Active, Completed, Cancelled)
        const allReservations = await db.getAllReservationsForUser(req.session.userId);
        
        // 2. Wir filtern NICHT mehr im Backend. Wir reichern ALLES an.
        const enrichedReservations = await Promise.all(allReservations.map(async (resrv) => {
            try {
                const spotDetails = await db.getSpotById(resrv.spotId);
                
                return {
                    ...resrv,
                    // Wenn der Status fehlt, Standard auf 'active'
                    status: resrv.status || 'active', 
                    spotName: spotDetails ? spotDetails.name : "Unbekannter Ort",
                    stadt: spotDetails ? spotDetails.stadt : "Stadt unbekannt",
                    street: spotDetails ? spotDetails.street : "Adresse fehlt",
                    price: spotDetails ? spotDetails.pricePerHour : 0
                };
            } catch (err) {
                return { ...resrv, status: resrv.status || 'active', spotName: "Info nicht verfügbar" };
            }
        }));

        // DEBUG LOG: Prüfe dein Terminal!
        console.log(`DEBUG: Schicke ${enrichedReservations.length} Einträge an das Profil.`);

        res.render('profil', { 
            title: 'Mein Profil', 
            user: req.session.user, 
            reservations: enrichedReservations, // Jetzt sind alle dabei!
            error: null,
            success: null
        });
    } catch (err) {
        console.error("Profil-Ladefehler:", err);
        res.render('profil', { 
            title: 'Mein Profil', 
            user: req.session.user, 
            error: 'Fehler beim Laden der Parkvorgänge', 
            reservations: [] 
        });
    }
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
        user.resetPasswordExpires = Date.now() + 3600000;

        await db.updateUser(user);

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

        const resetUrl = `https://${req.headers.host}/users/reset-password/${token}`;

await transporter.sendMail({
    to: user.email,
    subject: 'Passwort zurücksetzen - SmartParking',
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0078d4; padding: 20px; text-align: center;">
            <img src="cid:smartlogo" alt="SmartParking Logo" style="width: 80px; height: auto; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">SmartParking</h1>
        </div>
        
        <div style="padding: 30px; line-height: 1.6; color: #333333;">
            <h2 style="color: #0078d4;">Passwort zurücksetzen</h2>
            <p>Hallo,</p>
            <p>wir haben eine Anfrage zum Zurücksetzen deines Passworts für dein SmartParking-Konto erhalten. Klicke auf den unteren Button, um ein neues Passwort festzulegen:</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" 
                   style="background-color: #0078d4; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                   Neues Passwort festlegen
                </a>
            </div>
            
            <p style="font-size: 0.9em; color: #666666;">
                Dieser Link ist für <strong>60 Minuten</strong> gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail einfach ignorieren. Dein Passwort bleibt unverändert.
            </p>
        </div>
        
        <div style="background-color: #f9f9f9; padding: 15px; text-align: center; font-size: 0.8em; color: #999999; border-top: 1px solid #e0e0e0;">
            <p>&copy; 2026 SmartParking Projekt Team<br>Azure Cloud Services</p>
        </div>
    </div>
    `,
    // Das Attachment sorgt dafür, dass das Bild in der E-Mail landet
    attachments: [{
        filename: 'favicon.png',
        path: './public/images/favicon.png', // Prüfe, ob dein Bild wirklich hier liegt!
        cid: 'smartlogo' // Muss exakt wie oben im img-Tag heißen
    }]
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
router.get('/reset-password/:token', async (req, res) => {
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

// 4. POST /users/reset/:token - Passwort speichern
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body; // Beide Felder auslesen!

        // 1. Check: Stimmen die Passwörter überein?
        if (password !== confirmPassword) {
            return res.render('reset-password', { 
                title: 'Neues Passwort', 
                token: token,
                error: 'Die Passwörter stimmen nicht überein.',
                success: null 
            });
        }

        // 2. User suchen
        const user = await db.getUserByResetToken(token);
        if (!user || user.resetPasswordExpires < Date.now()) {
            return res.render('forgot-password', { 
                title: 'Passwort vergessen', 
                error: 'Der Link ist ungültig oder abgelaufen.', 
                success: null 
            });
        }

        // 3. Passwort hashen
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password, salt);

        // 4. Token leeren (null statt undefined für Cosmos DB!)
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;

        // 5. Update in Datenbank
        await db.updateUser(user);

        // 6. Erfolg: Zum Login weiterleiten
        res.render('login', { 
            title: 'Anmelden', 
            success: 'Dein Passwort wurde erfolgreich geändert!', 
            error: null 
        });

    } catch (err) {
        console.error("Fehler beim Passwort-Reset:", err);
        res.render('reset-password', { 
            title: 'Neues Passwort', 
            error: 'Datenbankfehler beim Speichern.', 
            token: req.params.token 
        });
    }
});

// --- POST /change-password ---
router.post('/change-password', isAuthenticated, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    try {
        // User anhand der E-Mail aus der Session finden
        const user = await db.getUserByEmail(req.session.user.email); 

        // Passwort-Match prüfen
        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
            return res.render('profil', { 
                title: 'Mein Profil', 
                user: req.session.user, 
                error: 'Aktuelles Passwort ist falsch.' 
            });
        }

        // Neues Passwort hashen
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);

        // In DB speichern
        await db.updateUser(user);

        res.render('profil', { 
            title: 'Mein Profil', 
            user: req.session.user, 
            success: 'Passwort wurde geändert!' 
        });

    } catch (err) {
        console.error(err);
        res.render('profil', { 
            title: 'Mein Profil', 
            user: req.session.user, 
            error: 'Fehler beim Speichern.' 
        });
    }
});

module.exports = router;