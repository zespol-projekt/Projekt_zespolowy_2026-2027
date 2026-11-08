# Supabase — konfiguracja punktu 2

Status: przygotowane szablony i instrukcja. Nie potwierdzono ustawień zdalnego
projektu ani doręczania wiadomości. Sam zapis tych plików nie zmienia panelu Supabase.
W tym punkcie nie instalujemy jeszcze klienta i nie wdrażamy formularzy.

Projekt jest pracą na zaliczenie i nie ma własnej domeny. Poniżej wariant ze
skrzynką Gmail jako SMTP do niewielkiej liczby testów i prezentacji. Nie wymaga
zakupu domeny. Nadal obowiązują limity Gmail oraz ustawienia Supabase.

## 1. Wspólny projekt i Auth

Otwórz istniejący projekt zespołu w [panelu Supabase](https://supabase.com/dashboard).
Przejdź do **Authentication → Sign In / Providers**. W części **User Signups**
włącz rejestrację i wymagane potwierdzenie emaila. Ustawienia dostawcy Email
znajdziesz niżej, w **Auth Providers → Email**. Układ panelu może się różnić;
szukaj nazw pól z tabeli. Nie twórz osobnego projektu dla własnej części aplikacji.

Poniżej przyjęte wartości do ustawienia, a nie odczyt istniejącej konfiguracji.
Po zapisaniu ponownie otwórz ustawienia i wpisz odczytane wartości w ostatniej kolumnie.

| Ustawienie | Wartość do ustawienia | Odczyt z panelu |
| --- | --- | --- |
| Allow new users to sign up | Włączone | Niezweryfikowane |
| Confirm email | Włączone | Niezweryfikowane |
| Allow anonymous sign-ins | Wyłączone | Niezweryfikowane |
| Enable email provider | Włączone | Niezweryfikowane |
| Minimum password length | 8 znaków | Niezweryfikowane |
| Password requirements | Bez dodatkowego wymogu konkretnych rodzajów znaków | Niezweryfikowane |
| Email OTP length | 6 cyfr | Niezweryfikowane |
| Email OTP expiration | 600 sekund, czyli 10 minut | Niezweryfikowane |
| Rate Limits → Minimum interval per user | 60 sekund | Niezweryfikowane |
| Rate Limits → Rate limit for sending emails | 30 wiadomości na godzinę dla całego projektu | Niezweryfikowane |

**Najpierw zapisz 600 sekund, potem wklej szablony maili.** Oba zawierają informację
o ważności przez 10 minut. Jeśli zespół przyjmie inny czas, popraw oba szablony
i tę instrukcję. Jedno ustawienie ważności obejmuje potwierdzenie i odzyskiwanie.
Limity wysyłania ustaw po podłączeniu własnego SMTP. Godzinowy limit projektu
jest niezależny od odstępu między wiadomościami do jednego użytkownika.

Ustawienia i znaczenie pól: [konfiguracja Auth](https://supabase.com/docs/guides/auth/general-configuration),
[hasła](https://supabase.com/docs/guides/auth/password-security),
[ważność OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[limity](https://supabase.com/docs/guides/auth/rate-limits).

## 2. Gmail jako SMTP — bez własnej domeny

SMTP to połączenie, którym Supabase zleca wysłanie wiadomości. Domyślna usługa
Supabase wysyła tylko na adresy członków zespołu; dlatego do testu rejestracji
osoby spoza zespołu potrzebujemy własnego dostawcy SMTP.
[Ograniczenia domyślnej wysyłki](https://supabase.com/docs/guides/auth/auth-smtp).

1. Wybierz skrzynkę Gmail przeznaczoną dla projektu. Nie musi być w domenie uczelni.
2. Na tym koncie Google włącz **Weryfikację dwuetapową**.
3. Otwórz [Hasła do aplikacji](https://myaccount.google.com/apppasswords) i utwórz
   hasło dla nazwy `SMARTCART Supabase`. Google pokaże je jednorazowo.
4. W Supabase otwórz **Authentication → Email → SMTP Settings** albo **Custom SMTP**
   (adres sekcji kończy się `/auth/smtp`). Włącz własny SMTP i uzupełnij tabelę poniżej.

| Pole w Supabase | Wartość |
| --- | --- |
| Sender email address | Pełny adres wybranej skrzynki Gmail |
| Sender name | SMARTCART |
| Host | smtp.gmail.com |
| Port | 465 (SSL/TLS) |
| Username | Ten sam pełny adres Gmail co nadawca |
| Password | Wygenerowane hasło aplikacji Google |

Hasło aplikacji wpisz bezpośrednio w Supabase. Nie zapisuj go w repo ani w aplikacji.
Nie używaj w tym polu zwykłego hasła do konta Google. Po zapisaniu SMTP ustaw limity
z poprzedniej sekcji. Jeśli Google nie pokazuje opcji haseł aplikacji, sprawdź
weryfikację dwuetapową i ograniczenia konta; konta uczelniane mogą mieć tę opcję
zablokowaną. Nie wyłączaj zabezpieczeń konta, żeby uzyskać dostęp do SMTP.

To konfiguracja do małego projektu uczelnianego. Dla zwykłych kont Gmail Google
opisuje limit 500 wiadomości dziennie; nie jest to gwarancja doręczenia ani zgoda
na nieograniczone automatyczne wysyłki. Zmiana hasła konta Google unieważnia hasła
aplikacji — wtedy trzeba zaktualizować hasło SMTP w panelu Supabase.
[Hasła aplikacji Google](https://support.google.com/accounts/answer/185833),
[serwer i porty SMTP](https://developers.google.com/workspace/gmail/imap/imap-smtp),
[limity Gmail](https://support.google.com/mail/answer/22839).

## 3. Polskie wiadomości z kodem

W **Authentication → Email Templates** (czasem **Email → Templates**, `/auth/templates`)
wklej pełną zawartość odpowiednich plików do pola treści HTML i zapisz każdy szablon.

| Szablon w panelu | Temat wiadomości | Plik z treścią |
| --- | --- | --- |
| Confirm sign up | Potwierdź konto — SMARTCART | [confirm-signup.html](../supabase/email-templates/confirm-signup.html) |
| Reset password | Reset hasła — SMARTCART | [reset-password.html](../supabase/email-templates/reset-password.html) |

Zachowaj dokładnie `{{ .Token }}` — Supabase zastąpi to prawdziwym kodem. Kodów
nie wpisujemy ręcznie do szablonów. Te procesy nie wymagają linku otwierającego
Expo Go. Szablony lokalne są kopiami do wklejenia; nie są automatycznie wdrażane.
Podgląd HTML pozwala sprawdzić wygląd, ale nie potwierdza rzeczywistego doręczenia.
[Zmienne i edycja szablonów](https://supabase.com/docs/guides/auth/auth-email-templates).

## 4. Dane połączenia dla aplikacji

W **Connect** projektu znajdź Project URL i publiczny klucz **publishable**.
Klucze są też w **Settings → API Keys**. Przepisz wartości do `smart_cart/.env.local`
według [`.env.example`](../.env.example). Jeśli `.env.local` istnieje, dopisz
brakujące wpisy, zachowując obecną konfigurację sklepów.

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_UZUPELNIJ
SUPABASE_URL=https://PROJECT_REF.supabase.co
```

Oba adresy muszą wskazywać ten sam projekt. Zastąp przykłady prawdziwymi wartościami.
`.env.local` jest ignorowany przez Git. Klucze secret/admin/service_role i hasło
SMTP nie należą do aplikacji. Te zmienne zaczną być używane po wdrożeniu klienta
i ochrony API w kolejnych punktach; samo ich wpisanie nie uruchamia logowania.
[Klucze Supabase](https://supabase.com/docs/guides/api/api-keys).

## 5. Potwierdzenie konfiguracji i doręczenia

Do uzupełnienia po wykonaniu konfiguracji i testów, bez haseł, kodów i tokenów:

- Projekt / Project ref: **niezapisany**.
- Dostawca SMTP: **proponowany Gmail; połączenie niezweryfikowane**.
- Adres nadawcy projektu: **niezapisany**.
- Data sprawdzenia i osoba: **brak**.
- [ ] Wartości odczytane po zapisie uzupełniono w tabeli.
- [ ] Oba polskie szablony zapisano w panelu; czas w treści odpowiada ustawieniom.
- [ ] Kod rejestracji dotarł na kontrolowany adres spoza zespołu Supabase.
- [ ] Kod rejestracji rzeczywiście potwierdził email.
- [ ] Kod odzyskiwania dotarł na potwierdzone konto i pozwolił zmienić hasło.
- [ ] Ponowna wysyłka respektuje ustawiony odstęp i limity.

Test rejestracji i odzyskiwania wykonamy przez rzeczywiste operacje auth z punktu 3.
Nie dodajemy teraz drugiego, tymczasowego systemu logowania tylko do testu SMTP.
Sprawdź również folder spam. Zapisanie ustawień lub podgląd szablonu nie wystarcza
do zaznaczenia doręczenia. Punkt 2 pozostaje niezweryfikowany do tych testów.
