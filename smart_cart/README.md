# SMARTCART

Aplikacja Expo / React Native na Androida, iOS i WWW. Ekrany: `src/app`; mapa: `src/features/stores`.

Stan po wdrożeniu **14 listopada 2026**: [zmiany, testy i ograniczenia danych](docs/wdrozenie-po-audycie.md).
Wdrożono ustalenia [ankiety](docs/plan-napraw-po-ankiecie.md): wyszukiwanie grup i ofert, prywatne nazwane listy, edycję produktów/ilości, porównanie pełnych opakowań i sprzedaży luzem oraz ulubione. Naprawiono formularze i zachowanie nawigacji przy zmianie sesji. Pięć migracji jest już we wspólnym Supabase.
[Baza produktów i cen](docs/database-context.md) jest osobna od katalogu placówek mapy. `supabase-schema.sql` odświeżono po wdrożeniu. [Utrzymanie katalogu](docs/utrzymanie-katalogu.md) opisuje migracje, eksport oraz uzupełnianie zweryfikowanych grup, dat i warunków promocji.
Źródła nie zawierają wszystkich metadanych: niepewne zamienniki pozostają osobnymi produktami, nieznany sposób sprzedaży wyłącza wycenę, a promocje bez dowodów nie są naliczane. [Audyt sprzed napraw](docs/stan-projektu.md) zachowuje historię wykrytych błędów.

## Home, menu i gazetki — 17 listopada 2026

[Powłoka aplikacji](docs/app-shell.md): Home · Ulubione · Koszyk · Szukaj · Mapa, menu z Profilem/Pomocą/Zasadami i zapamiętywany motyw. Profil ma zmianę hasła z kodem email, z ograniczeniami chmury opisanymi w kontrakcie Auth. Czytnik stron obrazowych jest przygotowany; rzeczywiste API i materiały oczekują na Damiana — [propozycja kontraktu](docs/leaflets-contract.md). [Wyniki i ograniczenia bieżącej pracy](docs/filip-implementation-report.md).

## Logowanie — integracja Supabase

[Kontrakt modułu auth](docs/auth-contract.md) opisuje typy, operacje i podział pracy.
[Operacje konta — punkt 3](docs/auth-operations.md) obsługują rzeczywiste Supabase:
rejestrację, potwierdzanie kodów, logowanie, reset hasła i lokalne wylogowanie.
[Sesja i provider — punkt 4](docs/auth-session.md) dodają zapamiętywanie zwykłego
logowania, odtwarzanie i odświeżanie oraz `AuthProvider/useAuth` dla ekranów osoby 2.
Jeden provider jest zamontowany w `src/app/_layout.tsx`. W tym samym pliku `AppShell`
blokuje właściwą aplikację poza stanem `signedIn`, a `AuthScreen` zawiera formularze.
[Chronione API — punkt 5](docs/auth-api.md) wymaga sesji potwierdzonego konta;
pobieranie sklepów używa bieżącego tokenu i przerywa się przy wylogowaniu.
Bez sesji główny layout pokazuje formularz logowania; chroniona nawigacja jest ukryta i niedostępna, a mapa nie jest montowana.

[Przekazanie i odbiór](docs/auth-handoff.md) opisuje obecną integrację, otwarte braki
formularzy i nawigacji oraz checklistę odbioru na urządzeniach.

[Konfiguracja Supabase — punkt 2](docs/supabase-setup.md) zawiera ustawienia Auth,
SMTP dla projektu bez własnej domeny, polskie szablony maili oraz zmienne środowiskowe.
Konfigurację wspólnego projektu oraz rzeczywiste doręczenie obu kodów sprawdzono
8–9 listopada 2026; szczegóły i ograniczenia są zapisane w instrukcji.

## Uruchomienie — PowerShell

Wymagany Node.js 24 LTS. Z katalogu `SMARTCART` przejdź do aplikacji i zainstaluj zależności:

```powershell
cd .\Projekt_zespolowy_2026-2027\smart_cart
npm.cmd ci
```

