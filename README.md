# Scoreboard FBC Sollentuna

Live-grafiksystem för **FBC Sollentunas** floorball-sändningar.

> **OBS!** Detta projekt är skräddarsytt för FBC Sollentuna – färger, logotyp, typsnitt och datakällor är anpassade efter klubben. Det är **inte** en generell scoreboard och fungerar inte som ett färdigt verktyg för andra lag utan ombyggnad.

---

## Vad är det?

En webbserver med realtidsuppdateringar som driver en **grafik-overlay** för OBS och en **kontrollpanel** för operatören. Matchdata (lag, tabell, spelprogram, mål) hämtas automatiskt från **stats.innebandy.se** via IBIS-API:et när operatören klistrar in en match-URL.

## Funktioner

- **Scoreboard** med matchklocka, period, poäng och lagloggor
  - Klockan döljs automatiskt vid **Straffar** (period 5) och visas igen vid reset
- **Utvisningar** synkade med matchklockan (2 min, 2+2 min, 5 min – max 2 aktiva per lag)
- **Time-out** med 30 sekunders nedräkning, dockad under scoreboarden
- **Repris-overlay** – animerat "REPRIS"-pill som visas i OBS:s replay-källa
- **Live-ticker** för övriga pågående matcher – mål visas som popups i nedre hörnet under pågående sändning
- **Laguppställning** för hemma- och bortalag (spelare & ledare)
- **Live Serietabell** och **matchprogram** (omgångens matcher)
- **Matchup** information inför match med lagloggor, spelplats och matchstart
- **Statistik inför match** statistik om lagen inför matchen
- **Spelar- och ledarskylt** (lower-third) med valfri spelarfoto för intervjuer
- **Kommentatorskylt**
- **Pausvila**-skylt som visar att vi väntar på kommande period
- **Sponsorremsa** som rullar längst ner (upp till 15 logotyper, hanteras i inställningar)
- Allt uppdateras direkt via **WebSockets** – ingen sidomladdning krävs

## Inställningar

Inställningssidan (`settings.html`) hanterar:

- **Sponsorlogotyper** – ladda upp och sortera om (visas i sponsorremsan)
- **OBS-länk** – grafik- och repris-URL:en att klistra in som Browser Source i OBS
- **Periodlängd** – antal minuter per ordinarie period (standard 20 min)
- **Övertidslängd** – antal minuter per övertidsperiod (standard 5 min)

## Kom igång

Du behöver [Node.js 18+](https://nodejs.org) installerat.

```bash
# 1. Installera beroenden (görs en gång)
npm install

# 2. Starta servern
npm start
```

När servern är igång öppnar du:

| Sida | URL | Användning |
|------|-----|------------|
| Landningssida | http://localhost:3000/ | Välj verktyg (länk till kontrollpanel/inställningar) |
| Kontrollpanel | http://localhost:3000/control.html | Öppna i webbläsare under sändning |
| Mobil-kontrollpanel | http://localhost:3000/mobile-control.html | Förenklad vy för poäng/klocka/period på telefon |
| Grafik-overlay | http://localhost:3000/graphics.html | Lägg in som **Browser Source** i OBS |
| Repris-overlay | http://localhost:3000/replay.html | Lägg in som **Browser Source** i OBS (repris-källa) |
| Inställningar | http://localhost:3000/settings.html | Sponsorer, OBS-länkar, periodlängder |

Servern lyssnar på port **3000** som standard. Ändra med `PORT=4000 npm start` eller `HOST=127.0.0.1 npm start` för att bara lyssna lokalt.

## Inloggning & behörighet

Kontrollpanelen, mobil-kontrollpanelen och inställningarna är skyddade med ett **delat lösenord**. Visningssidorna (`graphics.html`, `replay.html`) och landningssidan är öppna eftersom OBS Browser Source inte kan logga in – de kan ändå bara *visa*, inte ändra.

Sätt lösenordet via miljövariabeln `APP_PASSWORD`. Enklast lokalt är att kopiera `.env.example` till `.env` och fylla i värdena – `.env` laddas automatiskt vid start (och är gitignorerad):

```bash
cp .env.example .env   # fyll sedan i APP_PASSWORD
npm start
```

Alternativt direkt på kommandoraden:

```bash
APP_PASSWORD="ditt-hemliga-lösenord" npm start
```

Första gången du öppnar en skyddad sida skickas du till `/login.html`. Efter inloggning sätts en signerad session-cookie som gäller i 30 dagar. Logga ut via "Logga ut"-knappen i sidhuvudet.

| Miljövariabel | Krävs | Beskrivning |
|---------------|-------|-------------|
| `APP_PASSWORD` | Ja (i produktion) | Delat lösenord. **Lämnas det tomt körs appen olåst** (bekvämt lokalt, men osäkert publikt). |
| `SESSION_SECRET` | Nej | Hemlighet som signerar cookies. Härleds från lösenordet om den inte sätts; sätt ett eget värde för full kontroll. |
| `API_KEY` | Nej | Tillåter Stream Deck/automation att anropa `/api/*` utan cookie. Skickas som `?key=…` eller header `X-API-Key`. |

> **Stream Deck:** lägg till `?key=DIN_API_KEY` på varje URL, t.ex. `http://din-server/api/score/home/add?key=DIN_API_KEY`.

## Driftsättning

Projektet inkluderar `render.yaml` för enklicksdeploy till [Render](https://render.com). Tjänsten kör på `node server.js`, exponerar `/healthz` för health check och sätts upp med `autoDeploy: true` mot `main`-branchen (region: Frankfurt).

**Viktigt:** sätt `APP_PASSWORD` i Render-tjänstens miljövariabler – annars är sidorna oskyddade. `SESSION_SECRET` genereras automatiskt och `API_KEY` är valfri.

## Teknik

- **Node.js 18+** + **Express** – server och REST-API
- **Socket.IO** – realtidsuppdateringar till alla anslutna klienter
- **Axios** – hämtar JSON från stats.innebandy.se (IBIS)
- Vanlig **HTML/CSS/JS** i frontend (inget bygg-steg)
- Delat **design token-system** (`css/tokens.css`) – palett, avstånd, typsnitt, border-width och border-radius definierade på ett ställe och ärvda av alla sidor
- Sponsorlogotyper sparas under `public/sponsors/` med metadata i `data/sponsors.json`

## Licens

Privat projekt för FBC Sollentuna.
