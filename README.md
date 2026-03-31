🅿️ SmartParking App
Eine moderne, Full-Stack Web-Anwendung zur effizienten Verwaltung, Suche und Reservierung von Parkplätzen in Echtzeit. Schluss mit der ewigen Parkplatzsuche – finden, klicken, parken!

🌟 Features
Interaktive Kartenansicht: Visualisierung aller Parkplatz-Standorte via Leaflet.js und OpenStreetMap.

Echtzeit-Verfügbarkeit: Dynamische Anzeige von freien Plätzen direkt aus der Datenbank.

Detaillierte Listenansicht: Schicke Parkplatz-Karten mit Bildern, Beschreibungen und Preisen.

Reservierungssystem: Registrierte Nutzer können Parkplätze mit nur einem Klick sofort reservieren.

Responsive Design: Optimiert für Desktop und mobile Endgeräte dank Tailwind CSS.

Sicheres Backend: Robuste Architektur mit Node.js und Express.

🛠 Tech Stack
Frontend:

EJS: Embedded JavaScript Templates für dynamisches HTML.

Tailwind CSS: Modernes Utility-First CSS-Framework für das Styling.

Leaflet.js: Interaktive Karten-Integration.

Backend:

Node.js & Express: Server-Umgebung und Routing.

Azure Cosmos DB: Hochskalierbare NoSQL-Datenbank für Parkplatz- und Nutzerdaten.

Express-Session: Handhabung von Benutzer-Logins.

🚀 Installation & Setup
Befolgen Sie diese Schritte, um das Projekt lokal auszuführen:

1. Repository klonen
Bash
git clone https://github.com/DEIN-BENUTZERNAME/smart-parking-app.git
cd smart-parking-app
2. Abhängigkeiten installieren
Bash
npm install
3. Umgebungsvariablen konfigurieren
Erstelle eine .env Datei im Hauptverzeichnis und füge deine Azure Cosmos DB Zugangsdaten hinzu:

Code-Snippet
PORT=3000
COSMOS_ENDPOINT=https://dein-account.documents.azure.com:443/
COSMOS_KEY=dein-geheimer-key==
COSMOS_DATABASE=smartparking
COSMOS_CONTAINER_PARKING=Parkplatz
COSMOS_CONTAINER_USERS=Users
SESSION_SECRET=ein-sehr-sicheres-geheimnis
4. App starten
Bash
# Für die Entwicklung (mit automatischem Neustart)
npm run dev

# Normaler Start
npm start
Die App ist nun unter http://localhost:3000 erreichbar.

📊 Datenbank-Struktur (Cosmos DB)
Ein typisches Parkplatz-Dokument sieht wie folgt aus:

JSON
{
    "id": "spot_01",
    "name": "City Tower Tiefgarage",
    "location": "Berliner Straße 74, Offenbach",
    "lat": 50.106,
    "lon": 8.763,
    "totalCount": 150,
    "availableCount": 42,
    "pricePerHour": 2.50,
    "isAvailable": true,
    "imageUrl": "/images/parking1.jpg",
    "shortDescription": "Zentrale Tiefgarage mit Videoüberwachung und E-Ladestationen."
}
🛣 Roadmap / Kommende Features
[ ] Integration von OSRM für echtes Routing zum Parkplatz.

[ ] Filter-Optionen (Preis, Entfernung, E-Ladestation).

[ ] Bezahlfunktion via Stripe API.

[ ] Dark Mode Unterstützung.

🤝 Mitwirken
Beiträge sind herzlich willkommen!

Forke das Projekt.

Erstelle deinen Feature-Branch (git checkout -b feature/NeuesFeature).

Committe deine Änderungen (git commit -m 'Add some NeuesFeature').

Pushe den Branch (git push origin feature/NeuesFeature).

Öffne einen Pull Request.

📄 Lizenz
Verteilt unter der MIT-Lizenz. Siehe LICENSE für weitere Informationen.