Przed pierwszym uruchomieniem skopiuj `.env.example` do `.env.local` i uzupełnij
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` oraz `SUPABASE_URL`.
Oba adresy muszą wskazywać ten sam projekt; publiczny klucz ma postać `sb_publishable_…`.
`.env.local` jest ignorowany przez Git.

W terminalu 1, w katalogu `smart_cart`, uruchom serwer danych:

```powershell
npm.cmd run server
```

Kod serwera znajduje się w `server/serwer-mapy.mjs`. Serwer czyta przygotowane dane z `../dane-sklepow/gotowe/sklepy.json` i udostępnia `http://localhost:8787/v1/stores` oraz `/health`. Cały katalog `dane-sklepow` jest w repozytorium, obok `smart_cart`: zawiera gotowy zbiór, oryginalne GeoJSON, poprawki, raporty, archiwum weryfikacji i narzędzia przygotowania danych. Po sklonowaniu repo zespół otrzymuje kod i dane.

Dane są odczytywane przez serwer; aplikacja Expo nadal pobiera sklepy przez API. Pliki źródłowe i raporty nie są importowane do pakietu aplikacji. Reguła w głównym `.gitattributes` wyłącza zmianę końców linii w `dane-sklepow`, aby zachować sumy SHA-256 źródeł i dowodów również po pobraniu repo na Windows.

W terminalu 2, również w katalogu `smart_cart`, uruchom aplikację:

```powershell
npm.cmd start
```

Otwórz projekt w Expo Go kodem QR albo naciśnij `w`, aby uruchomić przeglądarkę. Mapa jest w zakładce **Mapa**. Telefon i komputer powinny być w tej samej sieci; port 8787 komputera musi być dostępny dla telefonu.

W trybie deweloperskim aplikacja używa hosta przeglądarki lub komputera z Expo, z portem 8787. Opcjonalnie ustaw pełny adres endpointu w `.env.local` i uruchom Expo ponownie:

```dotenv
EXPO_PUBLIC_STORES_API_URL=http://ADRES_IP_KOMPUTERA:8787/v1/stores
```

`localhost` na telefonie oznacza telefon. Tunel Expo nie udostępnia automatycznie serwera danych — potrzebny jest wtedy osobno dostępny adres API.

### Konfiguracja serwera danych

`npm.cmd run server` automatycznie wczytuje `.env.local` z katalogu `smart_cart`. Możesz skopiować `.env.example` jako szablon. Serwer korzysta z zainstalowanego SDK Supabase.

Po zmianie adresu lub klucza Supabase zrestartuj **serwer danych i Expo**.
Serwer Node nie przeładowuje `.env.local` automatycznie. Gdy logowanie działa,
a sklepy są niedostępne, sprawdź, czy na porcie 8787 nie działa starszy proces ze starą konfiguracją.
`/health` potwierdza dane i działanie HTTP, ale nie poprawność połączenia z Supabase.

- `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY` — adres i publiczny klucz wspólnego projektu. Jeśli ich nie podasz, serwer użyje odpowiadających zmiennych `EXPO_PUBLIC_SUPABASE_*`. Brak konfiguracji blokuje start. Nie potrzeba klucza `service_role`.

- `SMARTCART_DATA_DIR` — katalog zawierający `gotowe/sklepy.json`. Domyślnie `../dane-sklepow` względem `smart_cart`, czyli w katalogu głównym repozytorium. Ścieżka względna jest zawsze liczona od katalogu aplikacji, także przy uruchomieniu skryptu z innego miejsca. Standardowy układ po sklonowaniu repo nie wymaga ustawiania tej zmiennej.
- `SMARTCART_DATA_PORT` — domyślnie `8787`. Jeśli zmienisz port, dostosuj również `EXPO_PUBLIC_STORES_API_URL` i uruchom Expo ponownie.

Przykład własnej lokalizacji danych w `.env.local`:

```dotenv
SMARTCART_DATA_DIR=C:/dane-smartcart
SMARTCART_DATA_PORT=8787
```

