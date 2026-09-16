import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../constants/theme';

const icon =
  (symbol: string) =>
  ({ color }: { color: ColorValue }) => (
    <Text style={{ color, fontSize: 21 }}>{symbol}</Text>
  );

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          minHeight: 66,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Accueil', tabBarIcon: icon('⌂') }}
      />
      <Tabs.Screen
        name="discussions"
        options={{ title: 'Discussions', tabBarIcon: icon('◌') }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: 'Créer', tabBarIcon: icon('＋') }}
      />
      <Tabs.Screen
        name="agenda"
        options={{ title: 'Agenda', tabBarIcon: icon('□') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: icon('○') }}
      />
    </Tabs>
  );
}
