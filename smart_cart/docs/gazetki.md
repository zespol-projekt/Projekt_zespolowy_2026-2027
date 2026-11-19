# Gazetki: dane dla czytnika w aplikacji

Stan: 19–20 listopada 2026. Odpowiedź na propozycję kontraktu Filipa (`leaflets-contract.md`, 17.11.2026). Gazetki są oglądane **wewnątrz SMARTCART** jako obrazy stron (wymaganie z `Damian.MD`, pkt 14); nie przekierowujemy na strony sklepów.

## Dla Filipa: endpoint i odpowiedź

- Adres: `GET <EXPO_PUBLIC_SUPABASE_URL>/functions/v1/leaflets` — Edge Function `leaflets` we wspólnym projekcie Supabase. Ustaw `EXPO_PUBLIC_LEAFLETS_API_URL` na ten adres (po wdrożeniu funkcji).
- Nagłówki jak w Twojej propozycji: `Accept: application/json`, `Authorization: Bearer <access token bieżącej sesji>`. Funkcja sprawdza sesję, potwierdzony email i to, że konto nie jest anonimowe. Klucz administracyjny nie jest potrzebny po stronie klienta.
- Odpowiedź 200 dokładnie w formacie `version: 1` z Twojej propozycji: `id`, `chain {id, name}`, `title`, `validFrom`, `validTo`, `format: "images"`, `cover`, `pages[] {url, width, height, mimeType}`. `chain.id` to slug sieci (`biedronka`, `lidl`, `dino`, …). `cover` to pierwsza strona.
- Strony są w kolejności czytania, JPEG/PNG/WebP (głównie WebP i JPEG, ok. 1150–1420 × 1800–2400 px, ok. 300 KB), każda do 8 MiB, bok do 8192 px, do 30 mln pikseli. Do 200 gazetek, odpowiedź do 1 MiB.
- Adresy obrazów są **podpisane i ważne 1 godzinę** (prywatny bucket Storage). Obraz nie potrzebuje nagłówków aplikacji; JWT, apikey i cookies nie są do niego wysyłane. Po wygaśnięciu podpisu Storage odpowiada 400/403 — wtedy klient ponownie pobiera listę (te same `id` i kolejność stron, nowe adresy).
- Błędy: `401 {"error":"unauthorized"}` (brak/zła sesja), `403 {"error":"email_not_confirmed"}`, `405` (inna metoda niż GET/OPTIONS), `503 {"error":"unavailable"}` (chwilowa niedostępność bazy/Storage). Treść błędu nie zawiera szczegółów serwera.
- CORS: `GET, OPTIONS`, nagłówki `authorization, accept, apikey, x-client-info, content-type`. Domyślnie `Access-Control-Allow-Origin: *` (bez cookies); można zawęzić sekretem `LEAFLETS_ALLOWED_ORIGINS` (lista originów po przecinku).
- `Cache-Control: no-store`.

### Polityka listy

- Lista zawiera gazetki **aktualne i przyszłe**: `validTo >= dzisiaj` według czasu polskiego. Wygasłe nie są zwracane, a z bazy i Storage są usuwane dzień po dacie końca.
- Gazetka pojawia się dopiero, gdy wszystkie jej strony są wgrane. Gazetka bez kompletu podpisanych stron jest pomijana.
- Gazetki alkoholowe nie są publikowane, a w gazetkach Dino strony oznaczone przez sieć jako alkoholowe są pomijane.
- **Biedronka podaje tylko datę początku** (w tytule, np. „oferta od 19.11”). Koniec jest przyjęty: dzień przed początkiem następnej gazetki tej samej serii albo 6 dni. W bazie jest to oznaczone (`valid_to_estimated`). Propozycja: dodać do odpowiedzi opcjonalne pole `validToEstimated: true` — dodam je, jeśli Twój klient ignoruje nieznane pola albo je obsłuży.

### Odbiór

Po wdrożeniu migracji, funkcji i pierwszym wgraniu gazetek: sprawdzenie na WWW i w Expo Go (Android/iOS) — CORS, MIME, kolejność stron, rozmiary, wygasanie podpisu (po godzinie), 401/403, odświeżenie listy, brak tokenów w żądaniach obrazów.

## Źródła (sprawdzone 19.11.2026)

| Sieć | Skąd | Daty |
|---|---|---|
| Lidl | lista z `lidl.pl/c/nasze-gazetki`, dane z oficjalnego endpointu gazetek (`endpoints.leaflets.schwarz`), obrazy stron JPEG | od–do podane |
| Dino | dane strony `marketdino.pl/gazetki/lista/standard`, obrazy stron WebP | od–do podane |
| Biedronka | lista z `biedronka.pl/pl/gazetki`, obrazy stron z przeglądarki gazetek (`leaflet-api.prod.biedronka.cloud`) | tylko początek, koniec szacowany |
| Kaufland, Carrefour | strony pokazują automatom weryfikację antybotową — nie omijamy jej | dodawane ręcznie |

