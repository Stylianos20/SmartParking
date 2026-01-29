const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Für Overpass/OSRM
const db = require('../db'); // Zugriff auf die DB
const { reservationContainer } = require('../db'); // Pfad eventuell anpassen (z.B. ../models/db)


// -------------------------------------------------------------
// API ENDPUNKTE (Allgemein)
// -------------------------------------------------------------

// GET /api/spots - Alle Parkplätze aus DB (Voller Pfad: /parking/api/spots)
router.get('/api/spots', async (req, res) => {
    try {
        const spots = await db.getAllSpots();
        res.json(spots);
    } catch (error) {
        console.error("Fehler beim Abrufen der Parkplätze:", error.message);
        res.status(500).json({ message: "Interner Serverfehler beim Laden der Parkplätze." });
    }
});


// -------------------------------------------------------------
// ANSICHTS-ENDPUNKTE
// -------------------------------------------------------------

// GET / (Voller Pfad: /parking)
router.get('/', (req, res) => {
    res.render('parking', { title: "Parkplatz-Status", user: req.session.user });
});


// 1. EINCHECKEN
router.post('/api/gate-entry', async (req, res) => {
    try {
        const { plate, spotId } = req.body;
        console.log(`Einlassversuch: Kennzeichen ${plate}, Platz ${spotId}`);

        // 1. User finden, um die userId zu bekommen
        const userQuery = {
            query: "SELECT u.id FROM u WHERE u.vehicleLicense = @plate",
            parameters: [{ name: "@plate", value: plate.toUpperCase() }]
        };
        const { resources: users } = await db.userContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            return res.status(404).json({ error: "Kein Benutzer mit diesem Kennzeichen registriert." });
        }
        const userId = users[0].id;
                console.log("Suche Reservierung für User-ID:", userId, "auf Platz:", spotId);

        // 2. Reservierung für diesen User und diesen Platz finden
        const resQuery = {
            query: "SELECT * FROM c WHERE c.userId = @userId AND c.spotId = @spotId AND c.status = 'active' AND IS_DEFINED(c.entryTime) = false",
            parameters: [
                { name: "@userId", value: userId },
                { name: "@spotId", value: spotId }
            ]
        };
        const { resources: reservations } = await db.reservationContainer.items.query(resQuery).fetchAll();

        if (reservations.length === 0) {
            return res.status(404).json({ error: "Keine passende Reservierung gefunden." });
        }

        let reservation = reservations[0];

        // 3. Zeitstempel setzen und speichern
        reservation.entryTime = new Date().toISOString();        
        // Nutze die update-Funktion aus deiner db.js
        await db.updateReservation(reservation);

        res.json({ message: "Schranke geöffnet. Willkommen!" });

    } catch (err) {
        console.error("Fehler beim Gate-Entry:", err);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// 2. AUSCHECKEN (GATE-EXIT) mit dynamischer Preisberechnung
router.post('/api/gate-exit', async (req, res) => {
    try {
        const { plate, spotId } = req.body;
        
        // 1. User & Aktive Reservierung suchen
        const userQuery = {
            query: "SELECT u.id FROM u WHERE u.vehicleLicense = @plate",
            parameters: [{ name: "@plate", value: plate.toUpperCase() }]
        };
        const { resources: users } = await db.userContainer.items.query(userQuery).fetchAll();
        if (users.length === 0) return res.status(404).json({ error: "User nicht gefunden" });

        const userId = users[0].id;
        const resQuery = {
            query: "SELECT * FROM c WHERE c.userId = @userId AND c.spotId = @spotId AND c.status = 'active' AND IS_DEFINED(c.entryTime) = true",
            parameters: [{ name: "@userId", value: userId }, { name: "@spotId", value: spotId }]
        };
        const { resources: stays } = await db.reservationContainer.items.query(resQuery).fetchAll();
        if (stays.length === 0) return res.status(404).json({ error: "Kein Fahrzeug im Parkhaus gefunden." });

        let stay = stays[0];

        // 2. Parkplatz-Daten für den Preis holen
        const spot = await db.getSpotById(spotId);
        const hourlyRate = (spot && spot.pricePerHour) ? spot.pricePerHour : 0; 

        // 3. Dauer berechnen
        const entryTime = new Date(stay.entryTime);
        const exitTime = new Date();
        const durationMs = exitTime - entryTime;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));
        
        // Preis: Jede angefangene Stunde berechnen (mindestens 1)
        const billingHours = Math.ceil(durationMinutes / 60) || 1;
        const totalPrice = billingHours * hourlyRate;

        // 4. Reservierung abschließen
        stay.status = 'completed';
        stay.exitTime = exitTime.toISOString();
        stay.totalPrice = totalPrice;
        await db.updateReservation(stay);

        // 5. Parkplatz-Zähler erhöhen
        if (spot) {
            spot.availableCount = (spot.availableCount || 0) + 1;
            await db.updateSpotStatus(spot);
        }

        res.json({ 
            message: "Ausfahrt erfolgreich. Gute Fahrt!",
            invoice: {
                duration: `${durationMinutes} Minuten`,
                price: `${totalPrice.toFixed(2)}€`,
                rate: `${hourlyRate.toFixed(2)}€/Std`
            }
        });

    } catch (err) {
        console.error("Exit Fehler:", err);
        res.status(500).json({ error: "Fehler bei der Abrechnung" });
    }
});


