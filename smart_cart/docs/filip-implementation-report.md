# Raport implementacji zakresu Filipa — 17 listopada 2026

Wdrożono lokalne zmiany na gałęzi `feat/Home_globalna_nawigacja_itd` według `/Users/filip/Downloads/Filip.md` i dwóch odpowiedzi użytkownika: **kod email z zachowaniem sesji** oraz **czytnik obrazów z propozycją kontraktu dla Damiana**. Początkowo drzewo Git było czyste. Nie wykonano commita, publikacji ani zapisu do chmury.

## Wynik

- Home ma uzgodnione trzy rzędy: Listy zakupów | Ulubione, szerokie Gazetki, Mapa sklepów | Produkty. Układ zachowuje dwie kolumny także przy zmianie szerokości; wszystkie pięć kafelków ma trasę.
- Dolny pasek: Home · Ulubione · wyróżniony środkowy Koszyk · Szukaj z lupą · Mapa. Zachowano wewnętrzne trasy katalogu, list i mapy.
- Wspólne pole produktów pozostało tylko na Home. Katalog ma swoje pojedyncze pole; fraza `q` ze znakami specjalnymi trafia do rzeczywistych wywołań istniejącego API. Pozostałe ekrany nie mają dużej globalnej wyszukiwarki.
- Menu boczne z motywem, Profilem, Pomocą, Zasadami, wylogowaniem i nieklikalną wersją wydania. Escape, przycisk i tło zamykają bez zmiany trasy. Ukryto tło dla dostępności i kliknięć, przywracany jest focus.
- Jeden motyw jasny/ciemny/systemowy, zapis preferencji na urządzeniu, reakcja na zmianę systemu, kolory wspólnych komponentów, Auth, katalogu, koszyka i elementów mapy. Papier gazetek oraz podkład mapy pozostają jasne.
- Profil: email, Ulubione, listy, dedykowana zmiana hasła i wspólne wylogowanie. Walidacja, potwierdzenie hasła, kod, błędy, anulowanie i ochrona przed późną odpowiedzią SDK. Recovery zachowane.
- Pomoc i Zasady są osobnymi chronionymi widokami opisującymi rzeczywiste reguły wyceny.
- Czytnik obrazów: wybór sieci i gazetki, daty, uporządkowane strony, licznik, skala 100–300%, przewijanie, retry, odświeżenie dostępu, ochrona sesji i walidacja zasobów. Pobierana jest pojedyncza strona. Nie ma normalnego trybu z przykładowymi gazetkami.

## Kontrole wykonane w tej pracy

| Kontrola | Wynik |
| --- | --- |
| `npm run typecheck` | zaliczona |
| `npm run lint` | zaliczona bez ostrzeżeń |
| `npm test` | 110 testów: 109 zaliczonych, 0 błędów, 1 pominięty |
| Pominięty test | istniejący test uruchomienia Gitleaks; narzędzie niedostępne w środowisku |
| `npm run test:e2e` | pełny przebieg: 30/30, Chrome, 42,4 s |
| Dodatkowy test ciemnej mapy i focusu małego menu | 1/1 zaliczony (osobny przebieg po poprawce kontrastu), 5,9 s |
| `npm run server:check` | poprawne 7753 placówki w zastanym lokalnym JSON |
| `npx expo export --platform all --max-workers 2 --output-dir .expo/filip-export` | zaliczone WWW, Android, iOS |
| `git diff --check` | bez błędów |
| Oględziny UI | obejrzano renderowane Home jasne/ciemne, menu ciemne i czytnik; screenshoty z Playwright |
| Fizyczne urządzenia / symulator iOS | nie sprawdzono; `xcrun simctl` niedostępne |
| SQL/RLS | nie uruchamiano — brak zmian schematu/SQL/RLS |

Wersje faktycznie odczytane w katalogu aplikacji: Node 24.15.0, Expo 58.0.22, React 19.3.0, TypeScript 6.0.3, Supabase JS 2.119.0. Nie instalowano ani nie aktualizowano zależności. Eksport to kontrola pakowania, nie dowód działania gestów, safe area, klawiatury, skalowania czcionki i maili na fizycznym telefonie. Zestaw testów pozostawia istniejące ostrzeżenie Node o braku `type` w package.json; nie zmieniano trybu modułów projektu.

