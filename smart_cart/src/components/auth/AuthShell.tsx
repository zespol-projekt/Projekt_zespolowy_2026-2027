import type { PropsWithChildren, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

type AuthShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  footer?: ReactNode;
}>;

export function AuthShell({ title, subtitle, footer, children }: AuthShellProps) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.form}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F2",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E5E8E2",
    padding: 24,
    shadowColor: "#152D43",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#252B30",
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#606660",
  },
  form: {
    marginTop: 22,
    gap: 14,
  },
  footer: {
    marginTop: 20,
  },
});
