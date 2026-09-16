/**
 * Inscription d'un parent, en deux étapes.
 *
 * ## Pourquoi deux étapes, et pourquoi le compte naît entre les deux
 *
 * Les règles Firestore n'autorisent la lecture des écoles et des classes
 * qu'aux utilisateurs **connectés**. Ce n'est pas une négligence : ces listes
 * n'ont rien de confidentiel, mais elles n'ont pas à être publiques non plus,
 * et une base ouverte à tous est une base qu'on oublie de refermer.
 *
 * Conséquence directe sur le parcours : le compte Firebase doit exister
 * **avant** que le formulaire puisse proposer une école. L'étape 1 crée donc
 * le compte, l'étape 2 écrit le profil et les enfants. Un compte sans profil
 * est un état transitoire assumé, et rattrapable — voir ci-dessous.
 *
 * ## L'inscription interrompue
 *
 * Si l'application se ferme entre les deux étapes, le compte existe mais le
 * profil n'a jamais été écrit. L'utilisateur qui revient est connecté, sans
 * profil : le garde de navigation le renvoie ici, et l'écran détecte le cas
 * pour reprendre au bon endroit — sans redemander de mot de passe, puisque la
 * session est déjà ouverte, et sans recréer de compte, ce qui échouerait avec
 * « adresse déjà utilisée ».
 *
 * ## Ce que l'écran ne demande pas
 *
 * Ni le niveau ni l'année scolaire de l'enfant : ils se déduisent de la classe
 * choisie. Trois réponses à faire concorder finissent toujours par se
 * contredire ; en n'en demandant qu'une, la contradiction devient impossible.
 */
import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';

import type { ChildRegistrationInput } from '@fl/firebase';
import { isAppError, userMessage } from '@fl/firebase';
import {
  TEXT_LIMITS,
  childDraftSchema,
  childrenDraftSchema,
  registrationIdentitySchema,
} from '@fl/shared';
import type { ChildDraftInput } from '@fl/shared';

import { AppText, Button, Card, Screen } from '@/components/ui';
import { ChoiceList, ConsentRow, FormAlert, StepIndicator, TextField } from '@/components/ui/form';
import {
  classesOfSchool,
  findClass,
  useReferenceData,
  type ReferenceData,
} from '@/hooks/use-reference-data';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/** Libellés des étapes, dans l'ordre. */
const STEPS = ['Identité', 'Enfants'] as const;

const IDENTITY_STEP = 0;
const CHILDREN_STEP = 1;

/** Nombre maximal d'enfants, aligné sur `childrenDraftSchema`. */
const MAX_CHILDREN = 10;

/** Brouillon de rattachement, tel qu'il est manipulé par l'écran. */
interface ChildDraft {
  /** Clé de rendu stable : un enfant ne doit pas perdre sa saisie si la liste est réordonnée. */
  readonly key: string;
  firstName: string;
  schoolId: string | null;
  classId: string | null;
}

/**
 * Compteur de clés, à l'échelle du module.
 *
 * Un index de tableau serait instable — retirer le premier enfant ferait
 * changer la clé de tous les suivants, et React recréerait leurs champs.
 */
let childKeySeed = 0;

function createChildDraft(): ChildDraft {
  childKeySeed += 1;
  return { key: `enfant-${childKeySeed}`, firstName: '', schoolId: null, classId: null };
}

/** Forme minimale d'une erreur de validation, sans dépendre de Zod ici. */
interface ValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Première erreur par champ.
 *
 * Une seule par champ : empiler « trop court » puis « doit contenir un
 * chiffre » sous le même champ brouille le message plus qu'il n'aide.
 */
function firstIssueByField(issues: readonly ValidationIssue[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join('.');
    if (!map[key]) map[key] = issue.message;
  }
  return map;
}

/**
 * Message d'erreur de création de compte.
 *
 * Le message générique — « cet élément existe déjà » — ne dit pas au parent
 * quoi faire. Le cas le plus fréquent mérite une consigne actionnable : une
 * adresse déjà enregistrée, souvent parce qu'une inscription précédente a été
 * interrompue, ou parce que le parent a déjà un compte.
 */
