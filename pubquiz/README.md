# Pub Quiz

Quiz maken en live spelen. De quizmaster toont de vragen op een groot scherm, teams antwoorden op hun telefoon.

## Starten

```bash
cd pubquiz
npm start          # http://localhost:3000
```

Node 18 of nieuwer, geen extra packages nodig. Poort aanpassen met `PORT=8080 npm start`.
Telefoons moeten op hetzelfde netwerk zitten; bij het starten toont de server het adres voor teams (bijv. `http://192.168.1.20:3000/play.html`). Dat adres staat ook op het beamerscherm.

## Gebruik

1. **Maken** – `/editor.html`: rondes en vragen toevoegen, opslaan, exporteren/importeren als JSON.
   - Meerkeuze (2–8 opties), automatisch nagekeken.
   - Open vraag: juiste antwoord plus alternatieven (gescheiden met `;`). Hoofdletters, accenten en leestekens tellen niet mee. De quizmaster kan elk antwoord alsnog goed of fout rekenen.
   - Schatvraag: het team (of de teams) dat het dichtst bij zit krijgt de punten.
   - Afbeelding per vraag: URL of upload (PNG, JPEG, GIF, WebP, max. 5 MB).
   - Punten en tijdslimiet per vraag (0 = geen limiet).
2. **Hosten** – op de startpagina een quiz kiezen en op *Start* klikken. Het quizmasterscherm toont de vraag plus een bedieningspaneel. Met *Beamerscherm openen* gaat er een los venster open voor de beamer.
3. **Meedoen** – teams gaan naar `/play.html`, vullen de 4-lettercode en een teamnaam in.

Verloop per vraag: ronde-intro → vraag open → antwoorden sluiten (handmatig of als de tijd om is) → beoordelen → antwoord tonen → na de laatste vraag van een ronde de tussenstand → eindstand met podium.
De quizmaster kan punten handmatig bijstellen (±1) en teams verwijderen.

## Opslag

- Quizzen: `data/quizzes/*.json`, uploads: `data/uploads/`. Andere map via `PUBQUIZ_DATA=/pad`.
- Lopende spellen staan alleen in het geheugen; een herstart van de server beëindigt ze.
- Bij een lege datamap wordt `sample-quiz.json` als voorbeeld geladen.

## Tests

```bash
npm test
```
