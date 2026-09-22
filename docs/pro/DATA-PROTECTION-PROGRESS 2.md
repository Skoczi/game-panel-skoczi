# Etap 3 — widoczna ochrona danych

Wersja 2.0.49, praca lokalna. Panel i agent wymagają wspólnej aktualizacji przed wdrożeniem. Templates i nowe gry pozostają poza zakresem.

## Podsumowanie ochrony

- Osobne wartości: przydzielone bloki plików gry i recovery, rozmiar plików archiwów oraz wolne miejsce węzła. Nie są to procenty dysku hosta. Pomiar wykonuje się przy wejściu do sekcji i na żądanie, bez skanowania katalogów w każdym odpytywaniu historii operacji.
- Błąd pomiaru daje brak danych, nigdy fałszywe zero. Pomiar nie podąża za symbolicznym katalogiem danych, gry ani backupów. Limit pojedynczego przeglądu: 2000 wpisów.
- Nowe kopie, również z harmonogramu, zapisują prywatny rekord trybu live/offline i kontroli struktury archiwum w `data/backups/.records`. Rekord jest zapisywany atomowo z synchronizacją. Błąd zapisu rekordu nie usuwa gotowego archiwum.
- Rekord musi odpowiadać aktualnemu plikowi (nazwa, urządzenie, inode, rozmiar, mtime i ctime). Stare archiwa, zewnętrzna zmiana pliku lub brak rekordu nie oznaczają automatycznie kopii zweryfikowanej. Zmiana nazwy przez panel przenosi pasujący rekord bez zmiany daty kontroli.
- Kontrola struktury tar/gzip jest jawnie oddzielona od faktycznego odtworzenia i uruchomienia gry. Ostatnia próba restore pochodzi z trwałych zadań; historia jest ograniczona do 100 ostatnich operacji.
- Podsumowanie harmonogramów pokazuje brak aktywnej kopii i ostatnie błędy/pominięcia, bez ujawniania poleceń niestandardowych.

## Rezerwa miejsca

Backup i rozpakowywanie restore sprawdzają rezerwę 64 MiB przed pracą, co 500 ms w trakcie i przed zakończeniem. Spadek wolnego miejsca przerywa proces/pipeline; częściowy wynik jest usuwany przez istniejące ścieżki cleanup. Błąd podaje próg i odczytaną dostępną przestrzeń.

Odpytywanie nie jest rezerwacją bloków systemu plików: bardzo szybki zapis z innego procesu może wyczerpać miejsce między kontrolami. Pozostają testy rzeczywistego ENOSPC oraz atomowego zachowania starych danych.

## Ręczne sprzątanie według reguł

- Osobne liczby zachowywanych archiwów i ukończonych recovery (1–100), domyślnie 5 i 2. Nie jest to automatyczny harmonogram usuwania.
- Podgląd pokazuje dokładne nazwy do usunięcia oraz zachowywane elementy i powody. Najnowsze archiwum, ostatni pasujący rekord kontroli i nieukończone/nieznane recovery pozostają chronione. Co najmniej jedno ukończone recovery jest zachowane, jeśli istnieje.
- Potwierdzenie wymaga wpisania DELETE. Uprawnienie: `backups.delete`. Brak działającego restore jest dodatkowo wymuszany blokadą mutacji i dziennikiem odtwarzania.
- Plan jest związany z serwerem, regułami i tożsamością plików. Zmiana od czasu podglądu zwraca 409 przed usuwaniem; UI wymaga nowego podglądu.
- Usuwanie jest sekwencyjne, a nie transakcyjne. Błąd po częściowym wykonaniu informuje o liczbie usuniętych pozycji i wymaga ponownego odczytu; nie ma automatycznego ponowienia. Retencja nie zastępuje kopii poza węzłem.

## Historia plików edytora

- Zapis wersjonowanego pliku zachowuje treść przed i po zmianie, operatora oraz czas. Dotyczy edytora plików (w tym konfiguracji), nie zmian wykonywanych przez grę, terminal lub zewnętrzne narzędzia.
- Prywatny katalog `.file-history` poza montowanymi danymi gry; pliki 0600. Maksymalnie 10 wpisów na ścieżkę, 100 na serwer, 30 dni, 64 MiB łącznie. Tekst do 512 KiB na wersję.
- Snapshot powstaje przed podmianą pliku; potwierdzenie dopiero po udanym atomowym zapisie. Przerwanie pozostawia jawny stan „Save not confirmed”. Brak miejsca lub limit historii nie blokuje zapisu pliku, ale daje widoczne ostrzeżenie o braku potwierdzonego snapshotu.
- Historia wymaga `fs.read` i aktualnego dostępu do danej ścieżki. Porównanie używa lokalnego Monaco; nie wysyła treści do zewnętrznej usługi.
- Przywrócenie wczytuje poprzednią wersję do edytora. Własny szkic wymaga potwierdzenia zastąpienia. Zapis na serwer nadal używa ETag i atomowej podmiany; nowsza zmiana otwiera porównanie konfliktu.

## Poza lokalnym odbiorem

Automatyczne wysyłanie kopii poza węzeł wymaga wskazania rzeczywistego miejsca docelowego; zgodnie z audytem nie wybieramy nowej usługi na zapas. Pobieranie archiwów działa. Próby na docelowych WAW i rollback pozostają bramką wdrożenia, a uruchomienie gry po restore nie jest potwierdzane samą kontrolą archiwum.

## Odbiór lokalny etapu 3 — 21.09.2026

161/161 testów UI w headless Chromium, 130/130 testów backendu, 3/3 testy awarii magazynu i 1/1 pełna integracja Linux panel–agent. Build frontendu i backendu zakończony poprawnie. Bez zrzutów ekranu i bez wdrożenia. Etap 3 zamknięty lokalnie; zewnętrzny magazyn kopii i odbiór WAW pozostają osobnymi warunkami wdrożenia.
