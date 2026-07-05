# Seriality 📺

Il sostituto personale di TV Time: tracker di serie e film **senza account e senza cloud** —
tutti i dati vivono nel tuo browser (IndexedDB) e si salvano/ripristinano con un click.

## Avvio

```bash
npm install
npm run dev        # http://localhost:5199
```

## Importare i dati da TV Time

Pagina **Importa** → trascina il file. Formati riconosciuti automaticamente:

| Formato | Cosa contiene |
|---|---|
| Zip export GDPR (2026, solo JSON) | serie, episodi visti, film, watchlist |
| `tracking-prod-records.csv` / `-v2.csv` (2023-25) | serie/episodi/film |
| CSV legacy (`seen_episode.csv`, `followed_tv_show.csv`, …) | storico vecchio formato |
| JSON dell'API live (tvtime-mcp / script sotto) | tutto, con poster inclusi |
| **Zip export Trakt / CineTrak** (`trakt-export-*.zip`) | film, serie, cronologia episodi, voti, watchlist (i file hidden/comments/notes vengono saltati) |
| CSV film generici (CineTrak CSV, Letterboxd, IMDb) | titolo + id tmdb/imdb + data + voto |
| Backup Seriality (`seriality-backup-*.json`) | ripristino completo |

I doppioni tra sorgenti diverse (stesso film su TV Time e Trakt) vengono fusi
automaticamente tramite id IMDb/TMDB/TVDB o nome.

### Export immediato via API (consigliato finché TV Time è online)

```bash
pip install requests   # se serve
python3 tools/export_from_api.py
```

Riusa il token del progetto `tvtime-mcp` (token.txt) e genera `seriality-export.json`
con **tutto** lo storico, poster inclusi. Poi caricalo nella pagina Importa.

## Funzionalità

- **Da guardare**: il prossimo episodio di ogni serie in corso, spunta rapida ✓
- **In arrivo**: calendario dei prossimi episodi (90 giorni)
- **Le mie serie**: libreria con filtri In corso / In pari / Finite / Da iniziare / Abbandonate / Preferite
- **Dettaglio serie**: stagioni, episodi, visto/non visto, vota, preferita, abbandona
- **Film**: watchlist e visti, voti, preferiti
- **Statistiche**: tempo totale, episodi/anno, generi, serie più guardate
- **Scopri**: cerca e segui nuove serie (TVmaze, gratis, senza chiave API)
- **Backup**: esporta/importa tutto come JSON

I metadata (poster, episodi, date) arrivano da [TVmaze](https://www.tvmaze.com/api),
agganciati agli stessi id TVDB che usava TV Time — per questo l'import è compatibile al 100%.

## Note tecniche

- Vite + React + TypeScript, Dexie (IndexedDB), JSZip, PapaParse
- Gli import `seen_episode.csv` legacy non contengono stagione/numero: le visioni vengono
  assegnate in ordine di messa in onda dopo il download della lista episodi (approssimazione
  identica a quella dei tool di migrazione verso Trakt).
