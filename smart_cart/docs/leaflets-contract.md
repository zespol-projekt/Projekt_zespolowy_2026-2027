# Gazetki — propozycja kontraktu dla Damiana

Stan: 17 listopada 2026. To **propozycja klienta do uzgodnienia**, nie opis istniejącego endpointu ani zakończonej integracji. Filip przygotował czytnik obrazów za zgodą użytkownika. W repozytorium nie ma rzeczywistej gazetki ani API gazetek. Damian pozostaje właścicielem danych, przygotowania stron, ich aktualizacji i magazynowania. Nie dodano tabel, RPC, importerów ani polityk Storage.

## Żądanie i dostęp

Klient czyta `EXPO_PUBLIC_LEAFLETS_API_URL`, bez domyślnego adresu produkcyjnego. Proponowany endpoint: Edge Function `GET /functions/v1/leaflets` we **wspólnym projekcie Supabase**, na tym samym origin co `EXPO_PUBLIC_SUPABASE_URL`. Nazwa i hosting wymagają potwierdzenia Damiana przed ustawieniem zmiennej. Ta propozycja nie tworzy funkcji.

Nagłówki: `Accept: application/json`, `Authorization: Bearer <bieżąca sesja użytkownika>`. Wspólny serwis Auth udostępnia token i obsługuje jednokrotne odświeżenie po 401. Backend musi sprawdzić sesję oraz potwierdzony email. Obsługa CORS musi dopuścić origin aplikacji, GET/OPTIONS i Authorization. Klient nie potrzebuje ani nie wysyła klucza administracyjnego. Metadata i pliki pobierane są bez cookies, automatycznych redirectów i trwałego cache.

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
    "cover": null,
    "pages": [
      { "url": "https://assets.example.invalid/strona-1.jpg", "width": 1200, "height": 1800, "mimeType": "image/jpeg" },
      { "url": "https://assets.example.invalid/strona-2.jpg", "width": 1200, "height": 1800, "mimeType": "image/jpeg" }
    ]
  }]
}
```

- `id` i `chain.id`: stabilne małe ASCII `[a-z0-9][a-z0-9_-]{0,79}`. ID gazetki jest unikalne i nie zmienia się przy odświeżeniu URL. Nazwy i tytuły: niepuste, do 200 znaków.
- Daty: rzeczywiste dni `YYYY-MM-DD`, początek nie późniejszy niż koniec. UI pokazuje dokładny okres, bez deklarowania, że każda pozycja z gazetki ma już cenę w katalogu.
- `pages`: 1–200 stron w **kolejności czytania**. Nie sortujemy URL leksykograficznie.
- `cover`: `null` lub taki sam opis obrazu jak strona. Klient waliduje metadane okładki; bieżąca lista prezentuje tytuł, sieć, daty i liczbę stron bez pobierania wszystkich okładek.
- Obrazy: PNG, JPEG lub WebP, zgodny `Content-Type` i faktyczne bajty. Do 8 MiB na stronę, boki do 8192 px, maksymalnie 30 mln pikseli. Zalecane mniejsze obrazy (np. 1200×1800), aby działały na słabszym telefonie.
- PDF i HTML nie są obsługiwane. PDF wymaga przygotowania stron przez właściciela danych lub nowego uzgodnienia integracji; klient nie wysyła dokumentów do usług konwersji.

## Zasoby obrazowe

Publiczne lub podpisane, czasowe URL HTTPS, bez danych logowania w URL. Plik nie może wymagać nagłówków Auth aplikacji. Obraz otrzymuje wyłącznie `Accept`; **JWT, apikey i cookies nie są przekazywane**. CORS musi pozwalać aplikacji odczytać bajty i Content-Type. Zalecany poprawny Content-Length; natywny fetch bez strumieni odczytuje odpowiedź przed sprawdzeniem jej końcowego rozmiaru, więc backend/CDN musi rzeczywiście respektować limit pliku. Nie wolno podmieniać adresu na HTML logowania ani przekierowywać do strony sklepu.

Wygasły podpis: 401/403. Usunięty plik: 404/410. Niedostępność: 5xx. Odświeżenie metadanych ma zwrócić świeże podpisane URL przy tych samych ID i kolejności stron. UI zachowuje numer strony i pozwala odświeżyć dostęp. Nie odczytuje ani nie pokazuje surowych odpowiedzi błędów serwera.

## Kryterium odbioru danych

Damian dostarcza URL uzgodnionego endpointu i co najmniej jedną rzeczywistą, legalnie udostępnioną gazetkę wielostronicową z datami i źródłem. Sprawdzamy WWW oraz docelowe Expo Go/Android/iOS: CORS, MIME, kolejność, rozmiary, wygasanie podpisów, 404/403, odświeżenie dostępu i brak tokenów w żądaniach obrazów. Odbiór urządzeń i rzeczywistego materiału pozostaje otwarty. Testy PNG w `tests/fixtures/leaflets` są syntetyczne i dostępne wyłącznie przez transport Playwright.
