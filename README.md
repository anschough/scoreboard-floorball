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

- Scoreboard med klocka, period, poäng och lagloggor
- Lineup för hemma- och bortalag (inkl. ledare)
- Live serietabell
- Kommande matcher / spelprogram
- Kommentatorer
- Periodpaus-grafik
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
| API-dokumentation | http://localhost:3000/api-docs.html | Översikt över alla endpoints |

## Teknik

- **Node.js** + **Express** (server)
- **Socket.IO** (realtidsuppdateringar)
- **Axios** + **Cheerio** (hämta data från innebandy.se)
- Vanlig HTML/CSS/JS i frontend (inget bygg-steg)

## Licens

Privat projekt för FBC Sollentuna.
