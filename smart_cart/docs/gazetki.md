# Gazetki: dane dla czytnika w aplikacji

Stan: 20 listopada 2026 (pierwsze gazetki wgrane i opublikowane). Odpowiedź na propozycję kontraktu Filipa (`leaflets-contract.md`, 17.11.2026). Gazetki są oglądane **wewnątrz SMARTCART** jako obrazy stron (wymaganie z `Damian.MD`, pkt 14); nie przekierowujemy na strony sklepów.

## Dla Filipa: endpoint i odpowiedź

- Adres: `GET <EXPO_PUBLIC_SUPABASE_URL>/functions/v1/leaflets` — Edge Function `leaflets` we wspólnym projekcie Supabase. Ustaw `EXPO_PUBLIC_LEAFLETS_API_URL` na ten adres (po wdrożeniu funkcji).
- Nagłówki jak w Twojej propozycji: `Accept: application/json`, `Authorization: Bearer <access token bieżącej sesji>`. Funkcja sprawdza sesję, potwierdzony email i to, że konto nie jest anonimowe. Klucz administracyjny nie jest potrzebny po stronie klienta.
- Odpowiedź 200 dokładnie w formacie `version: 1` z Twojej propozycji: `id`, `chain {id, name}`, `title`, `validFrom`, `validTo`, `format: "images"`, `cover`, `pages[] {url, width, height, mimeType}`. `chain.id` to slug sieci (`biedronka`, `lidl`, `dino`, …). `cover` to pierwsza strona.
- Strony są w kolejności czytania, WebP albo JPEG (stan 20.11.2026: Lidl 710×1200, Biedronka 1146×1800, Kaufland i Carrefour ok. 1200×1750–1950, Dino ok. 1750×2500; zwykle 100–700 KB), każda do 8 MiB, bok do 8192 px, do 30 mln pikseli. `width` i `height` w odpowiedzi to prawdziwe wymiary pliku. Do 200 gazetek, odpowiedź do 1 MiB.
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

Skrypt: `scripts/gazetki/gazetki.mjs` (Node, uruchamiany na komputerze administratora). Dwa foldery poza repozytorium:

| Folder | Co w nim jest |
|---|---|
| `Dane_sklepy_current\gazetki_pobrane` | gazetki do sprawdzenia: foldery pobrane przez skrypt (Biedronka, Lidl, Dino) i PDF-y pobrane ręcznie (Kaufland, Carrefour) |
| `Dane_sklepy_current\gazetki_archiwum` | gazetki przetworzone (strony jako obrazy + `meta.json`); zostają na zawsze, także po usunięciu z bazy |

Jednorazowo: plik `smart_cart\.env.admin.local` (jest w `.gitignore`, nie commitujemy go):

```
SUPABASE_URL=https://REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<klucz service_role / secret z panelu Supabase → Settings → API Keys>
```

Skrypt odrzuca klucz publiczny (anon). Klucza nie wpisujemy do żadnej zmiennej `EXPO_PUBLIC_*`. Do PDF-ów jednorazowo (i po każdym `npm.cmd ci`): `npm.cmd install --no-save pdf-to-img @napi-rs/canvas`.

### Wzór nazwy

Każda gazetka w `gazetki_pobrane` (plik PDF albo folder z obrazami stron) ma nazwę:

```
<sieć>_<od RRRR-MM-DD>_<do RRRR-MM-DD>_<tytuł>
```

