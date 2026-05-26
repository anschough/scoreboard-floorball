# Scoreboard FBC Sollentuna

Live-grafiksystem för **FBC Sollentunas** floorball-sändningar.

> **OBS!** Detta projekt är skräddarsytt för FBC Sollentuna – färger, logotyp, typsnitt och datakällor är anpassade efter klubben. Det är **inte** en generell scoreboard och fungerar inte som ett färdigt verktyg för andra lag utan ombyggnad.

---

## Vad är det?

En webbserver som driver två sidor:

- **Kontrollpanel** – där operatören sköter matchen (poäng, klocka, lineup, tabell, kommentatorer m.m.)
- **Grafik-overlay** – läggs in i OBS som *Browser Source* och visas direkt i sändningen

Matchdata (lag, tabell, spelprogram) hämtas automatiskt från **stats.innebandy.se** när operatören klistrar in en match-URL.

## Funktioner

- **Scoreboard** med klocka, period, poäng och lagloggor
- **Utvisningar** synkade med matchklockan (2 min, 2+2 min, 5 min – max 2 aktiva per lag)
- **Time-out** med 30 sekunders nedräkning, dockad direkt under scoreboarden
- **Lineup** för hemma- och bortalag (inkl. ledare/tränare)
- **Live serietabell** och **kommande matcher**
- **Matchup** och **statistik inför match**
- **Spelar- och ledarskylt** (lower-third)
- **Kommentator-skylt**
- **Pausvila**
- **Sponsorremsa** som rullar längst ner under matchup/pausvila (upp till 15 logotyper, hanteras via settings-sidan)
- Allt uppdateras direkt via WebSockets

## Kom igång

Du behöver [Node.js](https://nodejs.org) installerat.

```bash
# 1. Installera beroenden (görs en gång)
npm install

# 2. Starta servern
npm start
```

När servern är igång öppnar du:

| Sida | URL | Användning |
|------|-----|------------|
| Kontrollpanel | http://localhost:3000/control.html | Öppna i webbläsare under sändning |
| Grafik-overlay | http://localhost:3000/graphics.html | Lägg in som **Browser Source** i OBS |
| Inställningar | http://localhost:3000/settings.html | Hantera sponsorlogotyper |
| API-dokumentation | http://localhost:3000/api-docs.html | Översikt över alla endpoints (för Stream Deck m.m.) |

Servern lyssnar på port 3000 som default. Kör med `PORT=4000 npm start` för att byta port, eller `HOST=127.0.0.1 npm start` för att bara lyssna lokalt.

## Teknik

- **Node.js 18+** + **Express** (server)
- **Socket.IO** (realtidsuppdateringar)
- **Axios** (hämtar JSON från stats.innebandy.se)
- Vanlig HTML/CSS/JS i frontend (inget bygg-steg)
- Sponsorlogotyper sparas under `public/sponsors/` med metadata i `data/sponsors.json`

## Licens

Privat projekt för FBC Sollentuna.
