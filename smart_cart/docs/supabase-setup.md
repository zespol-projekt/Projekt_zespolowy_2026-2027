# Supabase — konfiguracja punktu 2

Status na 8 listopada 2026: użytkownik potwierdził konfigurację Gmail SMTP oraz
zapis obu szablonów w panelu. Wartości Auth i limitów odczytano z przesłanych
zrzutów ekranu. Dodatkowo odczyt `GET /auth/v1/settings` z publicznym kluczem
zakończył się HTTP 200: dostawca email i rejestracja są włączone, automatyczne
potwierdzanie emaila i konta anonimowe są wyłączone. Ten endpoint nie potwierdza
ustawień SMTP, limitów ani treści maili. Następnie, 8–9 listopada, sprawdzono
rzeczywiste doręczenie obu kodów oraz pełne operacje konta opisane
w [punkcie 3](auth-operations.md). Sam zapis tych plików nie zmienia panelu Supabase.
Klient jest już wdrożony; formularze pozostają zadaniem osoby 2.

Projekt jest pracą na zaliczenie i nie ma własnej domeny. Poniżej wariant ze
skrzynką Gmail jako SMTP do niewielkiej liczby testów i prezentacji. Nie wymaga
zakupu domeny. Nadal obowiązują limity Gmail oraz ustawienia Supabase.

## 1. Wspólny projekt i Auth

Otwórz istniejący projekt zespołu w [panelu Supabase](https://supabase.com/dashboard).
Przejdź do **Authentication → Sign In / Providers**. W części **User Signups**
włącz rejestrację i wymagane potwierdzenie emaila. Ustawienia dostawcy Email
znajdziesz niżej, w **Auth Providers → Email**. Układ panelu może się różnić;
szukaj nazw pól z tabeli. Nie twórz osobnego projektu dla własnej części aplikacji.

Ostatnia kolumna zawiera wartości widoczne na zrzutach użytkownika z 8 listopada
2026. Po kolejnych zmianach zaktualizuj tabelę na podstawie zapisanych ustawień.

| Ustawienie | Przyjęta wartość | Odczyt ze zrzutów panelu |
| --- | --- | --- |
| Allow new users to sign up | Włączone | Włączone |
| Confirm email | Włączone | Włączone |
| Allow anonymous sign-ins | Wyłączone | Wyłączone |
| Enable email provider | Włączone | Włączone |
| Minimum password length | 8 znaków | 8 |
| Password requirements | Bez dodatkowego wymogu konkretnych rodzajów znaków | Brak wybranej opcji |
| Email OTP length | 6 cyfr | 6 |
| Email OTP expiration | 600 sekund, czyli 10 minut | 600 |
| Rate Limits → Minimum interval per user | 60 sekund | 60 |
| Rate Limits → Rate limit for sending emails | 30 wiadomości na godzinę dla całego projektu | 30 |

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
SMTP nie należą do aplikacji. Klient z punktu 3 odczytuje zmienne `EXPO_PUBLIC_*`;
`SUPABASE_URL` jest używane przy ochronie API z punktu 5.
[Klucze Supabase](https://supabase.com/docs/guides/api/api-keys).

## 5. Potwierdzenie konfiguracji i doręczenia

Wyniki konfiguracji i testów, bez haseł, kodów i tokenów:

- Projekt: **smart-koszyk**, organizacja **SmartCart** (ze zrzutu); Project ref: **jhxoosqepmqdsppvkzns** (z danych Connect przekazanych przez użytkownika).
- Dostawca SMTP: **Gmail; sprawdzone doręczenie kodów rejestracji i odzyskiwania hasła**.
- Adres nadawcy projektu: **niezapisany**.
- Data i źródło potwierdzenia: **8–9 listopada 2026, zrzuty panelu, deklaracja użytkownika, odczyt publicznych ustawień Auth i rzeczywiste operacje SDK**.
- [x] Dane Connect wpisano do ignorowanego `.env.local`; oba adresy wskazują ten sam projekt.
- [x] Zapytanie do `/auth/v1/settings` potwierdziło dostępność projektu i podstawowe ustawienia Auth; nie wysyłało maila ani nie tworzyło użytkownika.
- [x] Wartości widoczne na przesłanych zrzutach uzupełniono w tabeli.
- [x] Użytkownik potwierdził zapis obu polskich szablonów; ich treść przewiduje ustawione 600 sekund.
- [x] Kod rejestracji dotarł na kontrolowany adres testowy podany przez użytkownika.
- [x] Kod rejestracji rzeczywiście potwierdził email; działało późniejsze logowanie hasłem i lokalne wylogowanie.
- [x] Kod odzyskiwania dotarł na potwierdzone konto i pozwolił zmienić hasło; stan pozostawał `recovery` do zapisania hasła.
- [x] Po zmianie hasła sesja SDK była usunięta; stare hasło odrzucono, nowe pozwoliło się zalogować, a końcowe wylogowanie znów usunęło sesję.
- [x] Ponowna wysyłka resetu zastąpiła poprzedni kod; odrzucony kod pozostawił stan `signedOut`.
- [ ] Osobny test granicy 60 sekund i limitu 30 wiadomości/h; wartości potwierdzono w panelu, bez wyczerpywania limitu podczas testu integracji.

Testy korzystają z rzeczywistych operacji auth z punktu 3. Hasła testowe są losowe
i pozostają wyłącznie w pamięci procesu testowego; kody i tokeny nie są zapisywane.
Zapisanie ustawień lub podgląd szablonu nie wystarcza do zaznaczenia doręczenia.
