import { Link, router, usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMemo, useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import BottomBar from "@/components/navigation/BottomBar";
import { authPolicy, AuthProvider, useAuth } from "@/features/auth";

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { state, signIn, signUp, verifySignupCode, resendSignupCode, sendPasswordResetCode, verifyPasswordResetCode, setNewPassword, retrySession } = useAuth();
  const pathname = usePathname();
  const isAuthScreen = pathname.startsWith("/auth") || pathname === "/" && state.status !== "signedIn";
  const isStores = pathname.startsWith("/stores");

  if (state.status === "initializing") {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#07966D" />
          <Text style={styles.loadingText}>Ładowanie aplikacji…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === "error") {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Nie udało się odtworzyć sesji</Text>
          <Text style={styles.errorText}>{state.error.message}</Text>
          <Pressable style={styles.buttonPrimary} onPress={() => void retrySession()}>
            <Text style={styles.buttonPrimaryText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status !== "signedIn") {
    return <AuthUI />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      <View style={isAuthScreen ? styles.hidden : isWeb ? styles.webLayout : styles.mobileLayout}>
        <View style={isWeb ? styles.webMain : styles.mobileMain}>
          <View style={styles.header}>
            <Link href="/" asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="SMARTCART — ekran startowy"
                style={styles.homeButton}
              >
                <Text style={styles.logo}>SMARTCART</Text>
              </Pressable>
            </Link>

            <Pressable
              style={styles.settingsButton}
              accessibilityRole="button"
              accessibilityLabel="Ustawienia"
              onPress={() => router.navigate("/settings")}
            >
              <SymbolView
                name={{
                  ios: "gearshape",
                  android: "settings",
                  web: "settings",
                }}
                size={24}
                tintColor="#343A40"
              />
            </Pressable>
          </View>

          {!isStores && (
            <View style={styles.searchBar}>
              <SymbolView
                name={{
                  ios: "magnifyingglass",
                  android: "search",
                  web: "search",
                }}
                size={22}
                tintColor="#777B78"
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Szukaj produktów..."
                placeholderTextColor="#777B78"
                accessibilityLabel="Szukaj produktów"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                underlineColorAndroid="transparent"
              />
            </View>
          )}

          <View style={styles.content}>
            <Tabs
              backBehavior="history"
              tabBar={(props) => <BottomBar {...props} />}
              screenOptions={{
                headerShown: false,
                sceneStyle: { backgroundColor: "#F7F7F2" },
              }}
            >
              <Tabs.Screen name="stores" options={{ title: "Sklepy" }} />
              <Tabs.Screen name="favorites" options={{ title: "Ulubione" }} />
              <Tabs.Screen name="cart" options={{ title: "Koszyk" }} />
              <Tabs.Screen name="products" options={{ title: "Produkty" }} />
              <Tabs.Screen name="profile" options={{ title: "Profil" }} />
              <Tabs.Screen name="settings" options={{ title: "Ustawienia" }} />
              <Tabs.Screen name="index" options={{ title: "Start" }} />
            </Tabs>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function AuthUI() {
  const { state, signIn, signUp, verifySignupCode, resendSignupCode, sendPasswordResetCode, verifyPasswordResetCode, setNewPassword, signOut } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "confirm" | "reset" | "resetCode" | "newPassword">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailForFlow, setEmailForFlow] = useState("");
  const passwordHasError = password.length > 0 && password.length < authPolicy.minimumPasswordLength;
  const repeatPasswordHasError = repeatPassword.length > 0 && repeatPassword !== password;
  const authMode = useMemo(() => {
    if (state.status === "recovery") return state.phase === "settingPassword" ? "newPassword" : "resetCode";
    return mode;
  }, [mode, state]);

  const handleResetToSignIn = async () => {
    if (state.status === "recovery") {
      await signOut();
      return;
    }
    setMode("signin");
    setMessage(null);
    setPassword("");
    setRepeatPassword("");
    setCode("");
  };

  const submitSignIn = async () => {
    if (!email.trim() || !password) {
      setMessage("Podaj email i hasło.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await signIn(email.trim(), password);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    if (result.data.status === "confirmationRequired") {
      setEmailForFlow(result.data.email);
      setMode("confirm");
      setMessage("Konto wymaga potwierdzenia emaila. Wpisz kod z wiadomości.");
      return;
    }

    setMessage(null);
  };

  const submitSignUp = async () => {
    if (!email.trim() || !password || !repeatPassword) {
      setMessage("Uzupełnij wszystkie pola.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Podaj poprawny adres email.");
      return;
    }
    if (password.length < authPolicy.minimumPasswordLength) {
      setMessage(`Hasło musi mieć co najmniej ${authPolicy.minimumPasswordLength} znaków.`);
      return;
    }
    if (password !== repeatPassword) {
      setMessage("Hasła nie są takie same.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await signUp(email.trim(), password);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    setEmailForFlow(result.data.email);
    setMode("confirm");
    setMessage("Na adres e-mail wysłano kod aktywacji. Wpisz go poniżej.");
  };

  const submitConfirm = async () => {
    if (!emailForFlow && !email.trim()) {
      setMessage("Brak adresu email do weryfikacji.");
      return;
    }
    if (!/^[0-9]{6}$/.test(code)) {
      setMessage("Kod musi składać się z 6 cyfr.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await verifySignupCode((emailForFlow || email).trim(), code);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    if (result.data.status === "signInRequired") {
      setMode("signin");
      setMessage("Email potwierdzony. Zaloguj się hasłem.");
      setPassword("");
      return;
    }

    setMessage(null);
  };

  const submitResetRequest = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Podaj poprawny adres email.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await sendPasswordResetCode(email.trim());
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    setMode("resetCode");
    setMessage("Jeśli konto istnieje, wysłaliśmy kod odzyskiwania hasła.");
  };

  const submitResetCode = async () => {
    if (!email.trim() || !/^[0-9]{6}$/.test(code)) {
      setMessage("Podaj poprawny 6-cyfrowy kod.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await verifyPasswordResetCode(email.trim(), code);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    setMode("newPassword");
    setMessage("Kod poprawny. Ustaw nowe hasło.");
  };

  const submitNewPassword = async () => {
    if (!password || !repeatPassword) {
      setMessage("Wpisz i potwierdź nowe hasło.");
      return;
    }
    if (password.length < authPolicy.minimumPasswordLength) {
      setMessage(`Hasło musi mieć co najmniej ${authPolicy.minimumPasswordLength} znaków.`);
      return;
    }
    if (password !== repeatPassword) {
      setMessage("Nowe hasła nie są takie same.");
      return;
    }

    setPending(true);
    setMessage(null);
    const result = await setNewPassword(password);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    setMode("signin");
    setPassword("");
    setRepeatPassword("");
    setMessage("Hasło zostało zmienione. Zaloguj się nowym hasłem.");
  };

  if (state.status === "recovery") {
    const phase = state.phase;
    return (
      <AuthShell
        title={phase === "settingPassword" ? "Nowe hasło" : "Odzyskiwanie dostępu"}
        subtitle={phase === "settingPassword" ? "Ustaw silne, nowe hasło do konta." : "Wpisz kod wysłany na adres e-mail."}
        footer={
          <Pressable onPress={handleResetToSignIn} accessibilityRole="button">
            <Text style={styles.linkText}>Powrót do logowania</Text>
          </Pressable>
        }
      >
        {phase === "settingPassword" ? (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Nowe hasło"
              secureTextEntry
              style={[styles.input, passwordHasError && styles.inputInvalid]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              value={repeatPassword}
              onChangeText={setRepeatPassword}
              placeholder="Powtórz nowe hasło"
              secureTextEntry
              style={[styles.input, repeatPasswordHasError && styles.inputInvalid]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <PasswordRequirements password={password} repeatPassword={repeatPassword} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable
              style={[styles.buttonPrimary, pending && styles.buttonDisabled]}
              onPress={() => void submitNewPassword()}
              disabled={pending}
            >
              <Text style={styles.buttonPrimaryText}>{pending ? "Zapisywanie…" : "Zapisz hasło"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="6-cyfrowy kod"
              keyboardType="number-pad"
              maxLength={authPolicy.codeLength}
              style={styles.input}
            />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable
              style={[styles.buttonPrimary, pending && styles.buttonDisabled]}
              onPress={() => void submitResetCode()}
              disabled={pending}
            >
              <Text style={styles.buttonPrimaryText}>{pending ? "Sprawdzanie…" : "Zweryfikuj kod"}</Text>
            </Pressable>
          </>
        )}
      </AuthShell>
    );
  }

  const activeMode = authMode;
  const mainTitle = activeMode === "signin" ? "Zaloguj się" : activeMode === "signup" ? "Utwórz konto" : activeMode === "confirm" ? "Potwierdź email" : activeMode === "reset" ? "Reset hasła" : activeMode === "resetCode" ? "Kod odzyskiwania" : "Nowe hasło";
  const mainSubtitle = activeMode === "signin"
    ? "Wprowadź dane swoich konta, aby wejść do aplikacji."
    : activeMode === "signup"
      ? "Utwórz konto i potwierdź adres email."
      : activeMode === "confirm"
        ? "Wpisz kod z wiadomości e-mail, aby aktywować konto."
        : activeMode === "reset"
          ? "Wprowadź adres e-mail powiązany z kontem."
          : activeMode === "resetCode"
            ? "Wpisz kod z e-maila i ustaw nowe hasło."
            : "Ustaw nowe, bezpieczne hasło do konta.";

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AuthShell
        title={mainTitle}
        subtitle={mainSubtitle}
        footer={
          activeMode === "signin" ? (
            <View style={styles.footerRow}>
              <Pressable onPress={() => setMode("signup")} accessibilityRole="button">
                <Text style={styles.linkText}>Utwórz konto</Text>
              </Pressable>
              <Pressable onPress={() => setMode("reset")} accessibilityRole="button">
                <Text style={styles.linkText}>Zapomniałem hasła</Text>
              </Pressable>
            </View>
          ) : activeMode === "signup" ? (
            <Pressable onPress={() => setMode("signin")} accessibilityRole="button">
              <Text style={styles.linkText}>Masz już konto? Zaloguj się</Text>
            </Pressable>
          ) : activeMode === "confirm" ? (
            <View style={styles.footerRow}>
              <Pressable onPress={() => void resendSignupCode(emailForFlow || email.trim())} accessibilityRole="button">
                <Text style={styles.linkText}>Wyślij kod ponownie</Text>
              </Pressable>
              <Pressable onPress={handleResetToSignIn} accessibilityRole="button">
                <Text style={styles.linkText}>Anuluj</Text>
              </Pressable>
            </View>
          ) : activeMode === "reset" ? (
            <Pressable onPress={handleResetToSignIn} accessibilityRole="button">
              <Text style={styles.linkText}>Powrót do logowania</Text>
            </Pressable>
          ) : activeMode === "resetCode" ? (
            <View style={styles.footerRow}>
              <Pressable onPress={() => setMode("reset")} accessibilityRole="button">
                <Text style={styles.linkText}>Zmień email</Text>
              </Pressable>
              <Pressable onPress={handleResetToSignIn} accessibilityRole="button">
                <Text style={styles.linkText}>Anuluj</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={handleResetToSignIn} accessibilityRole="button">
              <Text style={styles.linkText}>Powrót do logowania</Text>
            </Pressable>
          )
        }
      >
        {activeMode === "signin" && (
          <>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            <TextInput value={password} onChangeText={setPassword} placeholder="Hasło" secureTextEntry style={styles.input} autoCapitalize="none" autoCorrect={false} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitSignIn()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Logowanie…" : "Zaloguj się"}</Text>
            </Pressable>
          </>
        )}

        {activeMode === "signup" && (
          <>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            <TextInput value={password} onChangeText={setPassword} placeholder="Hasło" secureTextEntry style={[styles.input, passwordHasError && styles.inputInvalid]} autoCapitalize="none" autoCorrect={false} />
            <TextInput value={repeatPassword} onChangeText={setRepeatPassword} placeholder="Powtórz hasło" secureTextEntry style={[styles.input, repeatPasswordHasError && styles.inputInvalid]} autoCapitalize="none" autoCorrect={false} />
            <PasswordRequirements password={password} repeatPassword={repeatPassword} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitSignUp()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Rejestracja…" : "Utwórz konto"}</Text>
            </Pressable>
          </>
        )}

        {activeMode === "confirm" && (
          <>
            <TextInput value={emailForFlow || email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            <TextInput value={code} onChangeText={setCode} placeholder="6-cyfrowy kod" keyboardType="number-pad" maxLength={authPolicy.codeLength} style={styles.input} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitConfirm()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Weryfikacja…" : "Potwierdź konto"}</Text>
            </Pressable>
          </>
        )}

        {activeMode === "reset" && (
          <>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitResetRequest()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Wysyłanie…" : "Wyślij kod"}</Text>
            </Pressable>
          </>
        )}

        {activeMode === "resetCode" && (
          <>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
            <TextInput value={code} onChangeText={setCode} placeholder="6-cyfrowy kod" keyboardType="number-pad" maxLength={authPolicy.codeLength} style={styles.input} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitResetCode()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Sprawdzanie…" : "Zweryfikuj kod"}</Text>
            </Pressable>
          </>
        )}

        {activeMode === "newPassword" && (
          <>
            <TextInput value={password} onChangeText={setPassword} placeholder="Nowe hasło" secureTextEntry style={[styles.input, passwordHasError && styles.inputInvalid]} autoCapitalize="none" autoCorrect={false} />
            <TextInput value={repeatPassword} onChangeText={setRepeatPassword} placeholder="Powtórz hasło" secureTextEntry style={[styles.input, repeatPasswordHasError && styles.inputInvalid]} autoCapitalize="none" autoCorrect={false} />
            <PasswordRequirements password={password} repeatPassword={repeatPassword} />
            {message ? <Text style={styles.notice}>{message}</Text> : null}
            <Pressable style={[styles.buttonPrimary, pending && styles.buttonDisabled]} onPress={() => void submitNewPassword()} disabled={pending}>
              <Text style={styles.buttonPrimaryText}>{pending ? "Zapisywanie…" : "Zapisz hasło"}</Text>
            </Pressable>
          </>
        )}
      </AuthShell>
    </KeyboardAvoidingView>
  );
}

function PasswordRequirements({ password, repeatPassword }: { password: string; repeatPassword: string }) {
  const passwordIsLongEnough = password.length >= authPolicy.minimumPasswordLength;
  const passwordsMatch = repeatPassword.length > 0 && password === repeatPassword;

  return (
    <View style={styles.passwordRequirements} accessibilityLiveRegion="polite">
      <Text style={[
        styles.passwordRequirement,
        passwordIsLongEnough ? styles.passwordRequirementMet : password ? styles.passwordRequirementUnmet : null,
      ]}>
        {passwordIsLongEnough ? "Hasło spełnia wymaganie długości." : `Błąd: hasło musi mieć co najmniej ${authPolicy.minimumPasswordLength} znaków.`}
      </Text>
      <Text style={[
        styles.passwordRequirement,
        passwordsMatch ? styles.passwordRequirementMet : repeatPassword ? styles.passwordRequirementUnmet : null,
      ]}>
        {passwordsMatch ? "Hasła są takie same." : repeatPassword ? "Błąd: hasła nie są takie same." : "Potwierdź hasło, aby sprawdzić zgodność."}
      </Text>
    </View>
  );
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F7F2",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#252B30",
  },
  errorText: {
    marginTop: 12,
    textAlign: "center",
    color: "#606660",
    fontSize: 15,
  },
  loadingText: {
    marginTop: 16,
    color: "#252B30",
    fontSize: 15,
  },
  hidden: {
    display: "none",
  },
  webLayout: {
    flex: 1,
    alignItems: "center",
  },
  mobileLayout: {
    flex: 1,
  },
  webMain: {
    flex: 1,
    width: "100%",
    maxWidth: 760,
    paddingVertical: 16,
  },
  mobileMain: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  logo: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#252B30",
  },
  homeButton: {
    minHeight: 44,
    justifyContent: "center",
    flexShrink: 1,
  },
  settingsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 14,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#EAEAE5",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    fontSize: 16,
    color: "#252B30",
  },
  content: {
    flex: 1,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7DBD6",
    backgroundColor: "#F7F7F2",
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#252B30",
  },
  inputInvalid: {
    borderColor: "#C62828",
  },
  buttonPrimary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#07966D",
    paddingHorizontal: 18,
  },
  buttonPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  linkText: {
    color: "#07966D",
    fontSize: 15,
    fontWeight: "700",
  },
  notice: {
    color: "#343A40",
    fontSize: 14,
    lineHeight: 20,
  },
  passwordRequirements: {
    gap: 4,
  },
  passwordRequirement: {
    color: "#606660",
    fontSize: 13,
    lineHeight: 18,
  },
  passwordRequirementMet: {
    color: "#087A59",
  },
  passwordRequirementUnmet: {
    color: "#C62828",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
});