Serwer udostępnia przygotowany katalog po sprawdzeniu tokenu `Authorization: Bearer …`; wejście bez tokenu na `/v1/stores` zwróci `401`. Publiczny `/health` udostępnia wyłącznie informacje techniczne. Przy braku lub błędnych danych serwer kończy start, zanim otworzy port. `npm.cmd run server:check` sprawdza plik bez uruchamiania serwera, konfiguracji auth ani połączenia z Supabase. Samo importowanie modułu nie uruchamia serwera.

## Mapa sklepów

Mapa używa **MapLibre GL JS 6.16.0** na wszystkich platformach. Na telefonach działa wewnątrz `react-native-webview` dostępnego w Expo Go, a na WWW w osadzonej ramce. Obie wersje korzystają z tego samego dokumentu i stylów w `src/features/stores/map`. Podkład działa bez klucza API.

- Punkty pochodzą wyłącznie z przygotowanego katalogu (obecnie 7753 sklepy). Rekordy oczekujące na weryfikację są wykluczone, a kopia katalogu nie jest dołączana do aplikacji.
- Filtry obejmują Lidl, Biedronkę, Auchan i Dino. Wyszukiwarka filtruje nazwy i adresy, także bez polskich znaków. **Szukaj** ustawia widok na wyniki.
- Kliknięcie grupy przybliża mapę; kliknięcie sklepu otwiera kartę z nazwą i adresem.
- **Wyznacz trasę** otwiera zewnętrzną nawigację: Apple Maps na iOS lub adres Google Maps na Androidzie/WWW.
- **Moja lokalizacja** pyta o zgodę dopiero po kliknięciu, jednorazowo odczytuje pozycję i centruje mapę. Odmowa pozostawia ręczne przeglądanie. Pozycja nie jest wysyłana do serwera sklepów. Dystans w karcie jest odległością w linii prostej.
- **Cała Polska** przywraca widok kraju. Mapa ma stałą jasną kolorystykę.
- Przycisk **i** rozwija skrócone, klikalne oznaczenia OpenMapTiles i OpenStreetMap. Przy pierwszym otwarciu mapy w sesji aplikacji podpis jest widoczny przez 5 sekund, potem automatycznie się zwija. Kolejne wejścia w tej sesji zaczynają się ze zwiniętym podpisem.

Podkład to wektorowy Positron z OpenFreeMap z własnymi kolorami SMARTCART. Silnik i CSS są pobierane z przypiętego adresu unpkg; podkład, fonty i zasoby pochodzą z OpenFreeMap. Wymagane są internet i WebGL2; nie ma trybu offline. Paczka `maplibre-gl` w zależnościach deweloperskich służy do uruchamiania testów z lokalnymi plikami biblioteki.

Punkty i grupy są rysowane jako warstwy WebGL, bez tysięcy znaczników HTML. Do widoku trafia katalog po zmianie wyników filtrowania; przesuwanie mapy nie przesyła go ponownie. Dokument mapy sam nie pyta o lokalizację.

Oznaczenia © OpenMapTiles i © OpenStreetMap są dostępne pod przyciskiem **i** w rogu mapy. Źródłem bazowych danych sklepów jest All the Places (CC0); część poprawek pochodzi z OpenStreetMap (ODbL). Audyt i szczegóły pochodzenia rekordów pozostają w katalogu `dane-sklepow` w repozytorium.

### Android i uprawnienia

HTML w WebView otrzymuje bazowy adres HTTPS przez `source.baseUrl`. Bez niego dokument ma pochodzenie `null`, blokujące workery modułowe MapLibre. `https://smartcart.invalid/map/` jest wirtualnym adresem lokalnego dokumentu, nie serwerem do pobrania ani adresem API.

Silnik został sprawdzony przez użytkownika na Androidzie i komputerze. iOS oraz płynność na konkretnych modelach telefonów wymagają osobnych testów. Lokalizacja w przeglądarce wymaga bezpiecznego kontekstu, np. HTTPS albo localhost; HTTP pod adresem LAN może ją blokować.

## Publikacja i WWW

