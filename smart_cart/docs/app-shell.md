# Powłoka aplikacji Filipa

Stan: 17 listopada 2026. Zachowano Expo Router `js-tabs` i jeden AuthProvider. Tabs pozostaje zamontowany podczas przejściowego odtwarzania sesji; poza `signedIn` jest ukryty. Dane nadal chroni wspólny klucz sesji. Nie powstała druga implementacja list lub logowania.

## Mapa tras i właściciele

| Trasa | Wejście / właściciel |
| --- | --- |
| `/` | Home, wyszukiwanie i pięć kafelków / Filip |
| `/favorites` | Ulubione / Radek |
| `/cart` | środkowy wyróżniony Koszyk; Listy zakupów / istniejący moduł |
| `/products?q=…` | Szukaj (lupa), Produkty i wyniki z Home / Radek |
| `/stores` | Mapa, Mapa sklepów / Kowal |
| `/profile` | menu → Profil / Filip |
| `/help`, `/rules` | Pomoc i Zasady porównywania / Filip |
| `/leaflets`, `/leaflets/[id]?page=2` | Gazetki, czytnik / Filip; dane: Damian |
| `/settings` | zgodność dawnych linków: przekierowanie do Zasad |

Dolny pasek ma dokładnie: Home · Ulubione · Koszyk · Szukaj · Mapa. Profil i ustawienia motywu dostępne są z menu. Zamknięcie menu nie nawiguje. Wstecz na osobnych widokach wykorzystuje historię; przy braku historii wraca na Home. Nieznana trasa WWW wraca na Home; native pokazuje komunikat i link. Dozwolone dynamiczne ID gazetek waliduje `auth/navigation.ts`.

Home przekazuje `q` przez obiekt parametrów routera, zachowując znaki specjalne. Właścicielem pola na `/products` pozostaje `ProductsScreen`: nie ma drugiego pola w nagłówku. Wspólny nagłówek pokazuje duże pole wyłącznie na Home. Mapa zachowuje lokalny filtr. Zastany moduł Ulubionych nie posiada jeszcze własnego filtra ani docelowej zwartej listy — to zadanie Radka; tej logiki nie wdrażano w zakresie Filipa.

## Kontrakt motywu dla Radka i Kowala

Jeden `ThemeProvider` w głównym layoucie. `useTheme()` udostępnia `colors`, `dark`, `preference`, `setPreference`, `ready`, `error`. Preferencje: `light | dark | system`. `useColorScheme()` śledzi system. AsyncStorage zapisuje wyłącznie preferencję urządzenia w `smartcart.theme.v1`, niezależnie od magazynu Auth i konta. Zapisy są kolejkowane; błąd pamięci pokazuje menu. Powłoka czeka na odczyt preferencji.

Nowe ekrany używają `useUI()` z `components/ui/Controls`, a własne style — `useTheme().colors`. `Button`, `Field`, `Notice` i `Screen` same reagują na motyw. Dawny statyczny eksport `ui` zastąpiono hookiem; wszystkie istniejące użycia zostały dostosowane. W katalogu i mapie zmiany ograniczono do kolorów/tego kontraktu, bez przebudowy algorytmu lub transportu. Jasny podkład kartograficzny i papier stron gazetek pozostają jasne; obrazy nie są odwracane.

## Menu

Nagłówek otwiera modal z panelem bocznym. Panel ma safe area, przewijanie, motyw, Profil, Pomoc, Zasady i wspólne `useAuth().signOut()`. Stopka korzysta z `Constants.expoConfig.version`. Przycisk, tło oraz Android Wstecz / WWW Escape zamykają panel. Modal zarządza focusem; tło ma ukrycie dostępności i wyłączone kliknięcia. Menu jest powiązane z trasą i kluczem sesji, więc zmiana konta nie odtwarza poprzedniego menu.

## Czytnik

Czytnik pobiera katalog ze wspólnego projektu Supabase, używając adresu `EXPO_PUBLIC_LEAFLETS_API_URL`. Instrukcja konfiguracji i format odpowiedzi są w [kontrakcie gazetek](leaflets-contract.md).

Czytnik wybiera sieć/gazetkę, pokazuje daty, numer strony, nawigację oraz skalę 100–300%. Powiększoną stronę przewija się w obu osiach. Przyciski działają wspólnie na trzech platformach bez nowych zależności i zmiany rodzaju builda. Obsługa gestu pinch nie jest deklarowana. Numer strony jest parametrem URL i przetrwa reload; zoom pozostaje podczas zamknięcia menu, po reload wraca do 100%.

Metadane są pobierane z ochroną sesji, limitem czasu i jedną próbą odnowienia 401. Strona pobiera się pojedynczo, z kontrolą statusu, MIME, sygnatury i rozmiaru; HTML lub PDF dają skończony błąd. Zmiana strony, utrata sesji i opuszczenie czytnika zwalniają wyświetlany zasób/przerywają żądanie. Obrazy wyświetla obecny w projekcie `expo-image` z `cachePolicy="none"`; trafiają tylko do pamięci jako data URI, bez trwałego pobierania i bez nagłówków Auth. „Odśwież dostęp” pobiera świeże URL. Błąd dekodera obrazu też daje przycisk ponowienia.

## Kontrole i uruchomienie

Standardowe polecenia z `smart_cart`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run server:check`. Eksport: `npx expo export --platform all --max-workers 2 --output-dir .expo/filip-export`.

Playwright uruchamia własny Metro i Chrome, nie używa prawdziwych kont. `SMARTCART_E2E=1` wraz z `metro.config.cjs` wyklucza pliki `.env*` wyłącznie z testowego Metro. Jest to konieczne w zainstalowanym SDK 58: `expo/virtual/env` importuje pliki przez `require.context` i potrafi nadpisać zmienne procesu nawet przy `EXPO_NO_DOTENV=1`. Zwykłe uruchomienie nadal korzysta z `.env.local`. Konfiguracja testowa nie dotyka plików użytkownika. Zewnętrzne Auth/REST są blokowane przez fixturę, aby przypadkowy niewłaściwy adres nie dotknął rzeczywistych kont.

Testy przeglądarkowe zapisują podglądy Home, menu i czytnika w `test-results`; nie używają rzeczywistych danych konta. Końcowe wyniki i ograniczenia: [raport Filipa](filip-implementation-report.md).

Źródła integracji: [Expo Image SDK 58](https://docs.expo.dev/versions/latest/sdk/image/) (PNG/JPEG/WebP, WWW/iOS/Android i Expo Go), [JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/), [React Native Modal](https://reactnative.dev/docs/modal) i [useColorScheme](https://reactnative.dev/docs/usecolorscheme). Kod sprawdzono także w zainstalowanych pakietach.
