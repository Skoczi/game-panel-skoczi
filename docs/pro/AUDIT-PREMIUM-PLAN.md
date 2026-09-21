# Game Panel PRO — audyt wygody, spójności i stabilności

20.09.2026. Stan: lokalny kandydat 2.0.49 po etapie A. Dokument planistyczny; nie uruchamia implementacji ani wdrożenia.

## Rekomendacja

Najpierw dopracować codzienną pracę i przewidywalność panelu, następnie udostępnić niewielkie API integracyjne. Panel już ma HTTP API dla interfejsu i protokół agentów. Potrzebujemy stabilnego kontraktu dla zewnętrznych klientów, a nie kolejnego backendu.

Największą wartość w kolejnej iteracji dadzą:

1. Jednoznaczny stan operacji i połączenia, także po odświeżeniu strony.
2. Zachowanie niezapisanej pracy i ograniczenie skutków błędu pojedynczego widoku.
3. Widoczna zgodność panelu i agentów oraz przetestowane odzyskiwanie na Linuxie.
4. Spójne kontrolki, komunikaty i układ dla codziennych zadań.
5. Wąskie API wykorzystujące te same uprawnienia, operacje i blokady.

ReHLDS, inne profile, receptury i importer Eggs pozostają na końcu. Nie zmieniamy obecnie silnika ani katalogu gier.

## Zakres i wiarygodność

Przejrzano aktualny kod interfejsu, API, obsługi błędów, połączenia realtime, agentów, zadań i edytora oraz dokumentację etapu A. Ostatnia zakończona walidacja implementacji: 115 testów backendu, 125 UI i oba buildy. W tym audycie nie powtarzano niezmienionych testów.

Nie sprawdzano produkcji, nie wykonywano screenshotów ani wizualnego przeglądu aplikacji. Ocena wyglądu dotyczy struktury komponentów i przepływów; ostateczna ocena odstępów, kontrastu i kompozycji wymaga późniejszego przeglądu wizualnego. Ostrzeżenie o wielkości bundla nie jest dowodem wolnego działania na urządzeniu użytkownika.

## Co jest już dobrą podstawą

- Lista floty ma wyszukiwanie, sortowanie, filtry i własną kolejność. Nie trzeba budować jej od nowa.
- Są wspólne przyciski, pola, modale i potwierdzenia oraz obsługa obu motywów.
- Serwer ma własny obszar roboczy, edytor z kartami, konsolę boczną i działające krótkie linki.
- Istnieją uprawnienia serwerowe, globalna tożsamość serwera oraz delegacja do agentów.
- Agent ma dziennik idempotencji; nie należy tworzyć niezależnego, konkurującego mechanizmu wykonywania poleceń.
- Etap A wprowadził trwałe zadania backupu, blokady, dzienniki odzyskiwania i ochronę zapisu plików.

## Ustalenia i ich znaczenie

