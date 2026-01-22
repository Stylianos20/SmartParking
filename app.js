const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const expressLayouts = require('express-ejs-layouts');
var session = require('express-session');

// Router importieren
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const parkingRouter = require('./routes/parking');
const reservationRouter = require('./routes/reservation'); 
const malsehenRouter = require('./routes/malsehen');

const app = express();

// --- View Engine Setup ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'base'); // Standardlayout

// --- Middleware ---
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


// === SESSION MIDDLEWARE ===
app.use(session({
    secret: process.env.SESSION_SECRET || 'EinSehrSicheresGeheimnis',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
}));

// === MIDDLEWARE ZUR BEREITSTELLUNG VON isLOGGEDIN, user und TITLE FÜR EJS ===
app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.userId;
    res.locals.user = req.session.user || null;
    res.locals.title = 'Willkommen';
    next();
});

// --- Routes ---
app.use('/', indexRouter);
app.use('/users', usersRouter);

// 1. Parking Router für Hauptseite und allgemeine APIs
app.use('/parking', parkingRouter); 

// 2. Reservation Router für API-Aktionen (POST /api/reserve, POST /api/release)
app.use('/parking/api', reservationRouter); 

// 3. Reservation Router für die Historien-Ansicht (GET /reservations/history)
app.use('/reservations', reservationRouter); 

app.use('/malsehen', malsehenRouter);

app.use('/api/bills', billsRouter);


// --- 404 Handler ---
app.use((req, res, next) => next(createError(404)));

// --- Error Handler ---
app.use((err, req, res, next) => {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
    res.status(err.status || 500);
    res.render('error');
});


module.exports = app;