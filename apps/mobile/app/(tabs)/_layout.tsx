/**
 * Navigation principale.
 *
 * ```
 *   Accueil   Discussions   [+]   Agenda   Profil
 * ```
 *
 * Le bouton central « + » n'est pas un onglet comme les autres : il n'affiche
 * pas d'écran, il ouvre une feuille modale par-dessus l'écran courant. C'est
 * ce qui permet de poser une question, proposer une idée ou faire un
 * signalement sans perdre le fil de ce que l'on était en train de lire.
 *
 * Le libellé de chaque onglet est explicite et la zone tactile dépasse
 * largement la taille de l'icône : un parent qui vise approximativement doit
 * toucher juste du premier coup.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export default function TabsLayout(): React.JSX.Element {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 64 + theme.spacing.md,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.size.xs,
          fontWeight: theme.typography.weight.medium,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="discussions"
        options={{
          title: 'Discussions',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="create"
        options={{
          title: '',
          tabBarAccessibilityLabel: 'Créer une publication, une question ou un signalement',
          // Ce bouton n'ouvre pas d'onglet : il déclenche la modale de création.
          tabBarButton: () => <CreateButton onPress={() => router.push('/create')} />,
        }}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push('/create');
          },
        }}
      />

      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

/**
 * Bouton central.
 *
 * Volontairement plus grand et coloré que les autres : c'est l'action la plus
 * utilisée de l'application, et elle doit être identifiable sans lire.
 */
function CreateButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={styles.createWrapper}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Créer"
        accessibilityHint="Ouvre les options de création"
        style={({ pressed }) => [
          styles.createButton,
          {
            backgroundColor: theme.colors.primary,
            borderRadius: theme.radii.pill,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={30} color={theme.colors.textOnPrimary} />
      </Pressable>
      <AppText variant="caption" color="muted" style={styles.createLabel}>
        Créer
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  createWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  createButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -12,
  },
  createLabel: {
    fontSize: 11,
  },
});
