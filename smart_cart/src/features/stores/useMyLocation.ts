import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import type { Coordinates } from './model';

export function useMyLocation() {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const locate = async (): Promise<Coordinates | null> => {
    if (busy.current) return null;
    busy.current = true; setRequesting(true); setMessage(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        if (active.current) setMessage('Brak zgody na lokalizację. Mapę nadal możesz przeglądać ręcznie.');
        return null;
      }
      if (!await Location.hasServicesEnabledAsync()) throw new Error('Usługa lokalizacji jest wyłączona.');
      const result = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Przekroczono czas.')), 15000); }),
      ]);
      const point = { latitude: result.coords.latitude, longitude: result.coords.longitude };
      if (!active.current) return null;
      setLocation(point); return point;
    } catch {
      if (active.current) setMessage('Nie udało się ustalić położenia. Możesz nadal przeglądać mapę lub spróbować ponownie.');
      return null;
    } finally {
      clearTimeout(timer); busy.current = false;
      if (active.current) setRequesting(false);
    }
  };
  return { location, requesting, message, locate, dismissMessage: () => setMessage(null) };
}
