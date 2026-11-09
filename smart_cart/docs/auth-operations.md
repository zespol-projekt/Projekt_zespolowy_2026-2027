# Operacje konta — punkt 3

`src/features/auth/service.ts` implementuje operacje z kontraktu na prawdziwym
kliencie `@supabase/supabase-js`. W aplikacji istnieje jedna instancja:
`import { authService, authPolicy } from '@/features/auth';`.
Formularze dostają te operacje przez gotowe `AuthProvider/useAuth` z punktu 4.
Podłączenie opisuje [instrukcja sesji](auth-session.md).

- `signUp`, `verifySignupCode`, `resendSignupCode`: rejestracja z potwierdzeniem
  kodem. Niepotwierdzone konto nie uzyskuje stanu `signedIn`.
- `signIn`: logowanie hasłem albo wynik `confirmationRequired` dla niepotwierdzonego emaila.
- `sendPasswordResetCode`, `verifyPasswordResetCode`, `setNewPassword`: odzyskiwanie
  kodem `recovery`, zmiana hasła, zakończenie lokalnej sesji i powrót do `signedOut`.
- `signOut`: jawnie lokalny zakres; anulowanie wcześniejszych wyników operacji.
- `retrySession`: sprawdzenie sesji i użytkownika w Supabase, z zachowaniem trybu recovery.

Każda operacja zwraca `AuthResult` z bezpiecznym polskim komunikatem. Email jest
przycinany i zamieniany na małe litery. Haseł i kodów nie przycinamy. Minimum nowego
hasła to 8 znaków, OTP ma 6 cyfr; limit wysyłki egzekwuje Supabase. Przy resecie
UI pokazuje neutralne „Jeśli konto istnieje, wyślemy kod odzyskiwania hasła”.
Nie wyciąga informacji o istnieniu konta z odpowiedzi rejestracji/resetu.

Operacje zmieniające sesję są wykonywane kolejno. Wylogowanie natychmiast zamyka
stan aplikacji, unieważnia wynik trwającej operacji i następnie usuwa sesję SDK.
Nowe logowanie/rejestracja/weryfikacja kodu wymaga `signedOut`. `getState()` oraz
`subscribe()` pozwalają providerowi obserwować wspólny stan; nie zawiera on tokenów.

Po zapisaniu nowego hasła błąd wylogowania ma osobny komunikat: hasło już zmieniono.
SDK 2.119.0 dla `scope: 'local'` najpierw usuwa lokalną sesję, a potem próbuje
unieważnić refresh token na serwerze. Wydany JWT może pozostać ważny do wygaśnięcia.
[Zasady wylogowania Supabase](https://supabase.com/docs/reference/javascript/auth-signout).

## Zakres bieżącego etapu

Punkt 4 dodał [trwałą zwykłą sesję, odtwarzanie i provider](auth-session.md).
Sesja odzyskiwania pozostaje wyłącznie w pamięci; restart wymaga ponowienia resetu.
Nie przechwytujemy linków — weryfikacja nadal używa kodów.
Ochrona API i uwierzytelnione pobieranie sklepów należą do punktu 5. Formularze
i podłączenie providera do nawigacji przygotowuje osoba 2. Ten etap nie zabezpiecza
jeszcze mapy ani endpointów i nie dodaje ekranów do aplikacji.

## Sprawdzenie

Z katalogu `smart_cart`:

```powershell
npm.cmd test
npx.cmd --no-install tsc --noEmit
npm.cmd run lint
```

`tests/auth.test.mjs` sprawdza zachowanie modułu przy kontrolowanych odpowiedziach
SDK: potwierdzenie, recovery, polskie błędy, walidację, lokalne wylogowanie i spóźnione
odpowiedzi. Testy nie wysyłają maili i nie wymagają wpisywania prawdziwego OTP.
W środowisku blokującym tworzenie procesów runnera można użyć
`node --test --test-isolation=none tests/*.test.mjs`.
TypeScript dopuszcza importy `.ts`, aby Node 24 uruchamiał tę samą implementację
co aplikacja bez dodatkowego kompilatora/loadera testowego.

Lint obecnie nie działa: repozytorium nie ma konfiguracji ani zależności ESLint.
Nie traktujemy tego polecenia jako zaliczonego sprawdzenia.

Rzeczywisty test integracyjny z 8–9 listopada 2026 używał `createAuthService` i klienta
SDK z ustawieniami `.env.local`. Użytkownik odebrał kod rejestracji; Supabase potwierdziło
email i utworzyło sesję. Logowanie przed potwierdzeniem wymagało kodu, po potwierdzeniu
działało hasłem, a wylogowanie usuwało sesję SDK.

Reset ukończono 9 listopada na drugim kontrolowanym koncie testowym: kod z maila
ustawił `recovery/settingPassword`, również po `retrySession`. Zapis nowego hasła
zakończył sesję. Stare hasło zostało odrzucone, nowe pozwoliło się zalogować,
a końcowe lokalne wylogowanie usunęło sesję SDK. Odrzucony kod resetu pozostawiał
`signedOut`. Pełny zestaw 27 testów automatycznych (w tym 17 auth) oraz sprawdzenie
TypeScript zakończyły się powodzeniem.
Nie zapisujemy w raporcie adresu skrzynki testowej, haseł, kodów ani tokenów.
