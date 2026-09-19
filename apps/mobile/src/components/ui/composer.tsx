/**
 * Zone de saisie d'un texte court : un commentaire, un message de canal.
 *
 * ## Un seul composeur pour les deux
 *
 * Un commentaire et un message de canal demandent exactement la même chose :
 * un champ multiligne, une réponse citée, un bouton d'envoi, une erreur. Seul
 * le mot employé change, et il est porté par `noun` — deux composants
 * divergeraient au premier correctif appliqué à un seul.
 *
 * ## Le champ reste rempli en cas d'échec
 *
 * Le texte n'est vidé que si l'écriture a réussi. Le vider d'abord — ce que
 * fait le réflexe « on envoie, on nettoie, on gère l'erreur » — ferait perdre
 * à son auteur un message qu'il vient de rédiger, sur une coupure réseau ou un
 * refus de règle. C'est la seule donnée de cet écran qu'il ne peut pas
 * reconstituer d'un geste.
 *
 * ## La limite est connue à l'avance
 *
 * `maxLength` empêche de dépasser la borne des règles Firestore (2000
 * caractères). Sans elle, le refus arriverait après l'envoi, sous forme de
 * « permission denied » — incompréhensible pour un parent. Le compteur
 * n'apparaît qu'à l'approche de la limite : affiché en permanence, il
 * inquiéterait sans raison.
 *
 * La borne est celle du commentaire **et** du message : les deux règles
 * Firestore portent le même 2000, et `messageInputSchema` le revalide.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { appErrorMessage } from '@fl/shared';
import type { AppError } from '@fl/types';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

/** Longueur maximale d'un commentaire, alignée sur la règle Firestore. */
const MAX_LENGTH = 2000;

/** Seuil à partir duquel le compteur de caractères devient utile. */
const COUNTER_THRESHOLD = MAX_LENGTH - 200;

export interface ComposerProps {
  /** Ce que l'on écrit, au singulier : « commentaire », « message ». */
  noun?: string;
  /** Texte auquel on répond, ou `null` pour un texte racine. */
  replyTo: { readonly id: string; readonly authorName: string } | null;
  onCancelReply: () => void;
  /** Renvoie `true` si l'écriture a réussi ; le champ est alors vidé. */
  onSubmit: (body: string) => Promise<boolean>;
  submitting: boolean;
  error: AppError | null;
}

export function Composer({
  noun = 'commentaire',
  replyTo,
  onCancelReply,
  onSubmit,
  submitting,
  error,
}: ComposerProps): React.JSX.Element {
  const { theme } = useTheme();
  const [body, setBody] = useState('');

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && !submitting;

  async function send(): Promise<void> {
    if (!canSend) return;

    const sent = await onSubmit(trimmed);
    if (!sent) return;

    setBody('');
    onCancelReply();
  }

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      {replyTo ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radii.sm,
            backgroundColor: theme.colors.primarySoft,
          }}
        >
          <AppText variant="caption" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            En réponse à {replyTo.authorName}
          </AppText>
          <Pressable
            onPress={onCancelReply}
            accessibilityRole="button"
            accessibilityLabel="Annuler la réponse"
            hitSlop={theme.spacing.sm}
          >
            <Ionicons name="close" size={18} color={theme.colors.primary} />
          </Pressable>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MAX_LENGTH}
          placeholder={replyTo ? 'Écrire une réponse…' : `Écrire un ${noun}…`}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={replyTo ? 'Votre réponse' : `Votre ${noun}`}
          style={[
            styles.input,
            {
              minHeight: theme.touchTarget,
              maxHeight: theme.touchTarget * 3,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radii.md,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              backgroundColor: theme.colors.surfaceMuted,
              color: theme.colors.textPrimary,
              fontSize: theme.typography.size.md,
            },
          ]}
        />

        <Pressable
          onPress={() => void send()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={replyTo ? 'Envoyer la réponse' : `Envoyer le ${noun}`}
          accessibilityState={{ disabled: !canSend, busy: submitting }}
          style={({ pressed }) => [
            styles.send,
            {
              width: theme.touchTarget,
              height: theme.touchTarget,
              borderRadius: theme.radii.pill,
              backgroundColor: canSend ? theme.colors.primary : theme.colors.surfaceMuted,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.textOnPrimary} />
          ) : (
            <Ionicons
              name="send"
              size={20}
              color={canSend ? theme.colors.textOnPrimary : theme.colors.textMuted}
            />
          )}
        </Pressable>
      </View>

      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}
      >
        <View style={{ flexShrink: 1 }}>
          {error ? (
            <AppText variant="caption" color="danger">
              {appErrorMessage(error)}
            </AppText>
          ) : null}
        </View>

        {body.length > COUNTER_THRESHOLD ? (
          <AppText variant="caption" color="muted">
            {body.length} / {MAX_LENGTH}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
