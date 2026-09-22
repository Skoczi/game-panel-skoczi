# Etap 2 — wygoda codziennej pracy

Zakończony lokalnie 21.09.2026 po odbiorze etapu 1. Wersja 2.0.49 pozostaje lokalnym kandydatem.

## Odzyskiwanie szkiców edytora

- Szkic tekstu jest zapisywany tylko lokalnie. Nie wykonuje autosave do serwera.
- Klucz obejmuje użytkownika, globalne ID serwera, węzeł, katalog główny, ścieżkę i bazową wersję pliku. Numeryczne ID runtime nie jest wystarczającą tożsamością.
- W widoku administracyjnym bez globalnego kontekstu serwera mechanizm nie zapisuje szkiców. Edycja w pamięci i ostrzeżenie przed utratą zmian nadal działają.
- Ponowne otwarcie pliku po reloadzie przywraca tekst. Gdy plik na serwerze się zmienił, zapis pozostaje zablokowany do świadomego zaakceptowania aktualnej podstawy porównania; późniejszy zapis nadal wymaga zgodnej wersji.
- Szkic wygasa po 24 h. Maksymalnie 20 zapisów i 2 MiB łącznej treści JSON; pojedynczy zapis do 512 KiB wraz z bazową treścią i metadanymi. To limit odzyskiwania w przeglądarce, nie limit edycji na serwerze.
- Odmowa zapisu lub przekroczenie limitu pozostawia poprzedni odzyskiwalny szkic i wyświetla informację, że aktualna treść nie jest zabezpieczona lokalnie.
- Udany zapis, jawne odrzucenie zmian i wylogowanie czyszczą odpowiednie szkice. Wylogowanie unieważnia także zapisy ze starszych otwartych kart przez wspólny znacznik sesji szkiców.
- Mechanizm nie kopiuje tokenów aplikacji ani historii terminala. Szkice zawierają edytowaną treść pliku i są przypisane do bieżącego origin przeglądarki.

## Druga partia — kontekst i dostępność działań

- Wspólny nagłówek sekcji backupów i harmonogramów, oparty na obecnych komponentach i stylach. Pobieranie archiwum jest akcją neutralną, tworzenie kopii pozostaje główną.
- Powody blokady tworzenia/odtwarzania kopii, zasilania i zapisu edytora są widoczne w treści i powiązane z kontrolką przez `aria-describedby`. Odświeżenie harmonogramów ma nazwę dostępną dla czytnika ekranu.
- Native backup pozostaje dostępny podczas działania gry. Restore wymaga potwierdzonego zatrzymania; nieznany stan nie daje zgody na restore. Backend nadal wykonuje własną kontrolę stanu i blokad.
- Brak potwierdzonego odczytu historii zadań blokuje nową operację Native do odzyskania łączności. Ponowne sprawdzenie nie wysyła mutacji.
- Każda zakładka serwera pokazuje węzeł, status, kopiowanie identyfikatora i adresu. Przy zgodnym globalnym kontekście kopiowany jest UUID; bez niego jawnie pokazywane jest ID runtime, a kopiowana para węzeł/runtime.
- Czas opisuje ostatnią próbkę historii wykresów, a nie potwierdzenie aktualności wszystkich danych serwera. Po 35 s próbka ma oznaczenie stale; brak lub czas z przyszłości pokazuje unavailable.

## Odbiór końcowy etapu 2

Przejrzano wspólne podpowiedzi, formularz harmonogramów i puste widoki plików/backupów/harmonogramów. Podpowiedzi obsługują focus, Enter i Escape oraz mieszczą się przy krawędzi ekranu. Formularz poleceń ma powiązane etykiety; błędy przełączania harmonogramu są jawne i nie zmieniają pozornie jego stanu. Błąd odczytu nie jest prezentowany jako pusta lista. Brak nowego design systemu i zmian funkcji gier.

## Walidacja pierwszej partii

Pełny zestaw UI: **138/138**; build produkcyjny frontendu zakończony poprawnie. Nowe 6 scenariuszy obejmuje izolację i wygasanie szkiców, limity, błędy storage, czyszczenie przy wylogowaniu oraz odzyskiwanie po reloadzie z niezmienionym i zmienionym plikiem serwera. Testy odzyskiwania potwierdzają brak automatycznego zapisu do API.

W trakcie testów poprawiono również synchronizację wartości Monaco: odbywa się przy zatwierdzaniu renderu, przed kolejnym zdarzeniem wejścia, żeby opóźniony efekt nie przywracał starszego tekstu. Ponowny zestaw 49 scenariuszy edytora/obszaru serwera przeszedł, następnie cały zestaw 138 scenariuszy. Bez screenshotów i bez zmian na produkcji.

## Walidacja drugiej partii

Pełny zestaw UI: **146/146** (21.09.2026), po zmianach wspólnego potwierdzenia. Nowe scenariusze obejmują trzy stany serwera przy restore, przerwę w pobieraniu historii operacji i recheck, kopiowanie identyfikatora/adresu oraz anulowanie potwierdzenia klawiaturą z powrotem focusu. Kontekst i potwierdzenie sprawdzono mobilnie w obu motywach. Kontrolki potwierdzenia używają AppButton/AppInput, etykieta wskazuje pole, a przycisk zamknięcia ma nazwę dostępną dla czytnika ekranu. Akcje zawijają się na wąskim ekranie.

Pierwsza próba wykryła brak ręcznego recheck po błędzie historii zadań mimo zgodnego agenta; dodano dostęp do ponownego sprawdzenia także w tym stanie. Dwa wcześniej przerwane scenariusze przeszły osobno i w pełnym końcowym zestawie. Nie przypisano im niepotwierdzonej przyczyny.

Testy wykonywano headless, bez screenshotów i bez otwierania okien. Ta partia poprzedzała odbiór końcowy.

## Odbiór końcowy — 21.09.2026

**153/153 testów UI**, build frontendu i `git diff --check` zakończone poprawnie. Nowe 7 scenariuszy obejmuje podpowiedzi w obu motywach, błędy i odzyskanie odczytu list, niepotwierdzone przełączenie harmonogramu, zachowanie formularza po błędzie oraz rozróżnienie pustych i ukrytych plików. Testy układu i interakcji wykonywano headless, bez screenshotów; nie jest to ocena graficzna z obrazów. Ostrzeżenie bundlera o rozmiarze paczek pozostaje do pomiarów etapu 5.
