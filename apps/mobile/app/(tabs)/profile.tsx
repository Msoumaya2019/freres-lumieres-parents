import type { ChildProfile, RegistrationConfig } from '@flp/types';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar, Button, Card, LoadingState, Screen } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';
import {
  loadChildProfiles,
  loadRegistrationConfig,
  logout,
} from '@/services/auth';

const roleLabels = {
  parent: 'Parent',
  fcpe: 'Membre FCPE',
  moderator: 'Modérateur',
  admin: 'Administrateur',
} as const;

export default function ProfilePage() {
  const { firebaseUser, profile, loading } = useAuth();
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [catalog, setCatalog] = useState<RegistrationConfig | null>(null);

  useEffect(() => {
    if (!firebaseUser || !profile) return;
    void Promise.all([
      loadChildProfiles(firebaseUser.uid),
      loadRegistrationConfig(profile.organizationId),
    ]).then(([childProfiles, registrationConfig]) => {
      setChildren(childProfiles);
      setCatalog(registrationConfig);
    });
  }, [firebaseUser, profile]);

  const initials = useMemo(
    () =>
      `${profile?.firstName[0] ?? ''}${profile?.lastName[0] ?? ''}`.toUpperCase(),
    [profile],
  );

  if (loading || !profile)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );

  function childLabel(child: ChildProfile) {
    const school = catalog?.schools.find(
      (entry) => entry.id === child.schoolId,
    );
    const level = school?.levels.find((entry) => entry.id === child.levelId);
    return `${school?.name ?? child.schoolId} — ${level?.name ?? child.levelId}`;
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>MON ESPACE</Text>
        <View style={styles.header}>
          <Avatar initials={initials} />
          <View style={styles.identity}>
            <Text style={styles.title}>{profile.firstName}</Text>
            <Text style={styles.role}>{roleLabels[profile.role]}</Text>
          </View>
        </View>
        <Text style={styles.heading}>Mes enfants</Text>
        <Card tone="success">
          {children.length ? (
            children.map((child) => (
              <Text style={styles.child} key={child.id}>
                {childLabel(child)}
              </Text>
            ))
          ) : (
            <Text style={styles.muted}>Aucun rattachement enregistré.</Text>
          )}
        </Card>
        <Text style={styles.heading}>Mon compte</Text>
        <Card tone="warm">
          <Text style={styles.label}>Adresse email</Text>
          <Text style={styles.value}>{profile.email}</Text>
          <Text style={styles.label}>Statut</Text>
          <Text style={styles.value}>Compte actif</Text>
        </Card>
        <Card>
          <Text style={styles.menuItem}>Mes notifications</Text>
          <Text style={styles.menuItem}>Confidentialité</Text>
          <Text style={styles.menuItem}>Aide</Text>
        </Card>
        <Button
          label="Se déconnecter"
          onPress={() => void logout()}
          secondary
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  eyebrow: {
    alignSelf: 'flex-start',
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  identity: { gap: 2 },
  title: { ...typography.title, color: colors.primaryDark },
  role: { ...typography.body, color: colors.primary, fontWeight: '800' },
  heading: { ...typography.heading, color: colors.text, marginTop: spacing.sm },
  child: { ...typography.body, color: colors.text, fontWeight: '700' },
  label: {
    ...typography.small,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: { ...typography.body, color: colors.text, marginBottom: spacing.sm },
  muted: { ...typography.body, color: colors.muted },
  menuItem: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
