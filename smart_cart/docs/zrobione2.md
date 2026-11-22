# Wykonane wymagania Radka — katalog, wyszukiwanie i Ulubione

Stan: 22 listopada 2026. Podsumowanie zakresu z notatki `Radek.md`, z uwzględnieniem kolejnych ustaleń w rozmowie. Opis dotyczy prac Radka i integracji z istniejącą aplikacją; nie potwierdza wykonania całego zakresu pozostałych osób.

## A. Analiza istniejącego katalogu i list — wykonane

- Prześledzono trasy, ekrany, stan aplikacji, klienta danych oraz przepływ dodawania i porównywania zakupów.
- Zachowano istniejący `ShoppingProvider`, listy zapisane na koncie i atomowe dodawanie pozycji przez API.
- Nie utworzono drugiego magazynu list ani zastępczego katalogu z przykładowymi produktami w normalnym działaniu aplikacji.

## B. Kontrakt danych z Damianem — wdrożony po stronie aplikacji

- Podłączono uzgodnione RPC: `catalog_tree`, `catalog_branch`, `catalog_search`, `catalog_group` i `catalog_product`.
- Dodano typy i walidację odpowiedzi katalogu v1, w tym identyfikatorów, liczników, cen i powiązań produktów z ofertami.
- Rozróżniono grupę zamienników i pojedynczy produkt; liczba różnych produktów jest niezależna od liczby ofert sieci.
- Obsłużono paginację, ładowanie, puste wyniki, błędy, ponowienie i brak dostępności API.
- Grupa bez aktualnych ofert, np. zapisana wcześniej w Ulubionych, otrzymuje informację o braku ofert.
- Nie zmieniano administracyjnie schematu, RLS, danych katalogu ani reguł importu we wspólnym Supabase.

## C. Kafelki i hierarchia katalogu — wykonane

- Home → Produkty i zakładka Szukaj otwierają wspólny katalog pod `/products`.
- Bez frazy wyszukiwania dostępne są kategorie i podkategorie z API, w kolejności przekazanej przez backend.
- Działa przejście kategoria → podkategoria → szczegółowa grupa → produkty i ceny sieci, m.in. Nabiał → Mleko.
- Zachowano rozróżnienie tłuszczu, laktozy oraz UHT/świeże w grupach produktów.
- Dodano informację o położeniu w katalogu i powrót między poziomami.
- Wpisane zapotrzebowanie jest zachowywane przy przechodzeniu między widokami i zmianie motywu w ramach bieżącej sesji.
- Grupy mają neutralną ikonę; rzeczywiste zdjęcie produktu jest pokazywane, jeśli API udostępnia odpowiedni adres.
- Uwzględniono długie nazwy, małe ekrany, większy tekst i dostępne etykiety przycisków.

Radek zatwierdził obecne nazwy, kolejność, ikony kategorii i układ Ulubionych w rozmowie 22 listopada 2026. Obecny wygląd zostaje.

## D. Wyszukiwanie i karty — wykonane

- Fraza z Home jest przekazywana parametrem `q` do katalogu.
- Wyszukiwanie działa globalnie, bez konieczności wcześniejszego otwierania kategorii.
- Usunięto zdublowane globalne pole wyszukiwania; Ulubione zachowują własne wyszukiwanie zapisanych grup.
- Zachowano opóźnienie wyszukiwania, anulowanie poprzednich żądań, paginację oraz ochronę przed spóźnioną odpowiedzią poprzedniej sesji.
- Grupy wielu produktów można rozwijać i zwijać. Grupa z jednym produktem pokazuje od razu kartę produktu.
- Jeden produkt jest prezentowany z ofertami wielu sieci, bez traktowania każdej ceny jako kolejnego produktu.
- Można dodać ogólną grupę albo świadomie wybrany konkretny produkt.
- Dodawanie wymaga ilości, pokazuje jednostkę i docelową listę, blokuje ponowny zapis w trakcie operacji i wyświetla wynik.
- Przy ilości dodano wyjaśnienia: `g` to masa w gramach, `ml` to objętość w mililitrach, a `szt` to liczba sztuk. Katalog, Ulubione, edycja koszyka i starszy podgląd ofert wyjaśniają jednostkę; dla gramów i mililitrów zaznaczono, że pole nie oznacza liczby opakowań. Komunikat dodania nadal podaje faktycznie zapisaną ilość i jednostkę, bez zmiany zasad wyceny.
- Dla `szt` wymagana jest liczba całkowita. Nieznany rozmiar opakowania nie jest zastępowany wymyśloną ilością ani ceną jednostkową.
- Ceny mają wskazaną podstawę; pokazano braki cen, warunki promocji i wymaganie aktywacji. Frontend nie oblicza promocji własnym algorytmem.
- Daty cen są interpretowane według źródła: `antonka`, `antonka_historia` i `tanszykoszyk` mogą pokazywać „Cena widziana DD.MM.RRRR”. `kodyzbiedry`, brak lub nierozpoznane źródło oraz pusta lub błędna data dają „Data ceny nieznana”.
- Znaczniki daty i czasu z API są prezentowane według dnia kalendarzowego `Europe/Warsaw`, także w czasie letnim. Przykład: `2026-11-17T23:00:00+00:00` daje 18.11.2026. Sama data bez czasu zachowuje swój dzień; błędny znacznik czasu nie staje się poprawną datą.

