# Kontrakt logowania — punkt 1

Status: przygotowane typy i zasady współpracy; [operacje Supabase](auth-operations.md)
są zaimplementowane w punkcie 3. Provider/hook, trwała sesja, ekrany i ochrona API
pozostają do wdrożenia w kolejnych punktach.
Źródłem typów jest [`src/features/auth/types.ts`](../src/features/auth/types.ts).
Import: `import type { AuthContextValue } from '@/features/auth/types';`.

## Podział pracy

- Osoba 1 implementuje klienta w `src/lib/supabase.ts`, operacje i sesję w
  `src/features/auth`, konfigurację Supabase, ochronę API oraz pobieranie sklepów.
- Docelowo `src/features/auth/AuthProvider.tsx` udostępni `AuthProvider` i `useAuth`.
  Hook zwróci `AuthContextValue`. Te eksporty jeszcze nie istnieją.
- Osoba 2 przygotowuje formularze, profil i nawigację. Podłącza jeden provider
  do głównego layoutu i korzysta z hooka, bez drugiego klienta ani magazynu sesji.
- Moduł auth nie wywołuje routera. Ekrany reagują na wyniki operacji i wspólny stan.
  Tymczasowe zastępniki są dopuszczalne wyłącznie w pracy nad UI i testach.

## Wyniki operacji

Każda operacja zwraca `AuthResult`: `{ ok: true, data }` albo
`{ ok: false, error }`. Dla wyniku bez danych `data` to `undefined`.
Przewidywalne błędy usługi trafiają do tego wyniku, nie do surowych wyjątków UI.
`error.code` służy do sterowania zachowaniem, a `error.message` jest bezpiecznym
polskim komunikatem. `retryAfterSeconds` pochodzi z odpowiedzi serwera, jeśli
jest dostępne. UI nie rozpoznaje błędów po treści angielskich zdań.

| Operacja | Wynik sukcesu / obowiązek implementacji |
| --- | --- |
| `signUp(email, password)` | `confirmationRequired` i email; bez dostępu do aplikacji. Potwierdzenie hasła sprawdza formularz. |
| `verifySignupCode(email, code)` | `signedIn` z prawdziwą sesją albo `signInRequired`: email potwierdzony, należy zalogować się hasłem. |
| `resendSignupCode(email)` | Ponowna wysyłka kodu rejestracji z respektowaniem limitów. Nie zmienia emaila konta. |
| `signIn(email, password)` | `signedIn` albo `confirmationRequired` i email, gdy trzeba dokończyć potwierdzanie. |
| `sendPasswordResetCode(email)` | Neutralna odpowiedź: „Jeśli konto istnieje, wyślemy kod odzyskiwania hasła”. Ta sama funkcja służy do ponownej wysyłki. |
| `verifyPasswordResetCode(email, code)` | Kod sprawdzony w procesie `recovery`; stan `recovery` z fazą `settingPassword`. |
| `setNewPassword(password)` | Zapis hasła, zakończenie lokalnej sesji odzyskiwania, stan `signedOut`. Dopiero pełne powodzenie oznacza sukces. |
| `signOut()` | Wylogowanie tylko z bieżącego urządzenia/przeglądarki, usunięcie lokalnej sesji i stanu użytkownika. |
| `retrySession()` | Ponowne sprawdzenie/odtworzenie sesji po błędzie; aktualizacja wspólnego stanu. |

Hasła nie są automatycznie przycinane ani przechowywane; dotyczy to też kodów.
Poprawienie adresu podczas rejestracji uruchamia `signUp` z nowym emailem i hasłem,
nie tylko zmianę podpisu na ekranie. Moduł stosuje jedną politykę normalizacji emaila.
Ważność kodów, limity i wymagania haseł są zapisane w [konfiguracji Supabase](supabase-setup.md).
Eksport `authPolicy` z `@/features/auth` udostępnia je formularzom. Nowy proces
rejestracji/logowania/weryfikacji kodu można rozpocząć w stanie `signedOut`;
bieżącą sesję lub rozpoczęte odzyskiwanie należy wcześniej zakończyć przez `signOut`.