| Priorytet | Ustalenie z kodu | Skutek dla użytkownika | Następna zmiana |
|---|---|---|---|
| P1 | Etap A nie przeszedł jeszcze akceptacji rzeczywistego agenta Linux; opis w `STAGE-A.md` i `DEPLOYMENT.md` | Zielone testy lokalne nie potwierdzają zachowania Docker/UID/awarii procesu na docelowej platformie | Powtarzalny test na jednorazowych danych, bez używania aktywnej gry |
| P1 | `/api/health` reklamuje kontrakty instalacji/ustawień/portów, ale nie nowe możliwości backupów i edytora; Nodes pokazuje głównie wersję | Funkcję można poznać jako niedostępną dopiero po błędzie endpointu | Rozpoznawanie możliwości i jasny komunikat „wymagana aktualizacja agenta” przed akcją |
| P1 | Backupy, transfery, instalacja, power transitions i dziennik agentów mają różne modele stanu | Różny sposób śledzenia postępu i niejednoznaczna reakcja po timeoutach | Wspólna prezentacja operacji oraz adaptery do istniejących mechanizmów |
| P2 | `useEditorSession.ts` przechowuje szkice w pamięci React; `beforeunload` ostrzega, ale nie odtwarza pracy po awarii karty | Utrata niesave'owanej pracy po crashu/przeładowaniu mimo ochrony przed konfliktem na serwerze | Odzyskiwalne szkice, przypisane do użytkownika, globalnego serwera, węzła, ścieżki i bazowej wersji |
| P2 | Główny ErrorBoundary obejmuje całą aplikację (`main.tsx`); fallback proponuje pełny reload | Błąd jednego widoku może odciąć cały panel i kontekst edytora | Granice błędów per obszar, lokalna próba ponowienia, zachowanie nawigacji i szkiców |
| P2 | `RealtimeStatusBanner` ostrzega o reconnect; flota dodatkowo odświeża się co 15 s; świeżość metryk ma osobną logikę | Brak jednego modelu „aktualne / ostatnio znane / niedostępne” | Wspólny stan świeżości z czasem pomiaru i rozdzieleniem panel–agent oraz przeglądarka–panel |
| P2 | `routeErrors.ts` zwraca tekst `{error}`, bez wspólnego kodu błędu i identyfikatora zgłoszenia | Użytkownik często nie wie, co zrobić; diagnoza wymaga szukania po logach | Kod błędu, czytelny opis, bezpieczna następna akcja i identyfikator korelacyjny |
| P2 | Idempotencja JSON jest włączana w trybie agentowym (`index.ts`); klient generuje klucze, lecz lokalny runtime nie korzysta z tego samego middleware | Nie można obiecać jednakowej obsługi powtórzeń dla przyszłego API na wszystkich węzłach | Ujednolicenie semantyki operacji i retry, bez automatycznego ponawiania niepewnego polecenia nowym kluczem |
| P2 | `backupJobs.ts` odczytuje pliki historii i dopiero potem ogranicza wynik do 100; brak osobnej retencji tych rekordów | Rosnący koszt historii przy długiej eksploatacji | Ograniczone przechowywanie metadanych i indeks/paginacja; retencja statusów oddzielona od archiwów |
| P2 | `ServerSettingsModal.tsx` ma ok. 1144 linii, `api.ts` ok. 1698; część ekranów ma własne kontrolki i klasy | Większy koszt zmian i ryzyko różnic między ekranami | Stopniowy podział przy pracach funkcjonalnych; nie przepisywanie aplikacji |
| P3 | Ostatni build: główny JS ok. 1,29 MB, edytor ok. 3,92 MB przed gzip; część sekcji już jest ładowana osobno | Potencjalny koszt pierwszego użycia i pracy na słabszym urządzeniu | Najpierw pomiar, potem ograniczenie ładowanych zależności i zbędnych aktualizacji |

P1: bramka przed szerszym udostępnieniem. P2: duża wartość dla codziennego użytkowania. P3: dalsze usprawnienie. To priorytety produktowe, nie klasyfikacja podatności.

## Plan realizacji

### Pakiet 1 — przewidywalne działanie

**Cel:** użytkownik zawsze wie, co panel wykonał, co nadal trwa i czy stan serwera jest aktualny.

- Akceptacja etapu A na izolowanym Linux Docker runtime: backup online/offline, restore, przerwanie agenta w punktach zamiany plików, rozpakowanie z rollbackiem, disk full i niepoprawne uprawnienia. WAW1 dopiero po przygotowaniu dostępu i osobnej decyzji wdrożeniowej.
- Możliwości agenta opisane kontraktem: wersjonowane zapisy plików, zadania backupów, odzyskiwanie restore, zasoby bezwzględne. UI sprawdza je przed akcją; wersja, build/commit i stan połączenia w Nodes.
- Wspólny widok operacji w istniejącym obszarze serwera: nazwa, kto uruchomił, stan, etap, czas, wynik i szczegóły. Bez sztucznych procentów, jeśli backend nie zna wielkości pracy.
- Stany: przyjęte, wykonywane, zakończone, nieudane, przerwane, wynik nieznany. „Nie można anulować” zamiast przycisku Cancel, który tylko zamyka widok.
- Jednoznaczne retry: najpierw odczyt wyniku istniejącej operacji. Nie wysyłać nowego restartu/restore automatycznie po utracie odpowiedzi.
- Rozdzielenie „gra zatrzymana”, „agent nieosiągalny” i „wyświetlam ostatni znany stan”.
- Granice błędów na poziomie sekcji oraz identyfikator błędu widoczny w UI i logu.

**Kryteria odbioru:** odświeżenie, wygaśnięcie sesji i zerwanie połączenia nie powodują ponownego wykonania mutacji; brak agenta nie zmienia statusu gry na stopped; błąd zakładki nie zamyka całego panelu; po odzyskaniu agent nie startuje gry na niezweryfikowanych danych.

**Złożoność:** średnia/duża. To pierwszy pakiet do implementacji.

### Pakiet 2 — wygodna codzienna praca i spójny wygląd

**Cel:** mniej szukania, powtarzania czynności i obaw przed utratą pracy.

