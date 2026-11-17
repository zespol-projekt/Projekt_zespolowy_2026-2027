import { Text } from 'react-native';
import { Screen, useUI } from '@/components/ui/Controls';
import BackButton from '@/components/navigation/BackButton';
export default function Rules() {
  const ui = useUI();
  return <Screen title="Zasady porównywania"><BackButton />
    <Text style={ui.heading}>Zgodne produkty i rzeczywista ilość</Text>
    <Text style={ui.text}>Dobieramy najtańsze produkty z tej samej szczegółowej grupy, domyślnie niezależnie od marki. Ważne cechy muszą być zgodne. Możesz samodzielnie wybrać konkretny produkt.</Text>
    <Text style={ui.text}>Kupujemy pełne opakowania pokrywające potrzebę, także kombinacje rozmiarów. Produkty luzem wyceniamy według potrzebnej masy i potwierdzonej ceny jednostkowej. Końcowy koszt zależy od rzeczywiście zważonej ilości.</Text>
    <Text style={ui.text}>Dodatkowy zakup obniżający łączny koszt jest osobną propozycją z ilością, nadwyżką i pełnym kosztem. Uwzględnimy go dopiero po Twoim wyborze dla danej sieci.</Text>
    <Text style={ui.heading}>Ceny i promocje</Text>
    <Text style={ui.text}>Ceny szacunkowe są wykluczone. Używamy ostatniej znanej potwierdzonej ceny regularnej, bez sztywnego limitu wieku. Pokazujemy datę potwierdzenia albo informację o jej braku.</Text>
    <Text style={ui.text}>Zakładamy posiadanie kart i aplikacji sieci. Liczymy tylko potwierdzone promocje ogólne, z uwzględnieniem dat, ilości i znanych limitów. Kupon może wymagać aktywacji — informujemy o tym przy ofercie. Promocje indywidualne są wykluczone. Nie znamy Twojego wcześniejszego wykorzystania limitów i nie zapewniamy kompletności wszystkich promocji.</Text>
    <Text style={ui.heading}>Brak pełnej wyceny</Text>
    <Text style={ui.text}>Pokazujemy wszystkie sieci objęte porównaniem. Jeśli brakuje choć jednej ceny lub produktu w danych, dostępne pozycje pozostają widoczne, ale nie podajemy sumy i nie uwzględniamy sieci w rankingu. Brak danych nie oznacza ceny zero ani braku produktu w sklepie.</Text>
    <Text style={ui.text}>Ceny dotyczą sieci. Mapa wskazuje placówki, ale nie potwierdza ceny ani dostępności produktu w konkretnym sklepie. Katalog uzupełniamy etapami.</Text>
  </Screen>;
}
