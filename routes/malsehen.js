/**
 * Express Router für die '/malsehen' Seite.
 * * Diese Route rendert die EJS-Vorlage 'malsehen' (die das HTML-Markup enthält).
 * Sie übergibt außerdem die notwendigen globalen Variablen für den Frontend-Code
 * in der index.html (z.B. Login-Status und eine simulierte User-ID).
 */
const express = require('express');
const router = express.Router();

// Simulierte Authentifizierungsdaten (In einer echten App würden diese von der Session stammen)
// Sie können diese Werte ändern, um den angemeldeten vs. nicht angemeldeten Zustand zu testen.
const SIMULATED_USER_ID = 'user-12345-frankfurt'; 
const SIMULATED_IS_LOGGED_IN = true; // Setzen Sie dies auf 'false', um den Gastmodus zu testen

// Route für GET /malsehen
router.get('/', (req, res) => {
    // Rendert die EJS-Vorlage mit dem Namen 'malsehen' (die das HTML-Markup enthält).
    // Beachten Sie, dass die Datei index.html im EJS-Setup oft als 'malsehen.ejs' umbenannt wird.
    res.render('malsehen', { 
        title: 'Q-Parking Reservierung', 
        error: null, 
        success: null,

        // WICHTIG: Diese Variablen werden im Frontend-JavaScript (index.html) verwendet!
        __isLoggedIn: SIMULATED_IS_LOGGED_IN,
        __expressUserId: SIMULATED_USER_ID
    });
});

module.exports = router;