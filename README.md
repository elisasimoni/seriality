# Seriality 📺

Il sostituto personale di TV Time: tracker di serie e film **senza account** —
tutti i dati vivono nel tuo browser (IndexedDB), con backup locale e (opzionale)
copia cifrata nel cloud che si aggiorna da sola.

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
- **Backup**: copia locale con promemoria settimanale + sync cifrato automatico (sotto)

I metadata (poster, episodi, date) arrivano da [TVmaze](https://www.tvmaze.com/api),
agganciati agli stessi id TVDB che usava TV Time — per questo l'import è compatibile al 100%.

## Backup

I dati stanno in IndexedDB: se cancelli i dati di navigazione (o se iOS li scarta
dopo 7 giorni di inattività, cosa che **non** succede alle app aggiunte alla schermata
Home) spariscono. Per questo il backup ha due gambe indipendenti.

**1. Copia locale.** Impostazioni → *Scarica backup completo*: un JSON che ricarichi
dalla pagina Importa. Un banner in cima alla pagina lo ricorda ogni 7 giorni
(`BACKUP_EVERY_DAYS` in [src/db.ts](src/db.ts)); "Più tardi" rimanda di un giorno.

**2. Sync cifrato automatico** ([src/cloud.ts](src/cloud.ts)). A ogni avvio (e poi ogni
15 minuti) l'app carica l'archivio su Supabase, ma **solo se qualcosa è cambiato**:
il confronto usa un'impronta fatta di conteggi e ultime attività, tutti campi indicizzati.

- L'archivio parte **già cifrato**: AES-GCM su gzip, chiave derivata dalla passphrase
  con PBKDF2. Anche l'id dello slot deriva dalla passphrase, con un sale diverso, così
  il server non sa di chi siano i dati. Passphrase persa = backup irrecuperabile.
- In chiaro restano solo i conteggi e la data, per elencare le versioni senza scaricarle.
- Vengono tenute le ultime **5 versioni** per slot.
- **Due protezioni contro l'auto-cancellazione**: il sync si rifiuta di partire se
  l'archivio locale è vuoto, o se ha meno della metà degli episodi visti presenti
  online. È lo scenario "ho perso i dati, riapro l'app e il vuoto sovrascrive il
  backup buono". Si scavalca solo a mano, da Impostazioni.

### Configurare il progetto Supabase

```bash
# 1. crea un progetto (dashboard Supabase), poi applica lo schema:
#    SQL Editor → incolla db/backup-schema.sql → Run
# 2. metti le credenziali in .env.local (mai committate):
echo 'VITE_SUPABASE_URL=https://<ref>.supabase.co' >> .env.local
echo 'VITE_SUPABASE_KEY=<anon/publishable key>' >> .env.local
```

La chiave anon finisce nel bundle pubblico ed è normale: la tabella sta in uno schema
non esposto, senza policy RLS, e si raggiunge solo tramite tre funzioni `security definer`
che accettano un id di slot e un blob opaco. Senza passphrase non c'è niente da leggere.

`npm run deploy` si blocca se una di queste variabili manca ([tools/check-env.sh](tools/check-env.sh)):
una build senza chiavi andrebbe online silenziosamente monca.

> I progetti Supabase gratuiti vanno in pausa dopo giorni di inattività. L'uso normale
> dell'app li tiene svegli; se capita, il sync fallisce in silenzio (i dati restano)
> finché non riattivi il progetto dalla dashboard. Motivo in più per tenere anche la copia locale.

## Note tecniche

- Vite + React + TypeScript, Dexie (IndexedDB), JSZip, PapaParse
- Gli import `seen_episode.csv` legacy non contengono stagione/numero: le visioni vengono
  assegnate in ordine di messa in onda dopo il download della lista episodi (approssimazione
  identica a quella dei tool di migrazione verso Trakt).
