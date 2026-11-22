# Gazetki w SMARTCART

Czytnik wyświetla strony gazetek w aplikacji. Funkcja Edge `leaflets` we wspólnym projekcie Supabase udostępnia katalog i podpisane adresy obrazów. Za przygotowanie i publikację materiałów odpowiada Damian.

## Żądanie i dostęp

Ustaw `EXPO_PUBLIC_LEAFLETS_API_URL` w `.env.local` na adres `EXPO_PUBLIC_SUPABASE_URL` z dopisaną ścieżką `/functions/v1/leaflets`. Użyj tej samej wartości w środowisku budowania aplikacji. Klient wysyła żądanie GET i sprawdza zgodność originu z `EXPO_PUBLIC_SUPABASE_URL`.

Klient wysyła `Accept: application/json` i `Authorization: Bearer <bieżąca sesja użytkownika>`. Wspólny serwis Auth jednokrotnie odświeża sesję po 401. Funkcja wymaga zalogowanego konta z potwierdzonym adresem e-mail. Zwraca 403 dla niepotwierdzonego adresu i 503 przy chwilowej niedostępności danych. CORS dopuszcza GET, OPTIONS i nagłówek Authorization. Odpowiedź katalogu ma `Cache-Control: no-store`.

## Odpowiedź 200

`Content-Type: application/json`, UTF-8, maksymalnie 1 MiB, do 200 gazetek. Pusta lista oznacza brak materiałów. Przykład poniżej zawiera fikcyjne adresy dokumentujące kontrakt, nie dane aplikacji:

```json
{
  "version": 1,
  "leaflets": [{
    "id": "siec-2026-11-17",
    "chain": { "id": "siec", "name": "Nazwa sieci" },
    "title": "Oferta tygodnia",
    "validFrom": "2026-11-17",
    "validTo": "2026-11-23",
    "format": "images",
    "cover": { "url": "https://assets.example.invalid/strona-1.jpg", "width": 1200, "height": 1800, "mimeType": "image/jpeg" },
    "pages": [
      { "url": "https://assets.example.invalid/strona-1.jpg", "width": 1200, "height": 1800, "mimeType": "image/jpeg" },
      { "url": "https://assets.example.invalid/strona-2.jpg", "width": 1200, "height": 1800, "mimeType": "image/jpeg" }
    ]
  }]
}
```

- `id` i `chain.id`: stabilne małe ASCII `[a-z0-9][a-z0-9_-]{0,79}`. ID gazetki jest unikalne i nie zmienia się przy odświeżeniu URL. Nazwy i tytuły: niepuste, do 200 znaków.
- Daty mają format `YYYY-MM-DD`. Katalog zawiera opublikowane gazetki aktualne i przyszłe, których `validTo` przypada dziś lub później według czasu polskiego. Jeśli API zwróci opcjonalne `validToEstimated: true`, aplikacja oznaczy datę końcową jako szacowaną.
- `pages`: 1–200 stron w **kolejności czytania**. Nie sortujemy URL leksykograficznie.
- `cover` opisuje pierwszą stronę. Klient akceptuje też `null`. Lista pokazuje tytuł, sieć, daty i liczbę stron.
- Obrazy: PNG, JPEG lub WebP, zgodny `Content-Type` i faktyczne bajty. Do 8 MiB na stronę, boki do 8192 px, maksymalnie 30 mln pikseli. Zalecane mniejsze obrazy (np. 1200×1800), aby działały na słabszym telefonie.
- PDF i HTML nie są obsługiwane. PDF wymaga przygotowania stron przez właściciela danych lub nowego uzgodnienia integracji; klient nie wysyła dokumentów do usług konwersji.

## Zasoby obrazowe

Adresy HTTPS są podpisane na godzinę i prowadzą do prywatnego bucketa Storage. Klient pobiera obraz z nagłówkiem `Accept` oraz pomija JWT sesji, apikey i cookies. CORS musi pozwalać aplikacji odczytać bajty i Content-Type. Gdy natywny transport odczytuje całą odpowiedź naraz, limit pliku musi egzekwować również Storage.

Po odpowiedzi Storage 400 lub 403 czytnik jednokrotnie pobiera ponownie katalog i próbuje wczytać tę samą stronę pod nowym adresem. Odczyt zachowuje ID gazetki i numer strony. Przycisk „Odśwież dostęp do gazetki” umożliwia ponowienie ręczne. Usunięty plik może zwrócić 404 lub 410, a chwilowa niedostępność 5xx.

## Kryterium odbioru danych

Odbiór na WWW i w Expo Go (Android/iOS) obejmuje pobranie rzeczywistej gazetki na zalogowanym koncie, CORS katalogu i obrazów, MIME, kolejność i rozmiary stron, sesje 401/403, wygaśnięcie podpisu i odświeżenie katalogu. Testy Playwright używają syntetycznych obrazów z `tests/fixtures/leaflets`.