- Ujednolicenie nagłówków, pasków działań, odstępów, wysokości kontrolek, komunikatów błędów i pustych widoków. Utrzymać istniejący lekki układ, motywy i wspólne komponenty.
- Jedna główna akcja w sekcji; działania rzadkie w menu. Nie usuwać użytecznych skrótów konsoli/plików.
- Niedostępny przycisk ma konkretny powód: brak uprawnienia, brak możliwości agenta, trwająca operacja albo wymagane zatrzymanie gry.
- Odzyskiwanie szkiców edytora z oznaczeniem „lokalny szkic”, limitem rozmiaru i czasem przechowywania. Brak cichego zapisu na serwer. Czyszczenie przy wylogowaniu; nie utrwalać historii terminala ani tokenów w tym mechanizmie.
- Widoczny kontekst: nazwa serwera, węzeł, status, czas aktualizacji; łatwe kopiowanie adresu połączenia i identyfikatora.
- Uporządkowany słownik akcji i stanów w jednym języku interfejsu. Nie mieszać przypadkowo tłumaczeń; pełne i18n jako osobna decyzja.
- Mobilnie: kluczowe działania dostępne bez przewijania tabel w poziomie, czytelne formularze i bezpieczne potwierdzenia. Obsługa klawiaturą i przewidywalny powrót focusu.
- Opcjonalnie po podstawach: ostatnio używane/ulubione serwery. Globalna paleta poleceń dopiero jeśli realnie skraca nawigację.

**Kryteria odbioru:** backup z nazwą, odtworzenie szkicu, odnalezienie błędu operacji i zmiana węzła przechodzą scenariusze E2E na desktop/mobile; oba motywy i klawiatura przechodzą przegląd; nie ma modali z różną semantyką tego samego działania.

**Złożoność:** średnia, do dzielenia na małe zmiany. Nie wymaga nowego design systemu.

### Pakiet 3 — widoczna ochrona danych

**Cel:** wiadomo nie tylko, że backup istnieje, ale czy można na nim polegać i ile miejsca zajmuje.

- Podsumowanie: ostatnia udana kopia, live/offline, wynik walidacji archiwum, czas ostatniej faktycznej próby odtworzenia oraz stan harmonogramu.
- Nie nazywać samego sprawdzenia tar/gzip „przetestowanym restore”. To różne poziomy pewności.
- Osobne rozmiary: pliki gry, archiwa, katalogi recovery i wolne miejsce węzła.
- Ochrona rezerwy dyskowej przed i podczas operacji; błąd ma wskazywać wymaganą/pozostałą przestrzeń, jeśli da się ją rzetelnie określić.
- Retencja archiwów i recovery jako dwie osobne reguły, z podglądem planowanego usunięcia. Nie usuwać kopii używanej przez operację ani jedynego wskazanego punktu odzyskania.
- Krótka historia konfiguracji: autor, czas, diff, przywrócenie poprzedniej treści przez tę samą kontrolę konfliktów.
- Kopia poza węzłem po zdefiniowaniu realnego miejsca docelowego; nie wybierać teraz nowej usługi „na zapas”.

**Kryteria odbioru:** operator rozpoznaje brak działającego harmonogramu i rosnący recovery storage bez terminala; retencja daje przewidywalny plan; odtworzenie konfiguracji nie nadpisuje nowszych zmian bez ostrzeżenia.

**Złożoność:** średnia/duża. Historię konfiguracji można dostarczyć wcześniej jako małą, samodzielną funkcję.

### Pakiet 4 — API integracyjne v1

**Decyzja:** warto je przygotować. MVP po ustabilizowaniu modelu operacji z pakietu 1; może powstawać niezależnie od części kosmetycznej pakietu 2. Dokumentację kontraktu można rozpocząć wcześniej.

Pierwsze sensowne zastosowania:

- zewnętrzny monitoring stanu serwerów i węzłów;
- skrypt wykonujący nazwany backup przed zaplanowaną zmianą;
- późniejszy bot dla zamkniętej grupy, korzystający z ograniczonych uprawnień.

Nie zakładamy teraz konkretnej integracji Discord ani żadnego wysyłania wiadomości.

**Proponowany zakres pierwszej wersji:**

| Operacja | Proponowana ścieżka |
|---|---|
| Lista dostępnych serwerów | `GET /api/v1/servers` |
| Stan i możliwości serwera | `GET /api/v1/servers/{serverId}` |
| Aktualne zasoby, jednostki, czas pomiaru | `GET /api/v1/servers/{serverId}/resources` |
| Lista backupów i ich metadane | `GET /api/v1/servers/{serverId}/backups` |
| Utworzenie nazwanego backupu | `POST /api/v1/servers/{serverId}/backups` |
| Wynik operacji | `GET /api/v1/operations/{operationId}` |

To projekt kontraktu, nie istniejące endpointy. `serverId` ma oznaczać globalną, stabilną tożsamość serwera, nie lokalny numer kontenera na węźle.