function signUpErrorMessage(error: unknown): string {
  if (isAppError(error) && error.code === 'already-exists') {
    return (
      'Cette adresse e-mail est déjà utilisée. Connectez-vous, ou utilisez ' +
      '« Mot de passe oublié » si vous ne vous souvenez plus de votre mot de passe.'
    );
  }
  return userMessage(error);
}

/** Résultat de la traduction des brouillons en rattachements enregistrables. */
type ChildrenResolution =
  | { readonly ok: true; readonly children: ChildRegistrationInput[] }
  | { readonly ok: false; readonly message: string };

/**
 * Traduit les brouillons validés en rattachements enregistrables.
 *
 * C'est ici, et nulle part ailleurs, que le niveau et l'année scolaire sont
 * déduits de la classe. Une classe absente des données chargées — liste
 * devenue obsolète pendant que le formulaire était ouvert — est signalée
 * plutôt que remplacée par une valeur de repli : mieux vaut demander au
 * parent de recharger que d'enregistrer un rattachement inventé.
 */
function resolveChildren(
  drafts: readonly ChildDraftInput[],
  reference: ReferenceData | null,
): ChildrenResolution {
  const children: ChildRegistrationInput[] = [];

  for (const draft of drafts) {
    const schoolClass = findClass(reference, draft.classId);

    if (!schoolClass) {
      return {
        ok: false,
        message:
          'La classe sélectionnée n’est plus proposée. Rechargez la liste des classes, puis réessayez.',
      };
    }

    children.push({
      ...(draft.firstName ? { firstName: draft.firstName } : {}),
      schoolId: draft.schoolId,
      level: schoolClass.level,
      classId: draft.classId,
      academicYear: schoolClass.academicYear,
    });
  }

  return { ok: true, children };
}