Testy Node wymagające localhost początkowo zablokowała piaskownica (`EPERM`); zostały skutecznie ponowione z uprawnieniem. Pierwsze testy WWW ujawniły rzeczywisty problem Expo 58: import `.env.local` do `expo/virtual/env` mimo zmiennych testowych. Transport testowy blokował obcy host Auth, więc nie wykonano operacji na prawdziwych kontach. Naprawiono izolację testowego Metro; [opis](app-shell.md#kontrole-i-uruchomienie). Poprawiono też wykryte przez testy ukrycie tła menu dla dostępności i przejściowe rozjechanie kolumn Home podczas zmiany szerokości. Scenariusze mapy zaktualizowano do zatwierdzonej etykiety „Mapa”.

Testy obejmują m.in. istniejące koszyki i mapę, ochronę tras i odtwarzanie sesji, błędy wylogowania, wyszukiwanie ze znakami specjalnymi, zapis motywu i zmianę systemu, walidację hasła/kodu, błędy API, anulowanie, zmianę konta, brak odtworzenia starej sesji przez SDK, wielostronicowe obrazy, zmianę strony/zoom/menu/reload, HTML zamiast obrazu, 403/404/410, awarię sieci, rozmiary i timeout. Fixtury PNG są syntetyczne.

## Granice i zależności

1. **Gazetki — Damian:** brakuje rzeczywistego endpointu i materiału. [Kompletny kontrakt do uzgodnienia](leaflets-contract.md) zawiera JSON, formaty, ograniczenia, CORS, dostęp, wygasanie, błędy i kryterium odbioru. Nie ustawiono produkcyjnej zmiennej endpointu i nie ogłoszono rzeczywistej integracji jako gotowej. Brak materiałów jest widoczny po wejściu z Home. Okładka jest polem opcjonalnym kontraktu; bieżąca lista nie pobiera wszystkich okładek. PDF i pinch-to-zoom nie są częścią dostarczonego wariantu.
2. **Auth — właściciel wspólnego projektu:** kod email jest wysyłany przez `reauthenticate` i przekazywany jako nonce do `updateUser`. Ustawienia „Secure password change”, ewentualne wymaganie bieżącego hasła oraz dostarczenie maila muszą zostać potwierdzone w chmurze. Supabase może traktować sesję z ostatnich 24 godzin jako wystarczająco świeżą; klient nie stanowi gwarancji wymuszenia nonce przy każdej zmianie. Nie testowano prawdziwego konta ani SMTP. [Kontrakt Auth](auth-contract.md#profil--rozszerzenie-17-listopada-2026).
3. **Radek:** istniejące Ulubione nie mają jeszcze własnego filtra i docelowej zwartej listy. Nie wdrażano ich przebudowy ani drzewa kategorii, bo należą do Radka. Zmiany jego ekranów ograniczono do wspólnego hooka stylów. Właścicielem wyszukiwarki `/products` pozostaje katalog; przekazanie frazy przez `q` jest opisane.
4. **Kowal/Damian:** docelowy transport placówek z Supabase nadal należy do nich. Nie zastępowano go ani nie importowano placówek. `server:check` potwierdza wyłącznie zastany JSON.
5. **Odbiór native:** pozostają fizyczne Android/iOS, klawiatura, duża czcionka, Wstecz i czytnik na rzeczywistych dokumentach. Nie zmieniono wymaganego typu builda. Czytnik korzysta z obecnego w projekcie `expo-image`.

## Migracje i stan wspólnych danych

W repozytorium nadal pięć migracji `20261114000100`–`20261114000500`. Nie dodawano ani nie edytowano migracji, SQL/RPC, RLS, danych produktów, importerów, źródeł placówek, Storage, SMTP ani ustawień chmurowego Auth. Nie uruchamiano `db push`, importów lub resetów. `package.json`, lockfile, API katalogu i ShoppingProvider nie zostały zmienione. Nie zatrzymywano cudzych serwerów; serwery testowe były uruchamiane i zamykane przez Playwright.

## Przekazanie zespołowi

[Mapa tras, mechanizm motywu i instrukcja uruchomienia](app-shell.md) opisują użycie `useTheme().colors` oraz `useUI()` zamiast statycznego `ui`. Zmiany wspólnych plików są lokalnym diffem do przeglądu. Nie wysyłano wiadomości innym osobom ani nie publikowano materiałów.

## Odbiór względem listy z Filip.md

- [x] Home i dolna nawigacja odpowiadają układowi i kolejności z pliku.
- [x] Globalne wyszukiwanie ograniczono do Home/Szukaj, bez duplikatu; `q` działa.
- [x] Menu zastępuje Ustawienia; Profil, Pomoc i Zasady mają chronione trasy.
- [x] Motyw działa w istniejących ekranach i jest zapamiętywany.
- [x] Profil i dedykowana operacja hasła są zaimplementowane i przetestowane z kontrolowanym SDK; recovery zachowane.
- [x] Czytnik obrazów i kontrakt dla Damiana wykonano w wariancie zatwierdzonym przez użytkownika.
- [ ] Odbiór czytnika na **rzeczywistych** materiałach Damiana i urządzeniach — brakuje materiałów/API i urządzeń.
- [ ] Potwierdzenie dostarczenia kodu oraz egzekwowania polityki hasła przez **chmurowy** Auth — bez testu realnego konta i bez zmian ustawień.
- [x] Brak martwych kafelków i danych demonstracyjnych w normalnym trybie; brak integracji gazetek jest jawny.
- [x] Testy globalnej nawigacji, Auth i czytnika zaliczone; dokumentacja i kontrakty zaktualizowane.
- [x] Nie wykonano zmian bazy, Storage ani konfiguracji chmurowego Auth.

Otwarte pozycje są zależnościami odbioru, a nie deklaracją gotowości na podstawie fixture. Dalsze prace można rozpocząć od przekazania Damianowi `leaflets-contract.md` oraz sprawdzenia ustawień Auth przez właściciela projektu.

## Pliki zmienione i dodane

Lista poniżej obejmuje pliki tego zadania; ścieżki względem `smart_cart`.

- `.env.example`
- `README.md`
- `docs/app-shell.md`
- `docs/auth-contract.md`
- `docs/auth-handoff.md`
- `docs/auth-operations.md`
- `docs/auth-session.md`
- `docs/filip-implementation-report.md`
- `docs/leaflets-contract.md`
- `metro.config.cjs`
- `playwright.config.ts`
- `src/app/+not-found.tsx`
- `src/app/_layout.tsx`
- `src/app/cart/_layout.tsx`
- `src/app/favorites/_layout.tsx`
- `src/app/help.tsx`
- `src/app/index.tsx`
- `src/app/leaflets/[id].tsx`
- `src/app/leaflets/_layout.tsx`
- `src/app/leaflets/index.tsx`
- `src/app/products/_layout.tsx`
- `src/app/profile/_layout.tsx`
- `src/app/profile/index.tsx`
- `src/app/rules.tsx`
- `src/app/settings/_layout.tsx`
- `src/app/settings/index.tsx`
- `src/app/stores/_layout.tsx`
- `src/components/auth/AuthShell.tsx`
- `src/components/navigation/BackButton.tsx`
- `src/components/navigation/BottomBar.tsx`
- `src/components/navigation/SideMenu.tsx`
- `src/components/ui/Controls.tsx`
- `src/features/auth/AuthProvider.tsx`
- `src/features/auth/AuthScreen.tsx`
- `src/features/auth/errors.ts`
- `src/features/auth/instance.ts`
- `src/features/auth/navigation.ts`
- `src/features/auth/passwordRequests.ts`
- `src/features/auth/service.ts`
- `src/features/auth/types.ts`
- `src/features/catalog/CartScreen.tsx`
- `src/features/catalog/FavoritesScreen.tsx`
- `src/features/catalog/GroupDetails.tsx`
- `src/features/catalog/ProductsScreen.tsx`
- `src/features/leaflets/LeafletsScreen.tsx`
- `src/features/leaflets/ReaderScreen.tsx`
- `src/features/leaflets/api.ts`
- `src/features/leaflets/model.ts`
- `src/features/leaflets/transport.ts`
- `src/features/stores/StoresScreen.tsx`
- `src/features/stores/map/MapStatus.tsx`
- `src/features/theme/ThemeProvider.tsx`
- `src/features/theme/palette.ts`
- `src/lib/supabase.ts`
- `tests/auth-sdk.test.mjs`
- `tests/browser/leaflets.spec.ts`
- `tests/browser/map-fixture.ts`
- `tests/browser/shell.spec.ts`
- `tests/browser/shopping.spec.ts`
- `tests/browser/stores.spec.ts`
- `tests/fixtures/leaflets/page-1.png`
- `tests/fixtures/leaflets/page-2.png`
- `tests/fixtures/leaflets/page-3.png`
- `tests/leaflets.test.mjs`
- `tests/password-requests.test.mjs`
- `tests/profile-password.test.mjs`
- `tests/shell-model.test.mjs`
