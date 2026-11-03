# SMARTCART

Aplikacja Expo / React Native na Androida, iOS i WWW. Ekrany: `src/app`; mapa: `src/features/stores`.

## Uruchomienie — PowerShell

Wymagany Node.js 24 LTS. Z katalogu `SMARTCART` przejdź do aplikacji i zainstaluj zależności:

```powershell
cd .\Projekt_zespolowy_2026-2027\smart_cart
npm.cmd ci
```

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

Otwórz projekt w Expo Go kodem QR albo naciśnij `w`, aby uruchomić przeglądarkę. Mapa jest w zakładce **Sklepy**. Telefon i komputer powinny być w tej samej sieci; port 8787 komputera musi być dostępny dla telefonu.

W trybie deweloperskim aplikacja używa hosta przeglądarki lub komputera z Expo, z portem 8787. Opcjonalnie ustaw pełny adres endpointu w `.env.local` i uruchom Expo ponownie:

```dotenv
EXPO_PUBLIC_STORES_API_URL=http://ADRES_IP_KOMPUTERA:8787/v1/stores
```

`localhost` na telefonie oznacza telefon. Tunel Expo nie udostępnia automatycznie serwera danych — potrzebny jest wtedy osobno dostępny adres API.

### Konfiguracja serwera danych

`npm.cmd run server` automatycznie wczytuje `.env.local` z katalogu `smart_cart`. Możesz skopiować `.env.example` jako szablon. Serwer nie wymaga dodatkowych bibliotek poza Node.js.

- `SMARTCART_DATA_DIR` — katalog zawierający `gotowe/sklepy.json`. Domyślnie `../dane-sklepow` względem `smart_cart`, czyli w katalogu głównym repozytorium. Ścieżka względna jest zawsze liczona od katalogu aplikacji, także przy uruchomieniu skryptu z innego miejsca. Standardowy układ po sklonowaniu repo nie wymaga ustawiania tej zmiennej.
- `SMARTCART_DATA_PORT` — domyślnie `8787`. Jeśli zmienisz port, dostosuj również `EXPO_PUBLIC_STORES_API_URL` i uruchom Expo ponownie.

Przykład własnej lokalizacji danych w `.env.local`:

```dotenv
SMARTCART_DATA_DIR=C:/dane-smartcart
SMARTCART_DATA_PORT=8787
```

Serwer udostępnia wyłącznie przygotowany katalog i informacje o jego stanie. Przy braku lub błędnych danych kończy start z komunikatem, zanim otworzy port. `npm.cmd run server:check` sprawdza plik bez uruchamiania serwera. Samo importowanie modułu nie uruchamia serwera.

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

## Sprawdzanie

Z katalogu aplikacji:

```powershell
npm.cmd test
npm.cmd run server:check
npx.cmd tsc --noEmit
npm.cmd run test:e2e
npx.cmd expo export --platform all
```

Testy jednostkowe używają runnera Node 24. Playwright wymaga zainstalowanego Google Chrome. Domyślnie używa istniejącego Expo na porcie 8081; jeśli go nie ma, startuje własny serwer. Dla innego portu ustaw `MAP_TEST_PORT`. Testy uruchamiają rzeczywisty silnik i workery MapLibre z lokalnych plików, z fikcyjnymi sklepami i zastępczym podkładem — nie potrzebują rzeczywistego katalogu ani nie pobierają publicznych kafelków.

Uruchamiaj jedną instancję Metro dla projektu. Po zmianie zależności lub problemie z cache zatrzymaj Expo i uruchom `npx.cmd expo start --clear --port 8081`, a następnie ponownie otwórz projekt w Expo Go. Eksport najlepiej wykonywać przy zatrzymanym serwerze deweloperskim.

`npm.cmd test` obejmuje również `tests/server.test.mjs`: konfigurację ścieżki danych i działanie API na fikcyjnych rekordach. `server:check` odczytuje prawdziwy plik danych z repozytorium. Instrukcje kontroli i ponownego przygotowania całego zbioru są w `../dane-sklepow/README.md`.

Eksport sprawdza pakowanie kodu na trzy platformy; test przeglądarkowy nie zastępuje testowania gestów, uprawnień i płynności na fizycznych telefonach.
