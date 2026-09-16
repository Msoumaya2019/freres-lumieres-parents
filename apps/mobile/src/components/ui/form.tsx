/**
 * Composants de formulaire.
 *
 * Mêmes règles que le reste de la bibliothèque d'interface : cibles tactiles
 * d'au moins 48 points, mise à l'échelle système de la police respectée,
 * libellés d'accessibilité en français, couleurs issues exclusivement des
 * jetons de thème.
 *
 * ## Le choix d'une liste de boutons radio plutôt qu'un sélecteur natif
 *
 * Les listes à choix (école, classe) comptent trois à cinq entrées. Un
 * sélecteur natif demanderait une dépendance supplémentaire, masquerait les
 * options derrière un tap, et se comporterait différemment sur iOS et sur
 * Android. Une liste dépliée montre tout du premier coup d'œil — ce qui
 * compte pour un parent qui découvre l'application — et se pilote au lecteur
 * d'écran avec les rôles standards.
 */
import { Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

// ---------------------------------------------------------------------------
// Champ de saisie
// ---------------------------------------------------------------------------

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Message affiché sous le champ, en rouge. */
  error?: string | undefined;
  /** Aide affichée sous le champ lorsqu'il n'y a pas d'erreur. */
  hint?: string | undefined;
  placeholder?: string;
  /** Ajoute la mention « (facultatif) » et signale le champ comme non requis. */
  optional?: boolean;
  /** Champ en lecture seule : la valeur reste lisible mais non modifiable. */
  readOnly?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  maxLength?: number;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  placeholder,
  optional = false,
  readOnly = false,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoComplete,
  textContentType,
  maxLength,
  onBlur,
  onSubmitEditing,
  returnKeyType,
}: TextFieldProps): React.JSX.Element {
  const { theme } = useTheme();
  const accessibleLabel = optional ? `${label} (facultatif)` : label;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="bodyStrong">{optional ? `${label} (facultatif)` : label}</AppText>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        onSubmitEditing={onSubmitEditing}
        editable={!readOnly}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        textContentType={textContentType}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        accessibilityLabel={accessibleLabel}
        style={[
          styles.input,
          {
            minHeight: theme.touchTarget,
            borderRadius: theme.radii.md,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            // Un champ en lecture seule est visuellement distinct : l'utilisateur
            // doit comprendre qu'il ne peut pas le modifier, sans essayer.
            backgroundColor: readOnly ? theme.colors.surface : theme.colors.surfaceMuted,
            color: readOnly ? theme.colors.textSecondary : theme.colors.textPrimary,
            fontSize: theme.typography.size.md,
            paddingHorizontal: theme.spacing.md,
          },
        ]}
      />

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Liste à choix unique
// ---------------------------------------------------------------------------

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Précision affichée sous le libellé, en plus petit. */
  readonly description?: string;
}

export interface ChoiceListProps<T extends string> {
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | undefined;
  hint?: string | undefined;
  /** Message affiché lorsque la liste est vide. */
  emptyMessage?: string;
  disabled?: boolean;
}

export function ChoiceList<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  emptyMessage = 'Aucun choix disponible pour le moment.',
  disabled = false,
}: ChoiceListProps<T>): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="bodyStrong">{label}</AppText>

      {options.length === 0 ? (
        <AppText variant="caption" color="muted">
          {emptyMessage}
        </AppText>
      ) : (
        <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <Pressable
                key={option.value}
                onPress={() => onChange(option.value)}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    minHeight: theme.touchTarget,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radii.md,
                    // L'épaisseur de bordure ne change pas à la sélection :
                    // une bordure qui s'épaissit décale le contenu d'un pixel
                    // et fait « sauter » la liste au moment du choix.
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected
                      ? theme.colors.primarySoft
                      : theme.colors.surfaceMuted,
                    opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <RadioMark selected={selected} />

                <View style={{ flex: 1 }}>
                  <AppText
                    variant="body"
                    style={{
                      color: selected ? theme.colors.primary : theme.colors.textPrimary,
                    }}
                  >
                    {option.label}
                  </AppText>
                  {option.description ? (
                    <AppText variant="caption" color="secondary">
                      {option.description}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Pastille de sélection.
 *
 * Dessinée avec deux `View` plutôt qu'avec une icône : aucun chargement de
 * police, aucun risque de glyphe manquant, et le rendu est identique sur les
 * deux plateformes.
 */
function RadioMark({ selected }: { selected: boolean }): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.colors.primary,
          }}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Consentement
// ---------------------------------------------------------------------------

export interface ConsentRowProps {
  label: string;
  /** Précision affichée sous le libellé. */
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string | undefined;
}

export function ConsentRow({
  label,
  description,
  value,
  onChange,
  error,
}: ConsentRowProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          minHeight: theme.touchTarget,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppText variant="body">{label}</AppText>
          {description ? (
            <AppText variant="caption" color="muted">
              {description}
            </AppText>
          ) : null}
        </View>

        <Switch
          value={value}
          onValueChange={onChange}
          accessibilityLabel={label}
          trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
        />
      </View>

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Indicateur d'étape
// ---------------------------------------------------------------------------

export interface StepIndicatorProps {
  steps: readonly string[];
  /** Index de l'étape courante, à partir de zéro. */
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {/* Le texte porte l'information ; la barre n'est qu'un repère visuel,
          volontairement masqué aux lecteurs d'écran. */}
      <AppText variant="label" color="muted">
        {`Étape ${current + 1} sur ${steps.length} · ${steps[current] ?? ''}`}
      </AppText>

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', gap: theme.spacing.xs }}
      >
        {steps.map((step, index) => (
          <View
            key={step}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: index <= current ? theme.colors.primary : theme.colors.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bandeau d'information
// ---------------------------------------------------------------------------

export type FormAlertTone = 'error' | 'warning' | 'info' | 'success';

export interface FormAlertProps {
  tone: FormAlertTone;
  title?: string;
  children: React.ReactNode;
}

export function FormAlert({ tone, title, children }: FormAlertProps): React.JSX.Element {
  const { theme } = useTheme();

  const palette = {
    error: { background: theme.colors.dangerSoft, color: theme.colors.danger },
    warning: { background: theme.colors.warningSoft, color: theme.colors.warning },
    info: { background: theme.colors.infoSoft, color: theme.colors.info },
    success: { background: theme.colors.successSoft, color: theme.colors.success },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: palette.background,
        borderRadius: theme.radii.md,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
      }}
    >
      {title ? (
        <AppText variant="bodyStrong" style={{ color: palette.color }}>
          {title}
        </AppText>
      ) : null}
      <AppText variant="body" style={{ color: palette.color }}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth },
});