Do wersji produkcyjnej ustaw `EXPO_PUBLIC_STORES_API_URL` na rzeczywisty publiczny endpoint HTTPS, zwracający katalog w formacie z `model.ts`. Lokalny serwer służy do pracy deweloperskiej; projekt nie wdraża hostingu. Poza trybem deweloperskim nie ma automatycznego adresu zastępczego.

WWW używa `web.output: "single"`: ekrany działają w przeglądarce, a dane pobierają z osobnego API. Projekt nie korzysta z API Routes ani loaderów Expo. Ten tryb omija odtworzony błąd renderowania serwerowego SDK 58 przy zmianie tras i przeładowaniu. Hosting musi przekierowywać adresy ekranów do `dist/index.html`. Jeśli dodacie serwerowe funkcje Expo, trzeba ponownie dobrać tryb WWW.

## Eksport bazy i lokalna konfiguracja Supabase

`supabase-schema.sql` jest migawką struktury zdalnej bazy z 14 listopada, bez rekordów.
Nie synchronizuje się automatycznie. [Aktualny kontrakt RPC](docs/database-context.md) i [obsługa eksportu/migracji](docs/utrzymanie-katalogu.md) opisują nowe funkcje po wdrożeniu napraw.

`supabase/config.toml` opisuje konfigurację lokalną, z dopasowanymi podstawowymi parametrami auth. Nie jest kopią konfiguracji chmury. Korzystamy ze wspólnego projektu; nie uruchamiamy dodatkowego lokalnego Auth.

## Sprawdzanie

Z katalogu aplikacji:

```powershell
npm.cmd test
npm.cmd run server:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:e2e
npx.cmd expo export --platform all
```

Testy jednostkowe używają runnera Node 24. Playwright wymaga zainstalowanego Google Chrome i uruchamia własne Expo z fikcyjną konfiguracją Supabase na domyślnym porcie **8091**. Inny wolny port można wskazać przez `MAP_TEST_PORT`. Testy uruchamiają rzeczywisty silnik i workery MapLibre z lokalnych plików, z fikcyjną sesją, sklepami i zastępczym podkładem — nie potrzebują prawdziwego konta ani nie pobierają publicznych kafelków.

Uruchamiaj jedną instancję Metro dla projektu. Po zmianie zależności lub problemie z cache zatrzymaj Expo i uruchom `npx.cmd expo start --clear --port 8081`, a następnie ponownie otwórz projekt w Expo Go. Eksport najlepiej wykonywać przy zatrzymanym serwerze deweloperskim.

Wyjątkiem jest izolowane Expo uruchamiane przez Playwright na osobnym porcie i z fikcyjnymi ustawieniami. Nie używaj jego adresu jako zwykłego środowiska deweloperskiego.

Wyniki po wdrożeniu: **89/89 testów Node, 20/20 Playwright, 37/37 testów danych, TypeScript, ESLint i kontrola 7753 sklepów zaliczone**. Eksport WWW/Android/iOS zakończony powodzeniem. Szczegóły oraz granice odbioru: [raport](docs/wdrozenie-po-audycie.md).
Przed publikacją dodano cztery testy kontroli sekretów: aktualny zestaw Node ma **93 testy**. Reguły i problem starszej historii Git opisuje [kontrola publikacji](docs/publikacja-git.md).

`npm.cmd run test:db` sprawdza migracje i RLS w wyłącznie testowym kontenerze Postgres. [Instrukcja](docs/utrzymanie-katalogu.md). Nieistniejący skrypt `reset-project` usunięto.

`npm.cmd test` obejmuje również `tests/server.test.mjs`: konfigurację ścieżki danych i działanie API na fikcyjnych rekordach. `server:check` odczytuje prawdziwy plik danych z repozytorium. Instrukcje kontroli i ponownego przygotowania całego zbioru są w `../dane-sklepow/README.md`.

Eksport sprawdza pakowanie kodu na trzy platformy; test przeglądarkowy nie zastępuje testowania gestów, uprawnień i płynności na fizycznych telefonach.
