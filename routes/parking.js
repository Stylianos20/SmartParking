const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Für Overpass/OSRM
const db = require('../db'); // Zugriff auf die DB
const { reservationContainer } = require('../db'); // Pfad eventuell anpassen (z.B. ../models/db)

// -------------------------------------------------------------
// HELPER FUNKTIONEN (Overpass und OSRM)
// -------------------------------------------------------------

/**
 * Ruft Parkplätze über die Overpass API ab (Beispielgebiet Frankfurt).
 */
async function getParkingSpotsFromOverpass() {
    const overpassQuery = `
        [out:json][timeout:25];
        (
            node["amenity"="parking"](50.1,8.6,50.15,8.7);
            way["amenity"="parking"](50.1,8.6,50.15,8.7);
        );
        out center;
    `;

    try {
        const response = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: overpassQuery
        });
        const data = await response.json();
        return data.elements.map(el => ({
            type: el.type,
            name: el.tags ? el.tags.name : "Unbekannter Parkplatz",
            lat: el.lat || (el.center ? el.center.lat : null),
            lon: el.lon || (el.center ? el.center.lon : null)
        }));
    } catch (error) {
        console.error("Overpass API Fehler:", error.message);
        return [];
    }
}

/**
 * Berechnet Fahrstrecke und Dauer über OSRM.
 */
async function getRouteDistance(startLon, startLat, endLon, endLat) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=false`;
    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();
        if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
            throw new Error(`OSRM Fehler: ${data.message || "Keine Route gefunden"}`);
        }
        return {
            distance: data.routes[0].distance,
            duration: data.routes[0].duration
        };
    } catch (error) {
        console.error("OSRM API Fehler:", error.message);
        throw new Error("Fehler bei der Streckenberechnung.");
    }
}


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


// GET /nearest - Nächste Parkplätze inkl. Routing (Voller Pfad: /parking/nearest)
router.get('/nearest', async (req, res) => {
    const { startLat, startLon } = req.query;
    if (!startLat || !startLon) {
        return res.status(400).json({ error: "Bitte Startkoordinaten (startLat, startLon) angeben." });
    }

    try {
        const spots = await getParkingSpotsFromOverpass();
        if (spots.length === 0) {
            return res.status(404).json({ message: "Keine Parkplätze in diesem Gebiet gefunden." });
        }

        const routingPromises = spots.map(async spot => {
            try {
                const info = await getRouteDistance(startLon, startLat, spot.lon, spot.lat);
                return {
                    ...spot,
                    distanceMeters: info.distance,
                    durationSeconds: info.duration,
                    distanceKm: (info.distance / 1000).toFixed(1) + " km"
                };
            } catch (error) {
                console.warn(`Routing-Fehler für ${spot.name}: ${error.message}`);
                return { ...spot, error: "Routing fehlgeschlagen" };
            }
        });

        const spotsWithRoutes = await Promise.all(routingPromises);
        const sorted = spotsWithRoutes.filter(s => !s.error)
                                     .sort((a,b) => a.distanceMeters - b.distanceMeters)
                                     .slice(0,5);

        res.json({ startLocation: { lat: startLat, lon: startLon }, nearestParkingSpots: sorted });

    } catch (error) {
        console.error("Kombinierter API-Fehler:", error);
        res.status(500).json({ message: "Interner Serverfehler." });
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
        // Prüfe, ob der User in req.user oder req.session.user steckt
        const user = req.user || req.session.user;

        if (!user || !user.id) {
            console.error("LOG: Kein User in der Session gefunden!");
            return res.status(401).send('Nicht autorisiert. Bitte neu einloggen.');
        }

        const reservationId = req.params.id;
        const userId = user.id;

        console.log(`LOG: Suche Reservierung ${reservationId} für User ${userId}`);

        // Abruf mit dem importierten reservationContainer
        const { resource: data } = await reservationContainer.item(reservationId, userId).read();

        if (!data) {
            console.error("LOG: Dokument in Cosmos DB nicht gefunden (ID oder PartitionKey falsch).");
            return res.status(404).send('Rechnung nicht gefunden.');
        }

        // Falls du testen willst, bevor das Auto offiziell ausgecheckt hat, 
        // kommentiere die nächste Zeile kurz aus:
        if (data.status !== 'completed') {
            return res.status(400).send('Rechnung erst nach Ausfahrt verfügbar (Status ist noch: ' + data.status + ')');
        }

        // PDF Generierung
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rechnung-${data.id.substring(0,8)}.pdf`);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);

        // Design
        doc.fillColor('#238636').fontSize(25).text('SMART PARKING', 50, 50);
        doc.fillColor('#000000').fontSize(12).text('Rechnung', 50, 85);
        
        doc.moveDown(2);
        doc.fontSize(10).text(`Rechnungs-ID: ${data.id}`);
        doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`);
        doc.text(`Fahrzeug-Kennzeichen: ${data.vehicleLicense || 'Unbekannt'}`);

        doc.moveDown();
        doc.rect(50, doc.y, 500, 1).fill('#cccccc');
        doc.moveDown();

        // Zeitberechnung
        // Zeitumwandlung in Berliner Zeit für die Anzeige
const entry = data.entryTime ? new Date(data.entryTime) : new Date(data.startTime);
const exit = data.exitTime ? new Date(data.exitTime) : new Date();

const options = { 
    timeZone: 'Europe/Berlin', 
    day: '2-digit', month: '2-digit', year: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
};

doc.fontSize(12).fillColor('#000000');
doc.text(`Einfahrt: ${entry.toLocaleString('de-DE', options)} Uhr`);
doc.text(`Ausfahrt: ${exit.toLocaleString('de-DE', options)} Uhr`);
        
        doc.moveDown();
        const total = data.totalPrice || 0;
        doc.fontSize(16).fillColor('#238636').text(`Gesamtbetrag: ${total.toFixed(2)} €`, { align: 'right' });

        doc.end();

    } catch (error) {
        console.error('LOG PDF FEHLER:', error);
        res.status(500).send('Interner Fehler: ' + error.message);
    }
});

module.exports = router;