**Wymagania:**

- Klucze integracyjne z nazwą, wygaśnięciem, odwołaniem i ostatnim użyciem; jawny sekret pokazany tylko przy utworzeniu, przechowywany jako skrót.
- Dostęp to przecięcie zakresów tokenu i aktualnych uprawnień właściciela. Odebranie dostępu do serwera obowiązuje także istniejący token. Żadnych kluczy root do zwykłego monitoringu.
- Wspólne serwisy wykonawcze, blokady i dzienniki z interfejsem; brak drugiej implementacji backupu.
- Paginacja, UTC, jawne jednostki, trwałe identyfikatory, stabilne kody błędów oraz identyfikator żądania.
- Mutacje z kluczem idempotencji i odpowiedzią 202 wskazującą operację. Identyczna semantyka lokalnie i na agencie.
- Limity żądań zapewniające dostępność panelu, rozsądne limity równoległych zadań.
- OpenAPI, gotowe przykłady curl i testy kontraktu. Początkowo bez osobnego SDK i bez rozbudowanego portalu developerskiego.
- Integracje łączą się z panelem; protokół i poświadczenia agentów pozostają wewnętrzne.

**Po sprawdzeniu MVP:** start/stop/restart z odpowiednimi zakresami i rejestrem aktora. Webhooki dopiero dla potrzebnego odbiorcy: podpis, identyfikator zdarzenia, kolejka, ograniczone retry i historia doręczeń. Klient musi tolerować ponowne doręczenie.

**Poza MVP:** restore przez zewnętrzne API, terminal, dowolne komendy, zapisy plików, tworzenie/usuwanie serwerów, zarządzanie użytkownikami i instalatorami. Są możliwe później, ale wymagają konkretnych zastosowań i testów.

**Kryteria odbioru:** przykład curl wykonuje backup i pobiera wynik; podwójne wysłanie tego samego żądania tworzy jedną operację; token jednego serwera nie odczytuje drugiego; odebranie uprawnienia działa natychmiast; rozłączenie nie wymusza wysłania nowej mutacji.

**Złożoność:** średnia po pakiecie 1; duża, jeśli próbować od razu wystawić cały panel.

### Pakiet 5 — wydajność i przygotowanie wydania

- Zmierzyć start panelu, wejście w serwer, pierwsze otwarcie edytora i reakcję konsoli przy dużym strumieniu logów na ustalonym profilu urządzenia/sieci.
- Dopiero na podstawie pomiarów poprawiać podział paczek, subskrypcje, odpytywanie i renderowanie dużych list. Ładowanie leniwe już istnieje — sprawdzić faktyczny graf zależności zamiast dodawać je ponownie wszędzie.
- Ustalić budżety regresji po pomiarze bazowym, np. nie pogarszać czasu kluczowej interakcji o więcej niż 10% bez wyjaśnienia. Nie deklarować teraz niezmierzonego „panel ładuje się w sekundę”.
- Krótkie scenariusze odbioru: normalne działanie, stary agent, offline, powolna odpowiedź, brak uprawnień, disk full i restart procesu.
- Jeden identyfikowalny commit kandydata, spójne wersje panelu i agentów, changelog, paczka rollbacku i dopiero później materiały ze screenshotami.

Nie nadawać kolejnych numerów wersji samemu planowi. Numery `2.0.X` przypisujemy gotowym, sprawdzonym pakietom.

## Kolejność i decyzje

1. **Teraz:** pakiet 1 oraz doprecyzowanie kontraktu API; bez implementacji nowych gier.
2. **Następnie:** pakiet 2, historia konfiguracji i podstawowy widok ochrony danych z pakietu 3.
3. **Potem:** wąskie API v1 na wspólnych operacjach, gdy jest gotowy pierwszy rzeczywisty klient integracji.
4. **Przed dużym update:** pełna akceptacja, pomiary i gotowy rollback; aktualizacja WAW1 nadal konieczna.
5. **Na końcu:** profile i templates, w tym ReHLDS.

Nie ma dziś uzasadnienia dla mikroserwisów, Kubernetes, GraphQL, nowej bazy czy wymiany istniejących komponentów UI. Podobnie wielki katalog nowych funkcji, animowany dashboard i uniwersalny importer nie rozwiązują potwierdzonych problemów codziennej obsługi.

Pierwszy pakiet powinien zakończyć się konkretnym doświadczeniem: operator uruchamia backup, zamyka kartę, wraca po przerwie i widzi prawdziwy wynik; gdy agent jest niedostępny lub niezgodny, panel jasno to pokazuje i nie wymusza zgadywania.
