# Madplan

Mobil-først madplans-PWA til ugeplan, retter med makroer, indkøb, stregkodescan (Open Food Facts) og AI-label (OpenAI).

## Stack

- `api` — .NET 10 + EF Core + Postgres
- `web` — Vite + React + PWA (nginx proxy `/api` → api)
- Docker Compose (Dokploy-klar)

## Hosting

- **Prod/Dev URL:** https://mad.mags.dk  
- Traefik-labels på `web` i [`docker-compose.yml`](docker-compose.yml) (`Host(\`mad.mags.dk\`)`, `entrypoints=web`)

## Lokal udvikling

```bash
# Hele stacken
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Eller API + DB i Docker, frontend med Vite
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build db api
cd web && npm install && npm run dev
```

- Web (Docker): http://localhost:3000
- Web (Vite): http://localhost:5173
- API: http://localhost:8080/api/health

Sæt `OpenAI__ApiKey` i miljøet (eller `.env`) for label-scan.

## Funktioner (v1)

- Retter med ingredienser og makro-sum (total + pr. portion)
- Ugeplan (man–søn, måltidstyper)
- Indkøbsliste genereret fra ugeplan
- Stregkode → Open Food Facts
- Foto af indholdslabel → OpenAI Vision
- Ingen login / ingen holdbarhed endnu
