#!/bin/sh
# Blocca il deploy se manca una variabile che il sito non può recuperare da solo:
# la build finirebbe online silenziosamente monca (niente cast/streaming, o
# peggio, niente backup automatico) e te ne accorgeresti troppo tardi.
set -e

fail=0

need() {
  var=$1
  why=$2
  eval "val=\$$var"
  if [ -n "$val" ]; then return 0; fi
  if grep -qs "^$var=." .env.local; then return 0; fi
  echo "❌ $var mancante (né in ambiente né in .env.local) → $why"
  fail=1
}

need VITE_TMDB_KEY      "la build uscirebbe senza cast, streaming e simili"
need VITE_SUPABASE_URL  "il backup automatico cifrato resterebbe spento"
need VITE_SUPABASE_KEY  "il backup automatico cifrato resterebbe spento"

if [ "$fail" = 1 ]; then
  echo "Deploy annullato."
  exit 1
fi
