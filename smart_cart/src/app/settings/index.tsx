import { Link } from 'expo-router';
import { Text } from 'react-native';
import { Screen, ui } from '@/components/ui/Controls';

export default function SettingsScreen() {
  return <Screen title="Ustawienia i zasady porównania">
    <Text style={ui.heading}>Konto i listy</Text>
    <Text style={ui.text}>Listy i ulubione zapisujemy na Twoim koncie. Po zalogowaniu na innym urządzeniu odśwież listę, aby pobrać ostatnie zmiany.</Text>
    <Link href="/profile" style={ui.text}>Otwórz profil i wylogowanie →</Link>
    <Text style={ui.heading}>Jak liczymy ceny</Text>
    <Text style={ui.text}>Dobieramy najtańsze równoważne produkty, niezależnie od marki. Paczkowane kupujemy pełnymi opakowaniami; luzem wyceniamy według potrzebnej masy. Możesz zmienić ilość lub wybrać konkretny produkt.</Text>
    <Text style={ui.text}>Korzystniejszy zakup większej ilości to osobna propozycja dla danej sieci. Uwzględniamy wyłącznie potwierdzone promocje ogólne. Zakładamy posiadanie kart sieci; wymaganą aktywację zaznaczamy przy produkcie.</Text>
    <Text style={ui.text}>Ostatnia znana cena regularna nie wygasa automatycznie. Pokazujemy jej datę potwierdzenia, jeśli źródło ją udostępnia. Ceny szacunkowe są pomijane. Brak ceny choć jednej pozycji wyłącza sieć z rankingu i ukrywa sumę koszyka.</Text>
    <Text style={ui.text}>Porównujemy dane cenowe sieci. Mapa służy do znalezienia placówek; nie potwierdza ich lokalnych cen ani dostępności towaru.</Text>
  </Screen>;
}
