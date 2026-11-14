# Chronione API sklepów — punkt 5

`GET` i `HEAD /v1/stores` wymagają nagłówka `Authorization: Bearer <access_token>`
z sesji potwierdzonego, nieanonimowego konta we wspólnym projekcie Supabase.
Publiczny klucz projektu nie zastępuje tokenu użytkownika.

## Uruchomienie

1. Zainstaluj zależności projektu i ustaw `.env.local` według `.env.example`.
   Serwer czyta `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY`, z fallbackiem do
   `EXPO_PUBLIC_SUPABASE_URL` i `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Klucz jest publiczny; `service_role`, hasło SMTP ani hasło użytkownika nie są potrzebne.
2. Uruchom `npm.cmd run server`, a w drugim terminalu `npm.cmd start`.
3. `http://localhost:8787/health` powinien zwrócić stan techniczny.
   `/v1/stores` otwarty bez tokenu powinien zwrócić `401` — to poprawny wynik ochrony.
4. Formularze i nawigacja są już podłączone według [instrukcji providera](auth-session.md).
   Bez sesji główny layout pokazuje formularz, a mapa nie jest montowana.
   Poprawki UI i nawigacji oraz wyniki testów: [aktualny stan](wdrozenie-po-audycie.md).

Po zmianie `.env.local` zrestartuj serwer Node, aby odczytał nowe dane Supabase.
Samo przeładowanie Expo nie wystarcza. `/health` nie sprawdza połączenia Auth:
może zwracać 200, gdy żądanie katalogu z tokenem kończy się 503 z powodu klucza.

`server:check` nadal sprawdza lokalny zbiór bez tokenów, sieci i otwierania portu.
Zwykły start bez konfiguracji Supabase kończy się błędem.
Produkcyjne `EXPO_PUBLIC_STORES_API_URL` musi używać HTTPS. HTTP pod adresem LAN
i portem 8787 jest dostępne podczas pracy deweloperskiej.

## Sprawdzanie dostępu

Serwer używa `auth.getUser(token)` z SDK Supabase. Żądanie do wskazanego projektu
weryfikuje token i zwraca aktualny stan użytkownika. Serwer dodatkowo ogranicza
claims tokenu do właściwego wystawcy, odbiorcy, użytkownika, roli i czasu ważności.
Dekodowanie JWT samo w sobie nie daje dostępu. Potwierdzenie emaila pochodzi
z odpowiedzi Supabase, a nie z `user_metadata` ani danych przesłanych osobno przez klienta.

| Wynik | Odpowiedź |
| --- | --- |
| Brak tokenu, token fałszywy, wygasły lub z innego projektu | `401` |
| Konto anonimowe, niepotwierdzone lub niedopuszczone | `403` |
| Niedostępna weryfikacja Supabase, timeout lub błąd konfiguracji usługi | `503`, bez katalogu |
| Prawidłowa sesja i konto | Katalog, `HEAD` lub pasujące `304` |

Weryfikacja odbywa się przed odczytem katalogu dla żądania, ustawieniem ETag i `304`.
Zewnętrzne sprawdzenie ma limit 5 sekund. Nieznany błąd bramki Supabase, w tym `401`
bez kodu błędu Auth, jest traktowany jako niedostępność weryfikacji (`503`).
Odpowiedzi chronione oraz błędy mają `Cache-Control: no-store`. Wewnętrzny cache
katalogu i gzip pozostaje; nie jest cache'em uprawnień użytkownika.

Preflight `OPTIONS` działa bez sesji i nie zwraca katalogu. CORS dopuszcza
`Authorization` oraz `If-None-Match`. Obecna polityka `Access-Control-Allow-Origin: *`
obejmuje localhost, adresy LAN i przyszły origin hostingu WWW; API nie używa cookies.
Ochronę stanowi sprawdzanie tokenu. Przed publikacją można zawęzić originy do własnego
hostingu, kiedy będzie znany; CORS nie zastępuje autoryzacji.

