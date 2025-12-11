const express = require('express');
const router = express.Router();
// Stelle sicher, dass der Pfad zu deiner Datenbank-Logik (db.js) korrekt ist.
const db = require('../db'); 

// Middleware: Prüft angemeldeten Benutzer
function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    // Gibt 401 für API-Aufrufe zurück
    return res.status(401).json({ message: "Sie müssen angemeldet sein." }); 
}

// =======================================================
// POST /reserve (Voller Pfad: /api/reserve)
// =======================================================
router.post('/reserve', isAuthenticated, async (req, res) => {
    const { spotId } = req.body;
    const userId = req.session.userId;

    if (!spotId) return res.status(400).json({ message: "Fehlende Parkplatz-ID." });

    try {
        const result = await db.createReservation(spotId, userId);

        if (result.error) return res.status(409).json({ message: result.error });

        // Session aktualisieren
        req.session.user = req.session.user || {};
        req.session.user.activeReservationId = result.reservationId;
        req.session.user.reservedSpotId = spotId;
        req.session.user.reservationEndTime = result.endTime;

        req.session.save(err => {
            if (err) console.error("Session-Speicherfehler:", err);
            res.json({
                message: `Parkplatz erfolgreich reserviert! ID: ${result.reservationId}`,
                success: true,
                reservationId: result.reservationId
            });
        });

    } catch (error) {
        console.error("Interner Serverfehler bei der Reservierung:", error);
        res.status(500).json({ message: "Reservierung fehlgeschlagen." });
    }
});

// =======================================================
// POST /release (Voller Pfad: /api/release)
// Storniert die aktive Reservierung des Benutzers, setzt den Parkplatz frei.
// NEU: Vereinfachte Logik zur robusten Behandlung von Session- und Body-IDs.
// =======================================================
router.post('/release', isAuthenticated, async (req, res) => {
    const user = req.session.user || {};
    const secureUserId = req.session.userId; 
    const { reservationId: bodyReservationId, spotId: bodySpotId } = req.body;
    const reservationId = user.activeReservationId || bodyReservationId;
    const spotId = user.reservedSpotId || bodySpotId;

    // Finaler Check der notwendigen IDs
    if (!reservationId || !spotId || !secureUserId) {
        // HILFREICHES DEBUGGING: Zeigt im Server-Log, welche ID fehlt, was zum 400-Fehler führt
        console.error("DEBUG: 400 Freigabefehler - Fehlende IDs:", { 
            reservationId: reservationId || "FEHLT", 
            spotId: spotId || "FEHLT", 
            userId: secureUserId || "FEHLT",
            source: user.activeReservationId ? 'Session' : (bodyReservationId ? 'Body' : 'None')
        });

        return res.status(400).json({ 
            message: "Fehlende Reservierungs- oder Parkplatz-ID zur Freigabe. Stellen Sie sicher, dass eine aktive Reservierung vorliegt oder die IDs im Request Body enthalten sind." 
        });
    }


    try {
        // 1. Verwende die dedizierte und sichere Datenbankfunktion
        const updatedSpot = await db.releaseReservation(reservationId, spotId, secureUserId);

        // 2. Session nur dann zurücksetzen, wenn die Reservierung aus der Session stammt
        if (user.activeReservationId === reservationId) {
            delete req.session.user.activeReservationId;
            delete req.session.user.reservedSpotId;
            delete req.session.user.reservationEndTime;
        }

        req.session.save(err => {
            if (err) console.error("Session-Fehler beim Release:", err);
            res.json({ 
                message: "Parkplatz erfolgreich freigegeben und Reservierung storniert!",
                spot: updatedSpot 
            });
        });

    } catch (error) {
        console.error("Fehler beim Freigeben des Parkplatzes:", error);
        // Gib die Fehlermeldung der DB weiter
        res.status(500).json({ message: `Fehler beim Freigeben des Parkplatzes: ${error.message}` });
    }
});

// =======================================================
// GET /history (Voller Pfad: /reservations/history)
// =======================================================
// Beispiel für Ihre History-Route
router.get('/history', isAuthenticated, async (req, res) => {
    const userId = req.session.userId;
    let reservations = []; // Sicherstellen, dass die Variable initialisiert ist

    try {
        // Ruft die Daten ab, die Sie gerade als korrekt bestätigt haben
        reservations = await db.getAllReservationsForUser(userId); 
        
    } catch (error) {
        console.error("Fehler beim Laden der Reservierungshistorie:", error);
        // Behandeln Sie den Fehler, indem Sie ihn im Frontend anzeigen
        return res.render('reservations', { pageTitle: 'Meine Reservierungen', error: 'Datenbankfehler beim Laden der Historie.', reservations: [] });
    }

    // Stellen Sie sicher, dass 'reservations' korrekt übergeben wird:
    res.render('reservations', {
        pageTitle: 'Meine Reservierungen',
        reservations: reservations // <--- Hier müssen die Daten drin sein!
    });
});


module.exports = router;