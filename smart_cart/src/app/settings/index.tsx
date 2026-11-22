import { Redirect } from 'expo-router';
// Compatibility for existing links: settings now live in the header menu.
export default function SettingsRedirect() { return <Redirect href="/rules" />; }