## E. Nowe Ulubione — wykonane

- Wdrożono zwartą listę z ikoną i nazwą grupy, serduszkiem, szybkim dodawaniem z ilością oraz podglądem produktów i cen.
- Ulubione zapisują wyłącznie grupy, bez przypinania sieci lub konkretnej oferty.
- Własne wyszukiwanie obejmuje pobrany zbiór zapisanych grup, a nie tylko aktualnie widoczne wiersze.
- Stan serduszka jest odświeżany między katalogiem a Ulubionymi.
- Usunięcie ulubionej grupy nie usuwa istniejącej pozycji listy zakupowej.
- Zachowano zapis na koncie i ochronę danych przy zmianie sesji, stany puste, błędy oraz ponowienie pobierania.
- Widok korzysta ze wspólnego motywu i komponentów Filipa.

Układ Ulubionych został zatwierdzony przez Radka 22 listopada 2026.

## F. Listy, Koszyk i współpraca — wykonane

- Zachowano tworzenie i wybór list, edycję ilości i konkretnego produktu oraz ponowne przeliczanie cen.
- Niepełna wycena nadal nie ma sumy i nie uczestniczy w rankingu najtańszego pełnego koszyka. Brak ceny nie jest traktowany jako zero.
- Propozycja zakupu dodatkowych sztuk pozostaje osobnym wyborem dla danej sieci.
- Zintegrowano katalog z Home, nawigacją i motywem Filipa. Zachowano jeden mechanizm motywu oraz jasny, ciemny i systemowy wariant.
- Przygotowano daty cen w zwykłym wyniku porównania i w propozycji większego zakupu. Opcjonalne `price_source` zapewnia zgodność także ze starszą odpowiedzią API bez tego pola.
- Nie zmieniano obliczania kosztów, doboru produktów ani promocji przy dodawaniu obsługi dat.

## Weryfikacja wykonanych prac

- W toku realizacji uruchamiano TypeScript, lint, testy Node oraz scenariusze przeglądarkowe katalogu, Ulubionych, list, sesji i nawigacji. Szczegóły wcześniejszych przebiegów są w `README.md`.
- Po integracji nawigacji wszystkie 52 scenariusze przeglądarkowe uzyskały wynik zaliczony w przebiegu pełnym i ponowieniach po poprawkach; nie był to jeden pełny przebieg 52/52. Zaliczone zostały również eksporty WWW, Android i iOS.
- Wcześniejszy test na rzeczywistym Supabase objął drzewo, gałąź, wyszukiwanie, grupy, własną testową listę, Ulubione i porównanie koszyka. Utworzone dane testowe użytkownika zostały usunięte. Ten test nie potwierdza najnowszych poprawek Damiana.
- Dla ostatniej zmiany dat koszyka zaliczono TypeScript, bezpośredni ESLint kodu aplikacji i zmienionego testu oraz 7 testów jednostkowych katalogu. Standardowe polecenie Expo lint przerwano po braku zakończenia.
- Pięć istniejących scenariuszy zakupowych przeszło; nowy scenariusz dat koszyka przeszedł w osobnym ponowieniu po przekroczeniu limitu podczas pierwszego otwierania strony. Sprawdzono rozpoznawane źródła, datę pobrania, brak nowego pola, pustą i błędną datę oraz propozycję większego zakupu. Testy używały fikcyjnego API.
- Radek potwierdził w rozmowie wykonanie testów na telefonie. Nie zapisano modelu urządzenia ani szczegółowego protokołu, dlatego nie przypisujemy temu potwierdzeniu testów na wszystkich platformach i urządzeniach.
- Końcowy odbiór po dodaniu wyjaśnień jednostek: TypeScript i bezpośredni ESLint kodu aplikacji oraz zmienionych testów zaliczone. Pełne `npm.cmd test`: 116 zaliczonych, 1 pominięty (Gitleaks). Wcześniejsza próba wewnątrz sandboxa nie mogła uruchomić Git w jednorazowej fixturze; standardowe polecenie poza ograniczeniem procesów zakończyło się poprawnie.
- Zestaw katalogu, Ulubionych, zakupów i nawigacji: 24/27 w pierwszym przebiegu; pozostałe 3/3 zaliczone w ponowieniu. Pierwsza próba nowego testu gramów przekroczyła limit przy `page.goto`, a nawigacja przekroczyła łączny czas scenariusza. W teście sztuk doprecyzowano selektor komunikatu błędu, aby nie dopasowywał nowej podpowiedzi. Nie zwiększano limitów i nie osłabiano oczekiwań funkcjonalnych.
- Po poprawce strefy czasowej ponownie zaliczono TypeScript, bezpośredni ESLint, 13 testów jednostkowych katalogu/klienta oraz przeglądarkowy scenariusz dat koszyka (24,2 s). Sprawdza on m.in. przejście z godziny 23:00 UTC do następnego dnia w Polsce. Test jednostkowy obejmuje też czas letni i datę bez czasu.