Domyślnie pobierane są główne gazetki spożywcze (filtry w `scripts/gazetki/zrodla.mjs`, stała `FILTRY`): bez alkoholu i bez katalogów nieżywnościowych (dom, zabawki, wyprzedaże). Odpowiedź źródła 403/429 przerywa daną sieć.

## Model danych (migracja `20261120000100_leaflets.sql`)

- `leaflets`: `id` (stabilne, `[a-z0-9][a-z0-9_-]{0,79}`), `store_id`, `title`, `valid_from`, `valid_to`, `valid_to_estimated`, `source_url`, `source_ref`, `checked_at`, `published`, `page_count`.
- `leaflet_pages`: `leaflet_id`, `page_no`, `storage_path` (ścieżka w buckecie, nie podpisany URL), `width`, `height`, `mime_type`, `bytes`, `sha256`.
- Bucket `leaflets` w Storage: prywatny, pliki do 8 MiB, tylko JPEG/PNG/WebP, bez polityk dla klientów.
- RLS: odczyt opublikowanych gazetek dla potwierdzonych kont, zapis tylko `service_role` (skrypt administratora).

## Administrator: pobieranie i wgrywanie

Skrypt: `scripts/gazetki/gazetki.mjs` (Node, uruchamiany na komputerze administratora). Archiwum lokalne gazetek trzymamy poza repozytorium, np. `C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_archiwum` — zostaje na zawsze, także po usunięciu gazetki z bazy.

Jednorazowo: plik `smart_cart\.env.admin.local` (jest w `.gitignore`, nie commitujemy go):

```
SUPABASE_URL=https://REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<klucz service_role / secret z panelu Supabase → Settings → API Keys>
```

Skrypt odrzuca klucz publiczny (anon). Klucza nie wpisujemy do żadnej zmiennej `EXPO_PUBLIC_*`.

```powershell
$arch = "C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_archiwum"
node scripts/gazetki/gazetki.mjs pobierz --archiwum $arch                    # Biedronka, Lidl, Dino -> archiwum
node scripts/gazetki/gazetki.mjs pobierz --archiwum $arch --sieci lidl       # tylko wybrane sieci
node scripts/gazetki/gazetki.mjs lista   --archiwum $arch                    # co jest w archiwum
node scripts/gazetki/gazetki.mjs wgraj   --archiwum $arch --proba            # co zostałoby wgrane (bez łączenia z bazą)
node scripts/gazetki/gazetki.mjs wgraj   --archiwum $arch                    # wgranie aktualnych i przyszłych do Storage + publikacja
node scripts/gazetki/gazetki.mjs sprzataj --proba                            # które wygasłe zostałyby usunięte
node scripts/gazetki/gazetki.mjs sprzataj                                    # usunięcie z bazy i Storage dzień po końcu
```

Kaufland i Carrefour (ręcznie): otwórz gazetkę w swojej przeglądarce, zapisz PDF albo obrazy stron, potem:

```powershell
node scripts/gazetki/gazetki.mjs reczna --archiwum $arch --siec kaufland --tytul "Gazetka tygodniowa" --od 2026-11-20 --do 2026-11-26 --zrodlo https://www.kaufland.pl/... --pdf C:\Users\good1\Downloads\gazetka.pdf
node scripts/gazetki/gazetki.mjs reczna --archiwum $arch --siec carrefour --tytul "Gazetka" --od 2026-11-18 --do 2026-11-24 --zrodlo https://www.carrefour.pl/... --obrazy C:\folder\ze\stronami
```

PDF wymaga jednorazowo `npm.cmd install --no-save pdf-to-img`. Obrazy z folderu są brane w kolejności numerów w nazwach plików.

Rytm: po wyjściu nowych gazetek (zwykle poniedziałek i czwartek) `pobierz` → `wgraj` → `sprzataj`.

## Wdrożenie (jednorazowo)

```powershell
npx.cmd supabase@3.1.0 db push --remote --dry-run      # powinno pokazać tylko 20261120000100_leaflets.sql
npx.cmd supabase@3.1.0 db push --remote
npx.cmd supabase@3.1.0 functions deploy leaflets        # przy problemie z Dockerem: dodaj --use-api
```

Kod funkcji: `supabase/functions/leaflets/` (`index.ts` — Deno; `odpowiedz.ts` — logika odpowiedzi testowana w Node). Testy: `tests/gazetki.test.mjs`, `tests/database-leaflets.sql`.
