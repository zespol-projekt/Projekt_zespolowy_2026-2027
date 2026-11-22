import { router } from 'expo-router';
import { Button } from '@/components/ui/Controls';
export default function BackButton() {
  return <Button secondary title="Wróć" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />;
}
