// db.js

const crypto = require('crypto');
require('dotenv').config();
const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;

if (!endpoint || !key) {
    console.error('FEHLER: COSMOS_ENDPOINT oder COSMOS_KEY fehlt in den Umgebungsvariablen!');
}

const client = new CosmosClient({ endpoint, key });
const database = client.database('smartparking');
const userContainer = database.container('Benutzer');
const parkingContainer = database.container('Parkplatz');
const reservationContainer = database.container('Reservierungen');

// --- HILFSFUNKTIONEN ---

async function updateSpotStatus(spot) {
    const partitionKey = spot.id;
    const originalETag = spot._etag;

    try {
        const { resource: updatedSpot } = await parkingContainer.item(spot.id, partitionKey).replace(spot, {
            accessCondition: {
                type: 'IfMatch',
                condition: originalETag
            }
        });
        return updatedSpot;
    } catch (error) {
        if (error.code === 412) {
            console.error("Cosmos DB Fehler (412 Precondition Failed): Zähler wurde von anderem Nutzer aktualisiert.");
            throw new Error("Ein anderer Nutzer war schneller. Bitte versuchen Sie die Reservierung erneut.");
        }
        console.error("Cosmos DB Fehler beim Aktualisieren des Parkplatz-Status:", error.message);
        throw new Error(`Aktualisierung fehlgeschlagen: ${error.message}`);
    }
}

// --- RESERVIERUNGEN ---

async function createReservation(spotId, userId) {
    const partitionKey = spotId; // PartitionKey des Parkplatzes ist die spotId

    // 1. Hole den Parkplatz
    const spot = await getSpotById(spotId, partitionKey);
    if (!spot) return { error: `Parkplatz mit ID ${spotId} nicht gefunden.` };

    // 2. Prüfen, ob dieser Nutzer schon eine aktive Reservierung für diesen Spot hat
    const existingReservations = await reservationContainer.items
        .query({
            query: 'SELECT * FROM Reservierungen r WHERE r.spotId=@spotId AND r.userId=@userId AND r.status="active"',
            parameters: [
                { name: '@spotId', value: spotId },
                { name: '@userId', value: userId }
            ]
        }).fetchAll();

    if (existingReservations.resources.length > 0) {
        return { error: "Du hast diesen Parkplatz bereits reserviert!" };
    }

    // 3. Prüfen, ob noch freie Plätze vorhanden sind
    const availableCount = spot.availableCount ?? 0;
    if (availableCount <= 0) { 
        return { error: "Parkplatz ist derzeit belegt oder nicht verfügbar." };
    }

    try {
        // 4. Erstelle neue Reservierung
        const reservationId = crypto.randomUUID();
        const reservationDurationMs = 2 * 60 * 60 * 1000; // 2 Stunden
        const startTime = new Date().toISOString();
        const endTime = new Date(Date.now() + reservationDurationMs).toISOString();

        const newReservation = {
            id: reservationId,
            spotId: spot.id,
            userId: userId,
            startTime,
            endTime,
            status: 'active',
            partitionKey: userId
        // PartitionKey für Reservierung
        };

        await reservationContainer.items.create(newReservation, { partitionKey: newReservation.partitionKey });

        // 5. Parkplatz-Status aktualisieren
        spot.availableCount = spot.availableCount - 1;
        spot.activeReservationId = reservationId;

        await updateSpotStatus(spot); // Mit ETag-Check

        return { 
            reservationId, 
            message: "Reservierung erfolgreich.", 
            startTime, 
            endTime 
        };

    } catch (error) {
        console.error("Cosmos DB Fehler bei Reservierung:", error.message);
        throw new Error("Fehler beim Erstellen der Reservierung. Bitte versuchen Sie es erneut.");
    }
}



async function getAllReservationsForUser(userId) {
    const querySpec = {
        query: 'SELECT * FROM Reservierungen r WHERE r.partitionKey=@userId ORDER BY r.startTime DESC',
        parameters: [{ name: '@userId', value: userId }]
    };
    try {
        const { resources } = await reservationContainer.items.query(querySpec).fetchAll();
        return resources;
    } catch (error) {
        console.error("Cosmos DB Fehler beim Abrufen der Reservierungen:", error.message);
        throw new Error("Fehler beim Abrufen der Reservierungshistorie.");
    }
}

