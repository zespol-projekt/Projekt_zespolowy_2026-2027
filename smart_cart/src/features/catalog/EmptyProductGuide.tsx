import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';
import { useUI } from '@/components/ui/Controls';
import { useTheme } from '@/features/theme/ThemeProvider';

export const favoriteTileSize = { width: '47%', maxWidth: 250, aspectRatio: 0.72 } as const;

export function EmptyProductGuide({ message }: { message: string }) {
  const ui = useUI();
  const { colors } = useTheme();
  return <View style={{ flexGrow: 1, alignItems: 'center', gap: 14 }}>
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
      {[1, 2].map(tile => <View key={tile} aria-hidden style={[ui.card, favoriteTileSize, { opacity: 0.65 }]}>
        <View style={{ flex: 1, borderRadius: 10, backgroundColor: colors.input,
          alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name={{ ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' }}
            size={42} tintColor={colors.muted} style={{ opacity: 0.42 }} />
        </View>
        <View style={{ width: '78%', height: 9, borderRadius: 5, backgroundColor: colors.border }} />
        <View style={{ width: '42%', height: 13, borderRadius: 6, backgroundColor: colors.muted, opacity: 0.45 }} />
      </View>)}
      </View>
      <Text style={[ui.text, { textAlign: 'center' }]}>{message}</Text>
      <View pointerEvents="none" aria-hidden style={{ alignSelf: 'stretch', flexGrow: 1, minHeight: 64 }}>
        <Image source={require('@/assets/images/search-arrow.svg')} contentFit="fill" accessible={false}
          style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', right: '27%' }} />
      </View>
    </View>;
}
