import { useTheme } from '@/features/theme/ThemeProvider';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import './SearchField.css';

type SearchFieldProps = Omit<TextInputProps, 'children' | 'testID'> & {
  children?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  submit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
};

export function SearchField({ children, containerStyle, style, submit, submitLabel, submitDisabled, ...inputProps }: SearchFieldProps) {
  const { colors } = useTheme();

  return <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }, containerStyle]}>
    <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={22} tintColor={colors.muted} />
    <TextInput
      autoCorrect={false} returnKeyType="search" onSubmitEditing={submit} underlineColorAndroid="transparent" placeholderTextColor={colors.muted}
      {...inputProps}
      testID="search-field-input" style={[styles.input, { color: colors.text }, style]}
    />
    {children}
    <Pressable accessibilityRole="button" accessibilityLabel={submitLabel} accessibilityState={{ disabled: submitDisabled }}
      onPress={submit} disabled={submitDisabled} style={[styles.action, { backgroundColor: colors.secondary }]}>
      <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={20} tintColor={colors.link} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    paddingRight: 5,
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  action: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    fontSize: 16,
  },
});