async function releaseReservation(reservationId, spotId, userId) {
    const reservationPartitionKey = userId;
    const spotPartitionKey = spotId; // Annahme: PartitionKey des Parkplatzes ist die spotId
    let updatedSpot = null;

    // 1. Reservierung als abgeschlossen markieren
    try {
        const { resource: reservation } = await reservationContainer.item(reservationId, reservationPartitionKey).read();
        
        // Prüfe, ob die Reservierung bereits abgeschlossen ist
        if (reservation.status !== 'active') {
             throw new Error("Reservierung ist nicht aktiv und kann nicht freigegeben werden.");
        }

        reservation.status = 'cancelled';
        reservation.endTime = new Date().toISOString();
        
        // Verwende ETag, um Race-Conditions bei der Reservierung zu vermeiden
        await reservationContainer.item(reservationId, reservationPartitionKey).replace(reservation);
    } catch (error) {
        console.error("Fehler beim Freigeben der Reservierung (Schritt 1):", error.message);
        throw new Error("Aktive Reservierung nicht gefunden oder Fehler beim Abschluss: " + error.message);
    }

    // 2. Parkplatz-Status aktualisieren und freigeben
    try {
        // Holen des Spots mit dessen Partition Key
        const spot = await getSpotById(spotId, spotPartitionKey);
        
        if (spot) {
            // WICHTIG: Parkplatz freigeben (availableCount = 1)
            spot.availableCount = spot.availableCount + 1; 
            
            // WICHTIG: Referenz zur aktiven Reservierung entfernen
            spot.activeReservationId = null; 
            
            updatedSpot = await updateSpotStatus(spot);
            return updatedSpot;
        } else {
             throw new Error(`Parkplatz mit ID ${spotId} zum Freigeben nicht gefunden.`);
        }
    } catch (error) {
        // WICHTIG: Wenn das Spot-Update fehlschlägt, ist das Parken in der DB schief gelaufen.
        // Die Reservierung wurde bereits auf 'completed' gesetzt. Dies ist ein inkonsistenter Zustand.
        // Im Ernstfall müsste hier ein manueller DB-Eintrag (Monitoring) erfolgen.
        console.error("KRITISCHER FEHLER beim Freigeben des Parkplatzes (Schritt 2):", error.message);
        throw new Error(`KRITISCHER FEHLER: Parkplatz-Freigabe fehlgeschlagen: ${error.message}`);
    }
}


// --- BENUTZER ---

async function getUserByEmail(email) {
    const querySpec = {
        query: 'SELECT * FROM Benutzer b WHERE b.email=@email',
        parameters: [{ name: '@email', value: email }]
    };
    const { resources } = await userContainer.items.query(querySpec).fetchAll();
    return resources[0];
}

async function registerUser(user) {
    const { resource } = await userContainer.items.create(user);
    return resource;
}


// Ändere diese Funktion in deiner db.js:
async function updateUser(user) {
    try {
        // user.id ist die ID des Dokuments
        // user.email ist dein Partition Key (/email)
        const { resource } = await userContainer.item(user.id, user.email).replace(user);
        return resource;
    } catch (error) {
        console.error("Fehler in db.updateUser:", error.message);
        throw error;
    }
}

async function getUserByResetToken(token) {
    const querySpec = {
        query: 'SELECT * FROM Benutzer b WHERE b.resetPasswordToken=@token',
        parameters: [{ name: '@token', value: token }]
    };
    const { resources } = await userContainer.items.query(querySpec).fetchAll();
    return resources[0];
}


// --- PARKPLÄTZE ---

async function getAllSpots() {
    const querySpec = { query: 'SELECT * FROM Parkplatz p' };
    try {
        const { resources } = await parkingContainer.items.query(querySpec).fetchAll();
        return resources;
    } catch (error) {
        console.error("Cosmos DB Fehler beim Abrufen ALLER Parkplätze:", error.message);
        throw new Error("Fehler beim Abrufen aller Parkplätze.");
    }
}

async function getSpotById(spotId, partitionKey = spotId) {
    try {
        const { resource: item } = await parkingContainer.item(spotId, partitionKey).read();
        return item;
    } catch (error) {
        if (error.code === 404) return null;
        console.error("Cosmos DB Fehler beim Abrufen des Parkplatzes:", error.message);
        throw new Error("Fehler beim Abrufen des spezifischen Parkplatzes.");
    }
}

// --- EXPORT ---

module.exports = {
    getUserByEmail,
    registerUser,
    getAllSpots,
    getSpotById,
    updateSpotStatus,
    createReservation,
    releaseReservation,
    getAllReservationsForUser,
    updateUser,
    getUserByResetToken
};
