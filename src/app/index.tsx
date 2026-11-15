import { Redirect } from "expo-router";
import { LoadingState, Screen } from "../components/ui";
import { useAuth } from "../features/auth/AuthProvider";

export default function IndexRoute() {
  const { user, ready } = useAuth();
  if (!ready) return <Screen><LoadingState label="Preparando seu RADAR…" /></Screen>;
  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}

