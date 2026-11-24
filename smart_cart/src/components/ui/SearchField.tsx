import { useTheme } from '@/features/theme/ThemeProvider';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import './SearchField.css';

type SearchFieldProps = Omit<TextInputProps, 'children' | 'testID'> & {
  children?: ReactNode;
  leading?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
};

export function SearchField({ children, leading, containerStyle, style, ...inputProps }: SearchFieldProps) {
  const { colors } = useTheme();

  return <View style={[styles.field, { backgroundColor: colors.input }, containerStyle]}>
    {leading}
    <TextInput
      autoCorrect={false} returnKeyType="search" underlineColorAndroid="transparent" placeholderTextColor={colors.muted}
      {...inputProps}
      testID="search-field-input" style={[styles.input, { color: colors.text }, style]}
    />
    {children}
  </View>;
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    gap: 10,
    borderRadius: 16,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    fontSize: 16,
  },
});