## Pobieranie w aplikacji

`useStores` i `fetchCatalog` używają wspólnego `authService`:

- Token jest odczytywany przed żądaniem, tylko dla `signedIn`. Nie trafia do formularzy,
  parametrów tras, logów, mapy ani jej dokumentu HTML.
- Pierwsze `401` uruchamia współdzielone odświeżenie lub korzysta z tokenu już
  odświeżonego w międzyczasie. Żądanie jest ponawiane maksymalnie raz.
- Drugie `401` kończy sesję tylko wtedy, gdy odrzucony token jest nadal aktualny.
  Awaria sieci nie uruchamia pętli odświeżeń.
- Wylogowanie lub zmiana sesji anuluje pobieranie i ukrywa poprzedni katalog.
  Spóźnione odpowiedzi są ignorowane, także po nowym logowaniu na to samo konto.
- Sam refresh w tej samej sesji nie pobiera ponownie tysięcy sklepów.
  Limit 15 sekund obejmuje pobieranie oraz oczekiwanie na odświeżenie.

`getSessionKey` jest wewnętrznym identyfikatorem cyklu życia, nie tokenem ani dowodem
uprawnień. UI reaguje na `AuthState`; formularze nie implementują własnego refreshu.

`fetchCatalog` rozróżnia część przyczyn błędów, lecz `useStores` prezentuje jeden
ogólny komunikat dla nieudanego pobierania. UI nie opisuje osobno błędnego klucza
serwera, niedostępności weryfikacji czy błędnego formatu katalogu.

## Granice gwarancji

Stan `recovery` nie udostępnia tokenu przez klienta danych ani nie otwiera mapy.
Backend sprawdza ważny token i potwierdzone konto; nie dowodzi tym, że użytkownik
ukończył zmianę hasła. Prawidłowy token wydany podczas odzyskiwania może spełnić
te warunki przy bezpośrednim wywołaniu API. Nie wprowadzamy fikcyjnego rozróżnienia
na podstawie metadanych użytkownika. Rozdzielenie ekranów recovery pozostaje
obowiązkiem nawigacji, a moduł usuwa tę sesję po zmianie hasła.

Lokalne wylogowanie czyści aplikację i przerywa jej żądania. Nie stanowi gwarancji
natychmiastowego unieważnienia każdej wcześniej skopiowanej kopii JWT; jego ważność
na serwerze zależy również od Supabase i terminu `exp`.

## Testy

Testy Node obejmują rzeczywiste HTTP serwera z kontrolowaną weryfikacją,
SDK z kontrolowanym transportem, granice sesji i żądania katalogu. Playwright używa
fikcyjnej konfiguracji i sesji wyłącznie w fixture'ach testowych, uruchamiając
rzeczywisty kod aplikacji oraz mapy. Produkcyjny kod nie ma przełącznika omijającego auth.
Historycznie, 9 listopada 2026: przeszły 82 testy Node, 17 testów Chrome i `tsc --noEmit`.
`server:check` potwierdził 7753 rekordy także bez konfiguracji auth; zwykły start
bez tej konfiguracji został poprawnie odrzucony. Rzeczywisty projekt Supabase
odrzucił fałszywy token przez wdrożony weryfikator (`401`), bez wysyłania maili.
To test negatywny; pozytywne operacje konta i maile sprawdzono w punkcie 3.
Po wdrożeniu napraw 14 listopada: 89/89 Node, 20/20 Playwright, TypeScript i ESLint
zaliczone. Pięć przypadków nieudanych podczas audytu zostało naprawionych.
[Raport wdrożenia](wdrozenie-po-audycie.md) opisuje nowy wynik i zakres weryfikacji.
Pełnego procesu mailowego i odbioru na fizycznych urządzeniach nie ponawiano.

Źródła: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[claims JWT](https://supabase.com/docs/guides/auth/jwt-fields),
[sesje Supabase](https://supabase.com/docs/guides/auth/sessions).