router.get('/api/my-active-spots/:plate', async (req, res) => {
    try {
        const plate = req.params.plate.toUpperCase();

        // 1. Benutzer anhand des Kennzeichens suchen
        const userQuery = {
            query: "SELECT u.id FROM u WHERE u.vehicleLicense = @plate",
            parameters: [{ name: "@plate", value: plate }]
        };
        
        // WICHTIG: Nutze hier deinen User-Container (eventuell db.userContainer)
        const { resources: users } = await db.userContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            return res.json([]); // Kein Benutzer mit diesem Kennzeichen
        }

        const userId = users[0].id;

        // 2. Aktive Reservierungen für diese userId suchen
        const resQuery = {
            query: "SELECT c.spotId, c.id FROM c WHERE c.userId = @userId AND (c.status = 'active' )",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: reservations } = await db.reservationContainer.items.query(resQuery).fetchAll();
        
        res.json(reservations);
    } catch (err) {
        console.error("Fehler beim Abrufen der Spots:", err);
        res.status(500).json({ error: err.message });
    }
});

// Hilfsfunktion für den Admin-Check
// --- Rechnung stellen --- 
const PDFDocument = require('pdfkit');

router.get('/invoice/:id', async (req, res) => {
    try {
        const user = req.user || req.session.user;
        if (!user || !user.id) return res.status(401).send('Nicht autorisiert.');

        // 1. Reservierung laden
        const { resource: data } = await reservationContainer.item(req.params.id, user.id).read();
        if (!data || data.status !== 'completed') {
            return res.status(404).send('Rechnung noch nicht verfügbar.');
        }

        // 2. Parkplatz-Details laden
        const spot = await db.getSpotById(data.spotId); 
        const stationName = spot ? spot.name : "Smart Parking Station";
        const stationAddress = spot 
            ? `${spot.street} ${spot.houseNumber}, ${spot.zip} ${spot.stadt}` 
            : "Burgfeldstraße 19, 61169 Friedberg";
        const hourlyRate = (spot && spot.pricePerHour) ? spot.pricePerHour : 2.00;

        // --- WICHTIG: DATUMS-OBJEKTE DEFINIEREN ---
        const entryDate = new Date(data.entryTime);
        const exitDate = new Date(data.exitTime);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rechnung-${data.id.substring(0,8)}.pdf`);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        // --- HEADER ---
        try { doc.image('public/images/favicon.png', 50, 40, { width: 45 }); } catch (e) {}
        doc.fillColor('#00abfa').fontSize(20).text('SMART PARKING GMBH', 110, 57);
        doc.fontSize(10).fillColor('#7a7a7a').text(`${stationName}`, 110, 80);
        doc.fontSize(22).fillColor('#000000').text('RECHNUNG', 50, 140, { align: 'right' });

        // --- INFO BLOCK ---
        doc.moveDown();
        doc.fillColor('#000000').fontSize(10).text(`Rechnungs-Nr: INV-${data.id.substring(0,8).toUpperCase()}`, { align: 'right' });
        doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, { align: 'right' });

        doc.text('Empfänger:', 50, 200);
        doc.fontSize(12).fillColor('#333333').text(`${user.firstName || 'Kunde'} ${user.lastName || ''}`, 50, 215);
        doc.fontSize(10).text(`Kennzeichen: ${data.vehicleLicense}`, 50, 230);
        doc.text(`Parkplatz: ${data.spotId}`, 50, 245);

        // --- TABELLE KOPF ---
        const tableTop = 300;
        doc.rect(50, tableTop, 500, 20).fill('#f0f0f0');
        doc.fillColor('#000000').fontSize(10).text('Beschreibung', 60, tableTop + 7);
        doc.text('Dauer', 280, tableTop + 7);
        doc.text('Satz', 370, tableTop + 7);
        doc.text('Gesamt', 470, tableTop + 7);

        // --- TABELLE INHALT ---
        const optionsTime = { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' };
        const entryT = entryDate.toLocaleTimeString('de-DE', optionsTime);
        const exitT = exitDate.toLocaleTimeString('de-DE', optionsTime);
        const dateStr = entryDate.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
        
        const rowTop = tableTop + 35;
        doc.fontSize(9).fillColor('#333333');
        doc.text(`Parken am ${dateStr}`, 60, rowTop);
        doc.fillColor('#7a7a7a').text(`${entryT} Uhr bis ${exitT} Uhr`, 60, rowTop + 12);
        doc.fontSize(8).text(stationAddress, 60, rowTop + 24);
        
        // --- UMRECHNUNG MINUTEN IN STUNDEN (Jetzt mit definierten Variablen) ---
        const totalDiffMinutes = Math.ceil((exitDate - entryDate) / 60000);
        const hours = Math.floor(totalDiffMinutes / 60);
        const mins = totalDiffMinutes % 60;
        const durationStr = hours > 0 ? `${hours} Std. ${mins} Min.` : `${mins} Min.`;

        doc.fontSize(10).fillColor('#333333').text(durationStr, 280, rowTop);
        doc.text(`${hourlyRate.toFixed(2)} €/h`, 370, rowTop);

        const total = data.totalPrice || 0;
        doc.fontSize(11).text(`${total.toFixed(2)} €`, 470, rowTop, { bold: true });

        // --- SUMMEN-BLOCK ---
        const netto = total / 1.19;
        const mwst = total - netto;
        const summaryTop = rowTop + 80;

        doc.fontSize(10).fillColor('#000000');
        doc.text('Netto:', 350, summaryTop);
        doc.text(`${netto.toFixed(2)} €`, 470, summaryTop, { align: 'right' });
        doc.text('MwSt. (19%):', 350, summaryTop + 15);
        doc.text(`${mwst.toFixed(2)} €`, 470, summaryTop + 15, { align: 'right' });

        doc.rect(340, summaryTop + 35, 210, 30).fill('#238636');
        doc.fillColor('#ffffff').fontSize(12).text('GESAMTBETRAG:', 350, summaryTop + 45);
        doc.fontSize(14).text(`${total.toFixed(2)} €`, 470, summaryTop + 43, { align: 'right', bold: true });

        doc.fillColor('#999999').fontSize(8).text(`Smart Parking GmbH | ${stationAddress}`, 50, 750, { align: 'center' });

        doc.end();
    } catch (error) {
        console.error('LOG PDF FEHLER:', error);
        res.status(500).send('Fehler bei der PDF-Erstellung.');
    }
});
module.exports = router;