export default function SignUpScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { status, firebaseUser, profile, profileResolved, signUp, completeRegistration } =
    useAuth();

  const [step, setStep] = useState<number>(IDENTITY_STEP);

  // --- Étape 1 : identité et consentements ---------------------------------
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptContact, setAcceptContact] = useState(false);

  // --- Étape 2 : rattachement des enfants ----------------------------------
  const [children, setChildren] = useState<ChildDraft[]>(() => [createChildDraft()]);

  // --- État de soumission ---------------------------------------------------
  const [attemptedStep, setAttemptedStep] = useState<number | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Vrai dès que le compte Firebase a été créé **dans cette session**. */
  const [accountCreated, setAccountCreated] = useState(false);

  const markTouched = useCallback((field: string) => {
    setTouched((previous) => (previous[field] ? previous : { ...previous, [field]: true }));
  }, []);

  const signedIn = status === 'signedIn';

  /**
   * Un compte existe-t-il déjà pour cette session ?
   *
   * Deux chemins y mènent : le compte vient d'être créé à l'étape 1, ou bien
   * il existait avant — inscription interrompue — et le profil n'a jamais été
   * écrit. Dans les deux cas, redemander un mot de passe serait absurde, et
   * rappeler la création de compte échouerait.
   *
   * `!submitting` évite que le formulaire ne change d'aspect pendant l'appel
   * réseau : la session est notifiée avant que la création ne soit terminée.
   */
  const accountExists =
    signedIn && !submitting && (accountCreated || (profileResolved && profile === null));

  /**
   * Les listes de référence ne sont lisibles qu'une fois connecté.
   *
   * `accountCreated` couvre l'instant qui sépare la création du compte de la
   * notification de session : la requête part dès que le compte existe, plutôt
   * qu'un rendu plus tard.
   */
  const { data: reference, retry } = useReferenceData(signedIn || accountCreated);
  const referenceData = reference.status === 'ready' ? reference.data : null;

  /**
   * En reprise, l'adresse vient du compte existant.
   *
   * La redemander n'aurait pas de sens, et la modifier ne changerait rien au
   * compte réellement créé : elle est donc affichée en lecture seule.
   */
  const sessionEmail = firebaseUser?.email ?? '';
  const emailValue = accountExists ? sessionEmail : email;

  // --- Validation de l'étape 1 ---------------------------------------------

  const identityInput = useMemo(
    () => ({
      firstName,
      lastName,
      email: emailValue,
      acceptPrivacyPolicy: acceptPrivacy,
      acceptCommunityRules: acceptRules,
      acceptFcpeContact: acceptContact,
    }),
    [firstName, lastName, emailValue, acceptPrivacy, acceptRules, acceptContact],
  );

  const identityValidation = useMemo(
    () =>
      accountExists
        ? registrationIdentitySchema.omit({ password: true }).safeParse(identityInput)
        : registrationIdentitySchema.safeParse({ ...identityInput, password }),
    [accountExists, identityInput, password],
  );

  const identityIssues = useMemo(
    () =>
      identityValidation.success
        ? {}
        : firstIssueByField(identityValidation.error.issues as readonly ValidationIssue[]),
    [identityValidation],
  );

  // --- Validation de l'étape 2 ---------------------------------------------

  const childDrafts = useMemo<ChildDraftInput[]>(
    () =>
      children.map((child) => ({
        ...(child.firstName.trim() ? { firstName: child.firstName.trim() } : {}),
        schoolId: child.schoolId ?? '',
        classId: child.classId ?? '',
      })),
    [children],
  );

  const childrenValidation = useMemo(
    () => childrenDraftSchema.safeParse(childDrafts),
    [childDrafts],
  );

  const childrenIssues = useMemo(
    () =>
      childrenValidation.success
        ? {}
        : firstIssueByField(childrenValidation.error.issues as readonly ValidationIssue[]),
    [childrenValidation],
  );

  /** Message d'erreur d'un champ, affiché seulement après interaction. */
  const visibleError = useCallback(
    (issues: Record<string, string>, field: string): string | undefined =>
      attemptedStep === step || touched[field] ? issues[field] : undefined,
    [attemptedStep, step, touched],
  );

  // --- Actions -------------------------------------------------------------

  async function handleIdentityContinue(): Promise<void> {
    setAttemptedStep(IDENTITY_STEP);
    setErrorMessage(null);

    if (!identityValidation.success) return;

    setSubmitting(true);
    try {
      if (!accountExists) {
        await signUp(identityValidation.data.email, password);
        setAccountCreated(true);
      }
      setStep(CHILDREN_STEP);
    } catch (error) {
      setErrorMessage(signUpErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChildrenSubmit(): Promise<void> {
    setAttemptedStep(CHILDREN_STEP);
    setErrorMessage(null);

    if (!childrenValidation.success) return;

    // L'identité est relue à la validation courante, et non capturée à
    // l'étape 1 : l'utilisateur peut être revenu en arrière pour la corriger.
    const identityData = identityValidation.success ? identityValidation.data : null;
    if (!identityData) {
      setErrorMessage(
        'Vos informations d’identité sont incomplètes. Complétez-les avant de valider.',
      );
      setStep(IDENTITY_STEP);
      return;
    }

    if (!referenceData) {
      setErrorMessage('Les listes d’écoles et de classes ne sont pas encore chargées.');
      return;
    }

    const resolution = resolveChildren(childrenValidation.data, referenceData);
    if (!resolution.ok) {
      setErrorMessage(resolution.message);
      return;
    }

    setSubmitting(true);
    try {
      // Le profil et les enfants sont écrits en une seule opération groupée.
      // L'écran d'attente prend le relais tout seul : le profil est observé en
      // temps réel, et le garde de navigation réagit au statut `pending`.
      await completeRegistration({
        firstName: identityData.firstName,
        lastName: identityData.lastName,
        email: identityData.email,
        orgId: referenceData.organization.id,
        children: resolution.children,
        consents: {
          privacyPolicy: identityData.acceptPrivacyPolicy,
          communityRules: identityData.acceptCommunityRules,
          fcpeContact: identityData.acceptFcpeContact,
        },
      });
    } catch (error) {
      setErrorMessage(userMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const updateChild = useCallback((key: string, patch: Partial<ChildDraft>) => {
    setChildren((previous) =>
      previous.map((child) => (child.key === key ? { ...child, ...patch } : child)),
    );
  }, []);

  const removeChild = useCallback((key: string) => {
    setChildren((previous) => previous.filter((child) => child.key !== key));
  }, []);

  // --- Rendu ---------------------------------------------------------------

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
          <AppText variant="title">Créer mon compte parent</AppText>
          <StepIndicator steps={STEPS} current={step} />
        </View>

        {accountExists && step === IDENTITY_STEP ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <FormAlert tone="info" title="Reprise de votre inscription">
              Votre compte a bien été créé, mais votre inscription n’est pas terminée. Vérifiez vos
              informations, puis rattachez vos enfants.
            </FormAlert>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <FormAlert tone="error">{errorMessage}</FormAlert>
          </View>
        ) : null}

        {step === IDENTITY_STEP ? (
          <Card style={{ marginTop: theme.spacing.lg, gap: theme.spacing.lg }}>
            <TextField
              label="Prénom"
              value={firstName}
              onChangeText={setFirstName}
              onBlur={() => markTouched('firstName')}
              maxLength={TEXT_LIMITS.userName}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              error={visibleError(identityIssues, 'firstName')}
            />
            <TextField
              label="Nom"
              value={lastName}
              onChangeText={setLastName}
              onBlur={() => markTouched('lastName')}
              maxLength={TEXT_LIMITS.userName}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="familyName"
              error={visibleError(identityIssues, 'lastName')}
            />
            <TextField
              label="Adresse e-mail"
              value={emailValue}
              onChangeText={setEmail}
              onBlur={() => markTouched('email')}
              readOnly={accountExists}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="prenom@exemple.fr"
              error={visibleError(identityIssues, 'email')}
              hint={
                accountExists
                  ? 'Adresse du compte déjà créé. Pour la modifier, contactez la FCPE.'
                  : undefined
              }
            />

            {/* En reprise, le mot de passe n'est pas redemandé : la session est
                déjà ouverte, et le modifier relève d'un autre parcours. */}
            {accountExists ? null : (
              <TextField
                label="Mot de passe"
                value={password}
                onChangeText={setPassword}
                onBlur={() => markTouched('password')}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                error={visibleError(identityIssues, 'password')}
                hint="Au moins 10 caractères, avec une lettre et un chiffre."
              />
            )}

            <View style={{ gap: theme.spacing.md }}>
              <ConsentRow
                label="J’accepte la politique de confidentialité"
                value={acceptPrivacy}
                onChange={setAcceptPrivacy}
                error={visibleError(identityIssues, 'acceptPrivacyPolicy')}
              />
              <ConsentRow
                label="J’accepte le règlement des discussions"
                description="Respect, courtoisie, et pas de propos visant une personne."
                value={acceptRules}
                onChange={setAcceptRules}
                error={visibleError(identityIssues, 'acceptCommunityRules')}
              />
              <ConsentRow
                label="J’accepte d’être recontacté par la FCPE"
                description="Facultatif. Vous pourrez revenir sur ce choix à tout moment."
                value={acceptContact}
                onChange={setAcceptContact}
              />
            </View>

            <Button
              label="Continuer"
              onPress={() => void handleIdentityContinue()}
              loading={submitting}
            />
          </Card>
        ) : (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.lg }}>
            <AppText variant="body" color="secondary">
              Rattachez votre ou vos enfants. Ces informations servent uniquement à vous transmettre
              les nouvelles qui concernent leurs classes.
            </AppText>

            {reference.status === 'idle' || reference.status === 'loading' ? (
              <Card style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <ActivityIndicator color={theme.colors.primary} />
                <AppText variant="body" color="secondary">
                  Chargement des écoles et des classes…
                </AppText>
              </Card>
            ) : reference.status === 'error' ? (
              <Card style={{ gap: theme.spacing.lg }}>
                <FormAlert tone="error" title="Listes indisponibles">
                  {userMessage(reference.error)}
                </FormAlert>
                <Button label="Réessayer" variant="secondary" onPress={retry} />
              </Card>
            ) : (
              <>
                {children.map((child, index) => (
                  <ChildEditor
                    key={child.key}
                    index={index}
                    draft={child}
                    reference={referenceData}
                    canRemove={children.length > 1}
                    onChange={updateChild}
                    onRemove={removeChild}
                    errorFor={(field) => visibleError(childrenIssues, `${index}.${field}`)}
                  />
                ))}

                {children.length < MAX_CHILDREN ? (
                  <Button
                    label="Ajouter un autre enfant"
                    variant="secondary"
                    onPress={() => setChildren((previous) => [...previous, createChildDraft()])}
                  />
                ) : null}

                <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                  <Button
                    label="Envoyer ma demande"
                    onPress={() => void handleChildrenSubmit()}
                    loading={submitting}
                  />
                  <Button
                    label="Retour"
                    variant="ghost"
                    disabled={submitting}
                    onPress={() => {
                      setAttemptedStep(null);
                      setErrorMessage(null);
                      setStep(IDENTITY_STEP);
                    }}
                  />
                </View>

                <AppText variant="caption" color="muted">
                  Un membre de la FCPE vérifiera votre demande avant son activation. Vous recevrez
                  une notification dès qu’elle sera validée.
                </AppText>
              </>
            )}
          </View>
        )}

        {step === IDENTITY_STEP ? (
          <Link href="/(auth)/sign-in" style={{ marginTop: theme.spacing.xl, alignSelf: 'center' }}>
            <AppText variant="body" color="accent">
              J’ai déjà un compte
            </AppText>
          </Link>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Éditeur d'un enfant
// ---------------------------------------------------------------------------

interface ChildEditorProps {
  index: number;
  draft: ChildDraft;
  reference: ReferenceData | null;
  canRemove: boolean;
  onChange: (key: string, patch: Partial<ChildDraft>) => void;
  onRemove: (key: string) => void;
  errorFor: (field: string) => string | undefined;
}

function ChildEditor({
  index,
  draft,
  reference,
  canRemove,
  onChange,
  onRemove,
  errorFor,
}: ChildEditorProps): React.JSX.Element {
  const { theme } = useTheme();

  const schoolOptions = useMemo(
    () =>
      (reference?.schools ?? []).map((school) => ({
        value: school.id,
        label: school.name,
      })),
    [reference],
  );

  const classOptions = useMemo(
    () =>
      classesOfSchool(reference, draft.schoolId).map((schoolClass) => ({
        value: schoolClass.id,
        label: schoolClass.name,
      })),
    [reference, draft.schoolId],
  );

  // Contrôle local du prénom : il n'a pas de règle métier au-delà de la
  // longueur, on le valide donc avec le schéma partagé plutôt qu'à la main.
  const firstNameIssue = useMemo(() => {
    const parsed = childDraftSchema.shape.firstName.safeParse(draft.firstName);
    return parsed.success ? undefined : parsed.error.issues[0]?.message;
  }, [draft.firstName]);

  const position = index + 1;

  return (
    <Card style={{ gap: theme.spacing.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        }}
      >
        <AppText variant="subtitle">{`Enfant ${position}`}</AppText>
        {canRemove ? (
          <Button
            label="Retirer"
            variant="ghost"
            fullWidth={false}
            accessibilityLabel={`Retirer l’enfant ${position}`}
            onPress={() => onRemove(draft.key)}
          />
        ) : null}
      </View>

      <TextField
        label="Prénom"
        optional
        value={draft.firstName}
        onChangeText={(value) => onChange(draft.key, { firstName: value })}
        maxLength={TEXT_LIMITS.userName}
        autoCapitalize="words"
        error={firstNameIssue}
        hint="Utile seulement pour vous y retrouver si vous avez plusieurs enfants."
      />

      <ChoiceList
        label="Établissement"
        options={schoolOptions}
        value={draft.schoolId}
        // Changer d'école invalide la classe : les identifiants de classes
        // sont propres à chaque établissement, et conserver l'ancien
        // enregistrerait un rattachement incohérent.
        onChange={(schoolId) => onChange(draft.key, { schoolId, classId: null })}
        error={errorFor('schoolId')}
        emptyMessage="Aucun établissement n’est ouvert aux inscriptions. Contactez la FCPE."
      />

      <ChoiceList
        label="Classe"
        options={classOptions}
        value={draft.classId}
        onChange={(classId) => onChange(draft.key, { classId })}
        error={errorFor('classId')}
        hint={
          draft.schoolId
            ? undefined
            : 'Choisissez d’abord un établissement pour voir les classes disponibles.'
        }
        emptyMessage="Aucune classe n’est ouverte dans cet établissement."
      />
    </Card>
  );
}
