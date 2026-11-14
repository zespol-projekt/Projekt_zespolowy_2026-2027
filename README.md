# SMARTCART

Repozytorium zawiera aplikację, katalog placówek, migracje bazy i zadania zespołu.

- [Uruchomienie aplikacji](smart_cart/README.md) — Expo, Supabase i osobny serwer mapy.
- [Stan wdrożenia](smart_cart/docs/wdrozenie-po-audycie.md) — wykonane zmiany, testy i ograniczenia danych.
- [Baza i API](smart_cart/docs/database-context.md) oraz [utrzymanie katalogu](smart_cart/docs/utrzymanie-katalogu.md).
- [Dane placówek](dane-sklepow/README.md) — źródła i kontrola jakości; zapisane dane wymagają odświeżenia.
- [Zadania zespołu](zadania/) — Kowal, Damian, Radek i Filip. Opisują planowane prace, nie potwierdzają ich wykonania.
- [Historyczny raport logowania](docs/RAPORT_WDROZENIA_LOGOWANIA_SUPABASE.md).
- [Publikacja i kontrola sekretów](smart_cart/docs/publikacja-git.md).

Konfigurację lokalną zapisuj w ignorowanym `.env.local`, korzystając z `smart_cart/.env.example`. Rzeczywiste klucze, również publiczne klucze Supabase, nie należą do publikowanych plików.

Przed commitem uruchom `npm.cmd run check:secrets` z katalogu `smart_cart`, a po dodaniu plików do indeksu `npm.cmd run check:secrets -- --staged`. Sprawdzenie wymaga Gitleaks; brak narzędzia kończy się błędem, nie zaliczonym skanem.

Historia już opublikowanych commitów zawiera wartości kluczy/licencji stron trzecich z dawnych archiwów HTML. Ich wartości zostały usunięte z bieżących plików. Decyzja właściciela z 14 listopada 2026: pozostawić historię bez zmian i przygotować do publikacji oczyszczone bieżące pliki. Dawne wartości pozostają dostępne w starych commitach; szczegóły w instrukcji publikacji.