Przykłady: `kaufland_2026-11-19_2026-11-25_gazetka-tygodnia.pdf`, `carrefour_2026-11-16_2026-11-21_gazetka.pdf`, folder `lidl_2026-11-19_2026-11-21_gazetka-19-11`. Sieć: `biedronka`, `lidl`, `kaufland`, `carrefour`, `dino`. Tytuł jest opcjonalny (bez niego „Gazetka”). Mogą być podfoldery sieci (`kaufland\`, `carrefour\`, …).

### Krok po kroku

```powershell
$pob  = "C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_pobrane"
$arch = "C:\Users\good1\Desktop\Dane_sklepy_current\gazetki_archiwum"

# 1. Biedronka, Lidl, Dino -> gazetki_pobrane\<sieć>\<sieć>_<od>_<do>_<tytuł>\001.webp ... + zrodlo.json
node scripts/gazetki/gazetki.mjs pobierz --folder $pob --archiwum $arch

# 2. Ręcznie: PDF Kauflanda i Carrefoura do gazetki_pobrane, nazwa według wzoru (daty: Kaufland w nazwie pobranego pliku,
#    Carrefour na pierwszej stronie). Sprawdzenie dat Biedronki (patrz niżej) i ewentualna zmiana nazwy folderu.

# 3. Wszystko z gazetki_pobrane -> archiwum (PDF zamieniany na obrazy WebP do 1240 px)
node scripts/gazetki/gazetki.mjs dodaj-pobrane --archiwum $arch --folder $pob

# 4. Do bazy i Storage (aktualne i przyszłe), potem usunięcie wygasłych
node scripts/gazetki/gazetki.mjs wgraj --archiwum $arch --proba
node scripts/gazetki/gazetki.mjs wgraj --archiwum $arch
node scripts/gazetki/gazetki.mjs sprzataj
```

- `pobierz` nie pobiera drugi raz gazetki już pobranej (także po zmianie nazwy folderu) ani już będącej w archiwum. Pomija gazetki alkoholowe i katalogi nieżywnościowe. Odpowiedź 403/429 przerywa daną sieć (blokad nie omijamy).
- **Daty:** Lidl i Dino podają okres ważności — nazwa folderu jest od razu poprawna. **Biedronka podaje tylko początek**; koniec jest szacowany i skrypt wypisuje przy takiej gazetce „KONIEC SZACOWANY”. Jeśli w gazetce jest inna data końca, popraw ją w nazwie folderu **przed** `dodaj-pobrane`. Gazetka z niezmienioną szacowaną datą jest w bazie oznaczona jako szacowana.
- `dodaj-pobrane` bierze sieć i daty z nazwy, a dla folderów z `pobierz` dokładny tytuł i adres źródła z `zrodlo.json`. Pliki o nazwie niezgodnej ze wzorem pomija z powodem (np. oryginalna nazwa pliku z Kauflanda). Gazetek już w archiwum nie dodaje drugi raz, więc folder można trzymać w całości albo czyścić po dodaniu. Datę zmieniamy przed dodaniem — zmiana daty „od” po dodaniu utworzy nową gazetkę.
- Wygasła gazetka trafia tylko do archiwum.

Usunięcie wskazanej gazetki z bazy i Storage (np. duplikatu albo błędnie dodanej; archiwum lokalne zostaje): `usun --id <id>[,<id>...]`, najpierw z `--proba`. Identyfikatory widać w wyniku `wgraj` albo w tabeli `leaflets`.

Pojedynczo, bez zmiany nazwy pliku, działa też `reczna` (`--siec`, `--tytul`, `--od`, `--do`, `--pdf` albo `--obrazy`, opcjonalnie `--zrodlo`). Przegląd archiwum: `lista --archiwum $arch`.

Rytm: po wyjściu nowych gazetek (zwykle poniedziałek i czwartek) kroki 1–4.

## Wdrożenie (jednorazowo)

```powershell
npx.cmd supabase@3.1.0 db push --remote --dry-run      # powinno pokazać tylko 20261120000100_leaflets.sql
npx.cmd supabase@3.1.0 db push --remote
npx.cmd supabase@3.1.0 functions deploy leaflets        # przy problemie z Dockerem: dodaj --use-api
```

Kod funkcji: `supabase/functions/leaflets/` (`index.ts` — Deno; `odpowiedz.ts` — logika odpowiedzi testowana w Node). Testy: `tests/gazetki.test.mjs`, `tests/database-leaflets.sql`.
