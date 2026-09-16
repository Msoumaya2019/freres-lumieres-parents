import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Screen } from '../../components/ui';
import { colors, typography } from '../../constants/theme';

const filters = ['Tout', 'Urgent', 'École', 'Cantine', 'FCPE', 'Événements'];
const posts = [
  {
    badge: 'URGENT',
    tone: 'urgent' as const,
    title: 'Mouvement de grève vendredi',
    meta: 'Élémentaire · Il y a 2 h',
  },
  {
    badge: 'INFORMATION',
    tone: 'default' as const,
    title: 'Réunion des parents d’élèves',
    meta: 'Mardi 22 septembre à 18h30',
  },
  {
    badge: 'ÉVÉNEMENT',
    tone: 'accent' as const,
    title: 'Kermesse de l’école',
    meta: '12 juin',
  },
];

export default function HomePage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.greeting}>Bonjour 👋</Text>
          <Text style={styles.title}>Actualités</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((filter, index) => (
            <Text
              key={filter}
              style={[styles.filter, index === 0 && styles.filterActive]}
            >
              {filter}
            </Text>
          ))}
        </ScrollView>
        <View style={styles.list}>
          {posts.map((post) => (
            <Card key={post.title}>
              <Badge tone={post.tone}>{post.badge}</Badge>
              <Text style={styles.postTitle}>{post.title}</Text>
              <Text style={styles.meta}>{post.meta}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
  greeting: { ...typography.body, color: colors.muted },
  title: { ...typography.title, color: colors.text },
  filters: { gap: 9 },
  filter: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    overflow: 'hidden',
  },
  filterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: colors.white,
  },
  list: { gap: 14 },
  postTitle: { ...typography.heading, color: colors.text },
  meta: { ...typography.small, color: colors.muted },
});
