import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal as NativeModal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, shadow, typography } from '@/constants/theme';

export function Screen({ children }: PropsWithChildren) {
  return <SafeAreaView style={styles.screen}>{children}</SafeAreaView>;
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({
  children,
  tone = 'default',
}: PropsWithChildren<{ tone?: 'default' | 'urgent' | 'accent' }>) {
  return (
    <Text
      style={[
        styles.badge,
        tone === 'urgent' && styles.badgeUrgent,
        tone === 'accent' && styles.badgeAccent,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  secondary = false,
}: {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && styles.buttonSecondaryText]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <View accessibilityLabel={`Avatar ${initials}`} style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Card style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.muted}>{message}</Text>
    </Card>
  );
}

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.center}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card style={styles.center}>
      <Text style={styles.errorTitle}>Un problème est survenu</Text>
      <Text style={styles.muted}>{message}</Text>
    </Card>
  );
}

export function Modal({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <NativeModal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Card style={styles.modal}>
          <Text style={typography.heading}>{title}</Text>
          {children}
          <Button label="Fermer" onPress={onClose} secondary />
        </Card>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
    ...shadow,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  badgeUrgent: { backgroundColor: colors.urgentSoft, color: colors.urgent },
  badgeAccent: { backgroundColor: '#FFF2D9', color: '#7B4D08' },
  button: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonSecondary: { backgroundColor: colors.primarySoft },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  buttonSecondaryText: { color: colors.primary },
  pressed: { opacity: 0.76 },
  inputGroup: { gap: 7 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 15,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  avatarText: { color: colors.white, fontSize: 22, fontWeight: '800' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { ...typography.heading, color: colors.text },
  errorTitle: { ...typography.heading, color: colors.urgent },
  muted: { ...typography.body, color: colors.muted, textAlign: 'center' },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(10, 30, 25, 0.45)',
  },
  modal: { gap: 18 },
});
