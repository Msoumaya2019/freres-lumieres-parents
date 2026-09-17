import { Redirect, Stack } from 'expo-router';
import { LoadingState, Screen } from '../../components/ui';
import { useAuth } from '../../providers/auth-provider';

export default function MemberLayout() {
  const { firebaseUser, profile, loading } = useAuth();
  if (loading)
    return (
      <Screen>
        <LoadingState label="Vérification de votre accès membre…" />
      </Screen>
    );
  if (!firebaseUser) return <Redirect href="/(auth)/login" />;
  if (!profile || profile.status !== 'active')
    return <Redirect href="/(auth)/status" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
