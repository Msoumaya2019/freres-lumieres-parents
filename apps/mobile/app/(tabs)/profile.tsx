import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar, Card, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

const menu = [
  'Mes notifications',
  'Mon compte',
  'Confidentialité',
  'Aide',
  'Déconnexion',
];
export default function ProfilePage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Avatar initials="M" />
          <View>
            <Text style={styles.title}>Mohamed</Text>
            <Text style={styles.role}>Parent</Text>
          </View>
        </View>
        <Text style={styles.heading}>Mes enfants</Text>
        <Card>
          <Text style={styles.child}>Élémentaire — CE1</Text>
          <Text style={styles.child}>Maternelle — Grande Section</Text>
        </Card>
        <View style={styles.menu}>
          {menu.map((item) => (
            <Card key={item}>
              <Text style={styles.menuItem}>{item}</Text>
            </Card>
          ))}
        </View>
        <Link href="/(auth)/login" style={styles.link}>
          Voir l’écran de connexion
        </Link>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { ...typography.title, color: colors.text },
  role: { ...typography.body, color: colors.primary, fontWeight: '700' },
  heading: { ...typography.heading, color: colors.text },
  child: { ...typography.body, color: colors.text },
  menu: { gap: 10 },
  menuItem: { ...typography.body, color: colors.text, fontWeight: '600' },
  link: { textAlign: 'center', color: colors.primary, fontWeight: '700' },
});
