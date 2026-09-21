# Etap 1 — stabilność: stan implementacji

20.09.2026, lokalny kandydat 2.0.49. Etap zakończony lokalnie po odbiorze opisanym poniżej. Nie wykonano wdrożenia, połączeń SSH ani zmian na WAW1/WAW2.

## Wykonane zmiany

- Granica błędów dla aktywnego obszaru aplikacji pozostawia nawigację dostępną. Retry ponownie renderuje obszar; nie odtwarza poleceń HTTP. Utrata stanu React po błędzie pozostaje możliwa — szkice trwałe należą do etapu 2.
- Każde żądanie otrzymuje generowany na runtime `X-Request-ID`. `sendRouteError` zwraca identyfikator i kod błędu; błędy serwerowe zapisuje z identyfikatorem w logu. Obsługa backupów pokazuje referencję. Pozostałe ręcznie konstruowane błędy korzystają z nagłówka, nie wszystkie mają jeszcze rozszerzone body.
- Panel i agent reklamują protokoły wersjonowania plików, trwałych backupów, odzyskiwania restore i zasobów bezwzględnych. Widok Native backupów blokuje create/restore przy niepotwierdzonej zgodności, starym layoucie lub niedostępnej historii operacji.
- Szczegóły węzła mają kontrolę zgodności i jawny stan niedostępności. Build/commit są opcjonalnymi metadanymi `GAMEPANEL_BUILD_ID` i `GAMEPANEL_BUILD_COMMIT`; brak metadanych nie jest uzupełniany domysłem. Aktualne skrypty wdrożeniowe nie zostały zmienione, żeby je ustawiać.
- Nieznany, pusty lub niedostępny status nie jest mapowany na zatrzymaną grę. Flota nie prezentuje metryk bez czasu pomiaru ani pomiarów starszych niż 35 s jako bieżących (tolerancja zegara w przyszłość 5 s).
- Backupy zapisują autora; restart agenta oznacza niedokończony zapis wyniku jako `interrupted`, a nie zwykłą rozpoznaną awarię operacji. UI zachowuje ostrzeżenie o konieczności sprawdzenia danych.
- Backupy i transfery korzystają ze wspólnego komponentu historii: identyfikator, stan, dostępne czasy, autor i szczegóły. Historia plików jest pobierana tylko po rozwinięciu, odświeżana co 5 s i dostępna po reloadzie. Nie ma fikcyjnego Cancel ani szacowanych procentów.
- Utrata odpowiedzi na start/stop/restart/backup/restore/extract daje komunikat o niepotwierdzonym wyniku. Nie dodano automatycznego ponawiania mutacji. Rozpakowanie z utraconym statusem kieruje do zapisanej historii operacji.
- Komunikat o przyjęciu startu nie ogłasza już uruchomienia gry przed potwierdzeniem runtime.

## Odbiór Linux — zakończony lokalnie

- Rzeczywisty panel i agent w osobnych kontenerach, instalacja testowego runtime, delegacja dostępu, pliki, WebSocket, idempotencja, restart, utrata dostępności i cofnięcie uprawnień: test zakończony powodzeniem.
- Backup Native przy uruchomionym i zatrzymanym procesie; tylko `serverfiles` w archiwum, plik archiwum 0600, UID 101 po odtworzeniu i zachowana poprzednia zawartość w recovery.
- Utrata treści odpowiedzi HTTP po przyjęciu backupu, ponowienie tym samym kluczem oraz ponowne odczytanie wyniku nie tworzą drugiej operacji ani drugiego archiwum.
- Produkcyjna funkcja restore w jednorazowym workerze jest przerywana SIGKILL przed przeniesieniem starego drzewa, po nim i po wstawieniu nowego. Następnie agent jest zabijany i uruchamiany ponownie; odzyskuje stare dane i pozostawia grę zatrzymaną. Nie dodano przełączników awarii do kodu produkcyjnego.
- Prawdziwy mały tmpfs powoduje ENOSPC przy backupie i odrzucenie restore z niewystarczającą rezerwą. Brak opublikowanego niepełnego archiwum; stare dane i oryginalny backup pozostają dostępne.
- Osobne 3 testy linuksowe: ENOSPC atomowego zapisu, odmowa zapisu użytkownikowi bez uprawnień oraz rollback rozpakowywania po SIGKILL. Ponowne odzyskiwanie jest idempotentne.
- Wspólna informacja o trwającej/niepotwierdzonej operacji obejmuje backupy, pliki, instalację i power transitions. Zachowano istniejące modele backendu; nie wymyślamy wspólnych identyfikatorów dla modeli, które ich nie mają. Instalacja bez raportowanej wartości nie pokazuje sztucznego 0%.

Powtarzalne środowisko: `backend/test/integration/runtime/run-local.sh`. Skrypt buduje testowy obraz, uruchamia własny uprzywilejowany Docker-in-Docker bez socketa hosta, wykonuje testy i usuwa wyłącznie swój kontener z jego wolumenami. Wymaga lokalnego Dockera i pobrania obrazów. Nie uruchamiać go na hoście produkcyjnych gier.

Platforma odbioru: Linux/aarch64 w lokalnym Docker Desktop. Osobną bramką wdrożeniową pozostaje WAW, architektura docelowa, właściwa gra, zasoby i gotowy rollback. Przerwanie procesu nie jest fizycznym zanikiem zasilania. Live backup pozostaje best-effort.

## Walidacja tej partii

- Backend: 116 testów również na Linuxie; dodatkowo 3/3 testy awarii systemu plików i 1/1 złożony scenariusz panel–agent.
- UI etapu 1: 132 scenariusze, headless, bez screenshotów. Po dodaniu wspólnej informacji o operacjach dwie asercje kolidowały z rolą status; informacja pomocnicza ma teraz rolę note, a wszystkie 15 testów instalacji ponownie przeszło.
- Produkcyjne buildy backendu i frontendu zakończone poprawnie; `git diff --check` bez błędów.
- Nowe scenariusze obejmują lokalny retry sekcji, brak zamiany unknown na stopped, referencje błędów, niepewny wynik mutacji, wykrywanie zgodności i historię plików po reloadzie bez powtarzania mutacji.
- Fixture metryk uzupełniono o rzeczywisty czas pomiaru, a asercję komunikatu zapisu węzła zawężono do właściwego regionu. To nie są wyjątki od nowego zachowania.
- Ostrzeżenie o wielkości bundla pozostaje znane z poprzedniej walidacji; pomiary i optymalizacja należą do etapu 5.

## Końcowe potwierdzenie

Gotowy `run-local.sh` przeszedł pełny przebieg od zbudowania świeżego środowiska do usunięcia własnego kontenera i wolumenów: 116 + 3 + 1 testów/scenariuszy, bez błędów. Po rozpoczęciu etapu 2 pełny zestaw UI wzrósł do 138/138 i ponownie przeszedł. Brak aktywnych kontenerów odbioru po zakończeniu; lokalny silnik Docker pozostaje uruchomiony.