## Co pozostaje do zamknięcia

1. Nowe zgłoszenie do Damiana: wyszukiwanie `mleko 2% bez laktozy` na rzeczywistym API zwraca również grupy 3,2%. Szczegóły poniżej. Nie należy naprawiać tego filtrem konkretnych nazw po stronie aplikacji.
2. Radek na końcu łączy branche, wykonuje kontrole wspólnej wersji, commit i push. W tym etapie nie wykonano merge'a, commita ani pusha; zmiany aplikacji i ten raport pozostają lokalne.

## Rzeczywisty odbiór API — 22 listopada 2026

Radek zalogował się samodzielnie w osobnym oknie Chrome. Test odbył się przez zwykły interfejs aplikacji, bez odczytu haseł, tokenów, eksportu sesji ani administracji bazą. Utworzono osobną własną listę `TEST odbioru Radka 22.11.2026 R2` wyłącznie do odbioru koszyka. Utworzenie: HTTP 201; dodanie grupy 1000 ml: HTTP 200. Po teście usunięto wyłącznie tę listę: HTTP 200, następnie ponownie pobrano listy.

- `catalog_tree`: HTTP 200, poprawna odpowiedź v1, 10 kategorii.
- `mleko 3,2% bez laktozy`: HTTP 200, 2 grupy — UHT i świeże, obie bez laktozy. Wcześniej zgłoszona grupa z laktozą nie wraca w tym zapytaniu.
- `mleko uht 3,2%`: HTTP 200, grupy UHT i pojedyncze produkty, bez grup mleka świeżego.
- `mleko 2% bez laktozy`: HTTP 200, 4 grupy — UHT 2%, świeże 2%, UHT 3,2% i świeże 3,2%. Brak rozróżnienia pełnego procentu pozostaje błędem backendu do poprawy.
- `compare_basket`: HTTP 200, 5 sieci, 2 wybrane oferty, obie z polem `price_source` (`antonka` i `kodyzbiedry`) i datą `observed_at`. Wszystkie niepełne wyceny miały `total_price: null`. To potwierdza aktualny kontrakt źródła ceny na działającym API, bez odczytywania historii migracji i niezależnego audytu wszystkich sum.
- `catalog_group` dla „Mleko UHT 1,5% · bez laktozy”: HTTP 200, poprawny kontrakt v1, 8 produktów. Produkt `MLEKO UHT BEZ LAK. 1,5% WYDOJONE 6X500ml` znajduje się już w grupie bez laktozy. Potwierdzono ten konkretny przypadek poprawionego skrótu, bez audytu całego katalogu.

Po odbiorze zamknięto osobny kontekst przeglądarki i własny serwer Expo. Nie zachowano sesji ani śladu przeglądarkowego z rzeczywistym kontem. Nie zmieniano cudzych list, Ulubionych, danych produktów, cen, funkcji SQL ani RLS.

### Wiadomość do Damiana — procenty w wyszukiwaniu

> Po poprawkach sprawdziliśmy rzeczywiste `catalog_search` przez aplikację. `mleko 3,2% bez laktozy` zwraca już tylko grupy bez laktozy, a `mleko uht 3,2%` nie zwraca grup świeżych. Pozostał przypadek: `mleko 2% bez laktozy` zwraca również UHT i świeże 3,2% (łącznie 4 grupy). Sprawdź proszę normalizację procentów: 2% powinno być odróżnione od 3,2% i 3.2%, przy zachowaniu równoważności przecinka i kropki. Dodaj test regresji SQL. Nie zmieniamy filtrowania wyników po stronie frontendu ani schematu bazy.

Administracja bazą, porządkowanie kolejnych kategorii, importy produktów i cen oraz docelowe podłączenie placówek mapy do Supabase należą do odpowiednich właścicieli w zespole; nie są nowymi zadaniami frontendowymi Radka.
