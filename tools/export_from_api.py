#!/usr/bin/env python3
"""
Esporta TUTTI i tuoi dati TV Time via API (finché i server rispondono) in un
unico `seriality-export.json` pronto da caricare in Seriality (pagina Importa).

Riusa il meccanismo del tuo tvtime-mcp: token JWT via proxy sidecar.
Il token viene cercato in:
  1. variabile d'ambiente TVTIME_JWT
  2. ../../tvtime-mcp/token.txt (accanto a questo progetto)
  3. token.txt in questa cartella

Uso:  python3 tools/export_from_api.py [output.json]
"""

import base64
import json
import sys
import time
from pathlib import Path

import requests

SIDECAR = "https://app.tvtime.com/sidecar"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Origin": "https://app.tvtime.com",
    "Referer": "https://app.tvtime.com/",
    "Accept": "application/json",
}


def read_token() -> str:
    import os
    token = os.environ.get("TVTIME_JWT", "").strip()
    if not token:
        for p in (
            Path(__file__).resolve().parent.parent.parent / "tvtime-mcp" / "token.txt",
            Path(__file__).with_name("token.txt"),
        ):
            if p.exists():
                token = p.read_text(encoding="utf-8").strip().strip('"')
                break
    if not token:
        sys.exit("Token mancante: metti il JWT in TVTIME_JWT o in tvtime-mcp/token.txt")
    return token


def user_id(token: str) -> str:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return str(json.loads(base64.urlsafe_b64decode(payload))["id"])


def sidecar_get(token: str, url: str, params: dict | None = None):
    o_b64 = base64.b64encode(url.encode()).decode().rstrip("=")
    q = {"o_b64": o_b64}
    if params:
        q.update(params)
    h = dict(HEADERS, Authorization="Bearer " + token)
    for attempt in range(4):
        try:
            r = requests.get(SIDECAR, params=q, headers=h, timeout=30)
            if r.status_code in (401, 403):
                sys.exit(f"Token scaduto/rifiutato (HTTP {r.status_code}): riprendine uno fresco dal browser.")
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and "data" in data and set(data) <= {"status", "data", "message"}:
                return data["data"]
            return data
        except requests.RequestException as e:
            if attempt == 3:
                raise
            print(f"  ⚠️ {e} — riprovo…")
            time.sleep(3)
    return None


def paged(token: str, url: str, params: dict, page_size: int = 500, max_pages: int = 200):
    """Itera un endpoint api2 con offset/limit finché restituisce risultati."""
    out = []
    for page in range(max_pages):
        p = dict(params, offset=page * page_size, limit=page_size)
        data = sidecar_get(token, url, p)
        items = data.get("result") if isinstance(data, dict) else data
        if not items:
            break
        out.extend(items)
        print(f"  … {len(out)} finora")
        if len(items) < page_size:
            break
        time.sleep(0.4)
    return out


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("seriality-export.json")
    token = read_token()
    uid = user_id(token)
    print(f"👤 utente TV Time: {uid}")

    export: dict = {"source": "tvtime-api", "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    print("📺 serie seguite…")
    export["followed_series"] = sidecar_get(
        token,
        f"https://msapi.tvtime.com/prod/v1/tracking/cgw/follows/user/{uid}",
        {"entity_type": "series", "filter": "only_followed_series"},
    )

    print("🍿 film…")
    export["movies"] = sidecar_get(
        token,
        f"https://msapi.tvtime.com/prod/v1/tracking/cgw/follows/user/{uid}",
        {"entity_type": "movie", "sort": "watched_date,desc"},
    )

    print("✅ episodi visti (può richiedere qualche minuto)…")
    export["watched_episodes"] = paged(
        token,
        f"https://api2.tozelabs.com/v2/user/{uid}/watched_episodes",
        {"include_country": 1},
    )

    print("🕐 coda da vedere…")
    export["to_watch"] = paged(
        token,
        f"https://api2.tozelabs.com/v2/user/{uid}/to_watch",
        {"include_country": 1},
        page_size=200,
    )

    out_path.write_text(json.dumps(export, ensure_ascii=False), encoding="utf-8")
    n_eps = len(export.get("watched_episodes") or [])
    n_movies = len((export.get("movies") or {}).get("objects", [])) if isinstance(export.get("movies"), dict) else 0
    print(f"\n💾 Salvato {out_path} — {n_eps} episodi visti, {n_movies} film.")
    print("Ora apri Seriality → Importa → carica questo file. 🎉")


if __name__ == "__main__":
    main()
