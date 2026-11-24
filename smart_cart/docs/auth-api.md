# Dostęp do katalogu sklepów

Funkcja `GET /functions/v1/store-catalog` sprawdza token Bearer przez Supabase Auth. Wymaga potwierdzonego adresu e-mail. Zwraca katalog z prywatnego Storage lub odpowiedź 304 dla zgodnego ETag.

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
