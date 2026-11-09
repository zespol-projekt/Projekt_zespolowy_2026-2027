# Sesja i provider — punkt 4

Gotowe są `AuthProvider` i `useAuth`, dostępne z `@/features/auth` oraz
`@/features/auth/AuthProvider`. Hook zwraca uzgodniony `AuthContextValue`:
stan i operacje konta, bez tokenów. Korzystają z jednego klienta Supabase
i jednej instancji modułu sesji.

## Podłączenie przez osobę 2

1. W `src/app/_layout.tsx` zaimportuj `AuthProvider` i otocz nim całe drzewo
   nawigacji: zarówno formularze auth, jak i ekrany aplikacji. Provider montuj
   raz, poza warunkiem sprawdzającym zalogowanie.
2. W formularzach i profilu pobieraj dane przez hook:

   ```tsx
   import { useAuth } from '@/features/auth';

   const { state, signIn, signOut, retrySession } = useAuth();
   ```

3. Nawigacja reaguje na `state.status`: `initializing` pokazuje ładowanie,
   `signedOut` formularze, `signedIn` właściwą aplikację, `recovery` wyłącznie
   formularz nowego hasła. `error` pokazuje komunikat i przycisk `retrySession`.
   Faza `recovery/verifyingCode` nadal oznacza oczekiwanie, nie zgodę na zmianę hasła.
4. Po `setNewPassword` pokaż sukces tylko dla `result.ok`; błąd może informować,
   że hasło zapisano, ale zakończenie sesji wymaga ponowienia.

Główny layout pozostaje plikiem osoby 2. W tej zmianie provider nie został tam
zamontowany i nie dodano ekranów ani ochrony tras. Osoba 2 nie tworzy drugiego
klienta Supabase ani własnej kopii sesji. `useAuth` poza providerem zgłasza błąd.

## Przechowywanie i odtwarzanie

- Android/iOS: AsyncStorage 2.2.0 dobrane przez Expo SDK 58, dostępne w Expo Go.
  Jest to trwały magazyn bez dodatkowego szyfrowania.
- WWW: `localStorage` dla bieżącego originu; jest dostępny skryptom tej strony.
  Klucz sesji jest osobny dla adresu projektu Supabase.
- Zapis i usuwanie tokenów wykonuje SDK przez jeden adapter `storage.ts`.
  Hasła i kody nie są utrwalane; formularze, parametry tras i dokument mapy nie dostają tokenów.

Provider rozpoczyna od `initializing`. Moduł odczytuje sesję, pozwala SDK odświeżyć
wygasły token i sprawdza użytkownika przez `getUser`. Dopiero potwierdzony email
uprawnia do `signedIn`. Brak sesji lub jej trwałe odrzucenie daje `signedOut`.
Awaria internetu/usługi daje kontrolowany `error`, zachowując zapis sesji do ponowienia.

Na telefonie odświeżanie w tle działa tylko przy aktywnej aplikacji i zwykłym
zalogowaniu. Powrót do aplikacji ponownie sprawdza sesję. Na WWW widocznością karty
i automatycznym odświeżaniem zarządza SDK. Zdarzenia między kartami powodują odczyt
aktualnego storage; opóźnione `SIGNED_OUT` nie wylogowuje nowej zapisanej sesji.
Sam refresh tokenu nie zmienia snapshotu użytkownika i nie renderuje ponownie UI.

Subskrypcje SDK i AppState są współdzielone. Ostatnie odmontowanie providera
usuwa listenery oraz zatrzymuje ręcznie sterowane odświeżanie native.

## Przerwany reset hasła

Przed weryfikacją kodu resetu adapter usuwa poprzedni trwały zapis i przełącza
odczyty/zapisy SDK wyłącznie na pamięć. Zwykła sesja i recovery nie są kopiowane
do drugiego magazynu. Podczas tego procesu zdarzenia SDK i `retrySession` nie
zmieniają stanu na `signedIn`.

Zamknięcie aplikacji lub przeładowanie strony przerywa recovery: trzeba ponownie
rozpocząć reset. Nowa karta nie odtworzy tej sesji. Po zmianie hasła moduł wylogowuje
lokalnie SDK, czyści pamięć recovery i przywraca zwykły tryb magazynu. Odrzucony kod
również kończy tryb recovery. Zamknięcie pamięci recovery nie usuwa nowej zwykłej
sesji, którą inna karta mogła w międzyczasie zapisać.

## Weryfikacja

`npm.cmd test` obejmuje operacje auth, odtwarzanie/utratę sesji, spóźnione odpowiedzi,
zachowanie recovery, błędy sieci i magazynu oraz cleanup AppState przy ponownym
montowaniu. `auth-sdk.test.mjs` uruchamia rzeczywiste SDK z kontrolowanym transportem
HTTP: zapis i restart, odświeżenie wygasłej sesji oraz brak utrwalenia recovery.
Te testy nie wysyłają maili. Testy prawdziwego projektu i maili z punktu 3 są opisane
w [operacjach konta](auth-operations.md).

9 listopada 2026: zaliczono 53 testy oraz `tsc --noEmit`. Kontrola pakowania samego
modułu providera wygenerowała pakiety Android i WWW. Lint nadal nie jest zaliczony,
ponieważ repozytorium nie ma konfiguracji ESLint. Test pakowania nie zastępuje
odbioru na urządzeniu ani testów nawigacji po połączeniu pracy obu osób.

Po podłączeniu ekranów trzeba jeszcze wykonać odbiór na telefonie i w przeglądarce:
zalogowanie → zamknięcie i ponowne otwarcie, tło → powrót, brak internetu → ponowienie,
wylogowanie w drugiej karcie oraz przeładowanie strony w połowie resetu.
Ochrona API i użycie aktualnego tokenu do pobierania sklepów są opisane
w [punkcie 5](auth-api.md). `useStores` współdzieli subskrypcję modułu sesji z providerem;
działa również przed podłączeniem providera, ale wymaga prawdziwego zalogowania.

Źródła: [AsyncStorage w Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/async-storage/),
[Supabase w React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native),
[AppState](https://reactnative.dev/docs/appstate).