## Stan i nawigacja

- `initializing`: neutralne ładowanie; chronione ekrany pozostają zamknięte.
- `signedOut`: formularze logowania, rejestracji, potwierdzenia i rozpoczęcia resetu.
- `signedIn`: użytkownik z potwierdzonym emailem; dostępne `user.id` i `user.email`.
- `recovery`: dostęp wyłącznie do procesu resetu. Faza `verifyingCode` jest ustawiana
  **przed** weryfikacją OTP; `settingPassword` dopiero po powodzeniu. Zdarzenie
  logowania z Supabase w tym procesie nie może zmienić stanu na `signedIn`.
  Odrzucony kod przywraca `signedOut`; formularz kodu pozostaje otwarty i pozwala
  ponowić próbę. Nie przechodzimy wtedy do ustawiania hasła.
- `error`: komunikat i ponowienie przez `retrySession`, bez otwierania aplikacji.

Po restarcie zwykła sesja jest odtwarzana. Przerwany reset może wznowić wyłącznie
formularz nowego hasła po sprawdzeniu sesji odzyskiwania albo zakończyć tę sesję
i wrócić do logowania. Timeout nie usuwa automatycznie zapisanej, poprawnej sesji.
Stan formularza (pola, oczekiwanie, komunikat sukcesu) należy do ekranu. Dane
zalogowanego użytkownika pochodzą wyłącznie ze wspólnego stanu.

## Token API, błędy 401 i anulowanie

`AuthSessionAccess` będzie udostępniony warstwie pobierania danych przez moduł
sesji osoby 1. `getAccessToken()` zwraca aktualny token wyłącznie dla `signedIn`.
Nie przechowujemy jego kopii w formularzu, parametrach trasy ani dokumencie mapy.

Po `401` wywołujemy `refreshAfterUnauthorized` z odrzuconym tokenem. Jeśli token
został już odświeżony, metoda zwraca aktualny. W innym przypadku współbieżne
wywołania współdzielą jedno odświeżenie. Żądanie danych można ponowić tylko raz.
Kolejne `401` wywołuje `invalidateSession` z odrzuconym tokenem. Metoda kończy
lokalną sesję tylko wtedy, gdy token nadal jest aktualny; spóźnione `401` nie może
wylogować nowej sesji. Awaria sieci/usługi daje kontrolowany błąd i możliwość
ponowienia, bez pętli żądań ani udawanego zalogowania.

Formularz blokuje powtórne wysłanie podczas oczekiwania. Po zamknięciu formularza
ignoruje opóźniony wynik i nie zmienia nawigacji; samo zamknięcie nie cofa operacji
wysłanej do Supabase. Wylogowanie lub zmiana sesji unieważnia starsze operacje
we wspólnym module, również przy ponownym logowaniu na to samo konto. Opóźniona
odpowiedź nie może przywrócić poprzedniej sesji. Pobieranie sklepów jest wtedy
anulowane, a dane poprzedniego użytkownika czyszczone. Zmiana samego tokenu przy
odświeżeniu nie uruchamia ponownego pobierania całego katalogu.

## Co dalej

Do zamknięcia uzgodnień punktu 1 przekaż osobie 2 ten dokument i typy. Może według
nich przygotować formularze później. Przy scalaniu sprawdźcie zgodność importów
i wyników. Kolejne punkty dodadzą rzeczywistą implementację oraz jej testy.

W panelu Supabase nic nie trzeba ustawiać dla samego kontraktu. Następny krok to
potwierdzenie dostępu do wspólnego projektu i [konfiguracja Auth oraz SMTP](supabase-setup.md).
Kontrakt nie zabezpiecza obecnie tras ani API. Zabezpieczone API i obsługę logowania
należy wdrożyć wspólnie, gdy ekrany osoby 2 będą gotowe.
