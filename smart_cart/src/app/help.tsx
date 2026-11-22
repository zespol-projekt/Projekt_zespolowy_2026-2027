import { Text } from 'react-native';
import { Screen, useUI } from '@/components/ui/Controls';
import BackButton from '@/components/navigation/BackButton';
export default function Help() {
  const ui = useUI();
  return <Screen title="Pomoc"><BackButton />
    <Text style={ui.heading}>Zaplanuj listę</Text>
    <Text style={ui.text}>Otwórz Listy zakupów na Home lub Koszyk. Utwórz nazwę listy, a następnie wybierz „Dodaj produkty”. Wyszukaj grupę, rozwiń oferty i podaj potrzebną ilość. Możesz dodać najtańszy odpowiednik lub wybrać konkretny produkt.</Text>
    <Text style={ui.heading}>Zachowaj ulubione</Text>
    <Text style={ui.text}>Dodaj grupę do Ulubionych z jej ofert. Grupa jest niezależna od sieci. Twoje listy i ulubione są prywatne i zapisane na koncie. Po zmianach na innym urządzeniu odśwież widok.</Text>
    <Text style={ui.heading}>Sprawdź wynik porównania</Text>
    <Text style={ui.text}>Koszyk pokazuje dostępne wyceny i braki. Ilość oraz konkretny produkt możesz zmienić przy pozycji listy. Korzystniejszy większy zakup wymaga Twojego wyboru osobno dla każdej sieci.</Text>
    <Text style={ui.heading}>Mapa i gazetki</Text>
    <Text style={ui.text}>Mapa wyszukuje sklepy po miejscowości lub adresie. Gazetki dostępne w aplikacji przeglądasz strona po stronie; przyciskami powiększenia zmieniasz skalę, a powiększoną stronę przewijasz. Dostępność zależy od udostępnionych materiałów.</Text>
    <Text style={ui.heading}>Konto</Text>
    <Text style={ui.text}>W menu zmienisz motyw, otworzysz Profil lub wylogujesz się. Jeśli zapomnisz hasła, wybierz odzyskiwanie hasła na ekranie logowania.</Text>
  </Screen>;
}
