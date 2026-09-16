/**
 * Publier une information, photos comprises.
 *
 * ## Ce que l'écran reprend de l'éditeur d'administration
 *
 * Les mêmes valeurs par défaut : catégorie « Information », public « Tous les
 * parents ». Deux chemins de création qui ne s'accordent pas sur ce que vaut
 * « aucun choix » finissent par produire deux sortes de publications, et
 * l'écart se découvre quand quelqu'un cherche pourquoi la sienne n'est pas
 * arrivée.
 *
 * Ce public par défaut n'est pas un raccourci : `post.create` est réservé aux
 * membres de la FCPE, à la modération et à l'administration — exactement les
 * rôles pour lesquels `allowedAudienceTypes` contient `all`. Le choix affiché
 * est donc toujours un choix possible pour qui voit l'écran.
 *
 * ## Ce que l'écran n'offre pas
 *
 * **Ni brouillon** : la règle `list` de `posts` n'autorise que
 * `status == 'published'`, donc un brouillon écrit ici disparaîtrait aussitôt,
 * sans aucun moyen de le retrouver depuis l'application. **Ni épinglage** :
 * réservé à la modération, et la règle refuse `pinned: true` à un simple
 * membre. **Ni notification** : le champ `notify` du schéma n'est lu par
 * personne — une case à cocher qui ne déclenche rien serait un mensonge
 * d'interface.
 *
 * ## Pourquoi l'écran s'ouvre en remplaçant la feuille, et la publication en
 * remplaçant l'écran
 *
 * La feuille « Créer » mène ici par `replace`, et l'écran mène à la publication
 * créée par `replace` aussi. Conséquence voulue : le geste de retour ne ramène
 * jamais à un formulaire vidé — ni à la feuille, dont le choix a été consommé,
 * ni à la saisie dont l'envoi vient de réussir.
 *
 * ## Pourquoi on ouvre la publication qui vient d'être créée
 *
 * Le fil charge des pages ; il ne s'abonne pas aux écritures. Revenir au fil
 * après un envoi montrerait donc une liste **sans** la nouvelle publication,
 * et son auteur conclurait que l'envoi a échoué. La publication créée est la
 * seule confirmation qui ne laisse pas de doute.
 *
 * ## Pourquoi les listes d'écoles ne bloquent pas le formulaire
 *
 * Les écoles et les classes demandent un aller-retour réseau ; le titre, le
 * texte et les photos n'en demandent aucun. Le formulaire s'affiche donc
 * entièrement, et seule la section « public » signale le chargement ou
 * l'échec — un parent peut commencer à écrire pendant que les listes
 * arrivent.
 */
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { userMessage } from '@fl/firebase';
import {
  POST_CATEGORIES,
  POST_CATEGORY_LABELS,
  TEXT_LIMITS,
  UPLOAD_LIMITS,
  firstIssueByField,
  hasPermission,
  postInputSchema,
  type PostInput,
} from '@fl/shared';
import type { PostCategory } from '@fl/types';

import { AudienceField } from '@/components/compose/audience-field';
import { PhotoField } from '@/components/compose/photo-field';
import { AppText, Button, Card, Screen } from '@/components/ui';
import { ChoiceList, ConsentRow, FormAlert, TextField } from '@/components/ui/form';
import { useCreatePost, type PickedPhoto } from '@/hooks/use-create-post';
import { useReferenceData } from '@/hooks/use-reference-data';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/** Valeurs initiales, alignées sur l'éditeur d'administration. */
const INITIAL_CATEGORY: PostCategory = 'information';

/**
 * Ciblage retenu par l'écran.
 *
 * `null` est un état à part entière : c'est ce que rend `AudienceField` tant
 * que l'école, le niveau ou la classe ne sont pas choisis. Le schéma, lui,
 * exige un ciblage complet — d'où la conversion au moment de publier.
 */
type Audience = PostInput['audience'] | null;

export default function PublishScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, status } = useAuth();
  const router = useRouter();

  const { submitting, progress, error, submit } = useCreatePost();

  /**
   * Les listes de référence ne sont lisibles qu'une fois connecté : avant la
   * connexion la requête serait refusée par les règles, on ne la lance donc
   * pas.
   */
  const { data: reference, retry } = useReferenceData(status === 'signedIn');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<PostCategory>(INITIAL_CATEGORY);
  const [audience, setAudience] = useState<Audience>({ type: 'all' });
  const [linkUrl, setLinkUrl] = useState('');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [photos, setPhotos] = useState<readonly PickedPhoto[]>([]);

  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const markTouched = useCallback((field: string) => {
    setTouched((previous) => (previous[field] ? previous : { ...previous, [field]: true }));
  }, []);

  const categoryOptions = useMemo(
    () => POST_CATEGORIES.map((value) => ({ value, label: POST_CATEGORY_LABELS[value] })),
    [],
  );

  const trimmedLink = linkUrl.trim();

  /**
   * Erreurs du formulaire, une par champ.
   *
   * `postInputSchema` valide tout sauf le public : `AudienceField` signale
   * `null` tant que l'école, le niveau ou la classe ne sont pas choisis, et
   * cette absence de choix n'est pas une forme que le schéma représente — il
   * exige un ciblage. Son message est donc écrit ici, en français, plutôt que
   * repris de Zod : l'erreur d'un objet manquant ne s'adresse pas à un parent.
   *
   * Le lien vide est omis de la validation : `z.url()` refuse la chaîne vide,
   * alors que « pas de lien » est un état légitime du formulaire.
   */
  const issues = useMemo(() => {
    const parsed = postInputSchema.safeParse({
      title: title.trim(),
      body: body.trim(),
      category,
      ...(audience ? { audience } : {}),
      commentsEnabled,
      ...(trimmedLink ? { linkUrl: trimmedLink } : {}),
    });

    const messages: Record<string, string> = parsed.success
      ? {}
      : firstIssueByField(parsed.error.issues);
    if (!audience) messages.audience = 'Choisissez à qui s’adresse cette publication.';

    return messages;
  }, [title, body, category, audience, commentsEnabled, trimmedLink]);

  /** Un message ne s'affiche qu'après interaction : avant, il accuse à tort. */
  const visibleError = useCallback(
    (field: string): string | undefined =>
      attempted || touched[field] ? issues[field] : undefined,
    [attempted, touched, issues],
  );

  async function handleSubmit(): Promise<void> {
    setAttempted(true);

    // `audience` est vérifié à part : `issues` porte déjà son message, mais le
    // type ne permet pas de le transmettre tant qu'il vaut `null`.
    if (Object.keys(issues).length > 0 || !audience) return;

    const postId = await submit({
      title: title.trim(),
      body: body.trim(),
      category,
      audience,
      photos,
      commentsEnabled,
      ...(trimmedLink ? { linkUrl: trimmedLink } : {}),
    });

    // En cas d'échec, `submit` a déjà posé l'erreur : l'écran n'a rien à dire
    // de plus, et surtout rien qui masque le message d'origine.
    if (!postId) return;

    router.replace(`/post/${postId}`);
  }

  // La feuille « Créer » n'affiche déjà pas cette option à un parent, et la
  // règle Firestore refuserait l'écriture de toute façon. Ce garde n'est donc
  // pas une protection mais une explication : un écran vide, atteint par un
  // lien profond, ne dit pas pourquoi il est vide.
  if (!hasPermission(profile?.role, 'post.create')) {
    return (
      <Screen edges={['bottom']}>
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.lg }}>
          <FormAlert tone="info" title="Publication réservée">
            La publication d’informations est réservée aux membres de la FCPE. Vous pouvez en
            revanche poser une question, proposer une idée ou signaler un problème depuis le bouton
            « Créer ».
          </FormAlert>
          <Button label="Fermer" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.lg }}>
          <Card style={{ gap: theme.spacing.lg }}>
            <TextField
              label="Titre"
              value={title}
              onChangeText={setTitle}
              onBlur={() => markTouched('title')}
              maxLength={TEXT_LIMITS.postTitle}
              placeholder="Sortie au musée le 12 octobre"
              error={visibleError('title')}
            />

            <TextField
              label="Texte"
              value={body}
              onChangeText={setBody}
              onBlur={() => markTouched('body')}
              maxLength={TEXT_LIMITS.postBody}
              multiline
              lines={8}
              placeholder="Ce qu’il faut savoir, en quelques phrases…"
              error={visibleError('body')}
            />

            <ChoiceList
              label="Catégorie"
              options={categoryOptions}
              value={category}
              onChange={setCategory}
              error={visibleError('category')}
              hint="La catégorie sert de repère dans le fil et à filtrer les publications."
            />
          </Card>

          <Card style={{ gap: theme.spacing.lg }}>
            {reference.status === 'idle' || reference.status === 'loading' ? (
              <AppText variant="caption" color="muted">
                Chargement des écoles et des classes…
              </AppText>
            ) : null}

            {reference.status === 'error' ? (
              <View style={{ gap: theme.spacing.md }}>
                <FormAlert tone="error" title="Listes indisponibles">
                  {userMessage(reference.error)} Vous pouvez publier pour tous les parents dès
                  maintenant, ou réessayer pour cibler une école.
                </FormAlert>
                <Button label="Réessayer" variant="secondary" onPress={retry} />
              </View>
            ) : null}

            <AudienceField
              role={profile?.role}
              reference={reference.status === 'ready' ? reference.data : null}
              onChange={setAudience}
              error={visibleError('audience')}
            />
          </Card>

          <Card style={{ gap: theme.spacing.lg }}>
            <PhotoField photos={photos} onChange={setPhotos} disabled={submitting} />

            <TextField
              label="Lien externe"
              optional
              value={linkUrl}
              onChangeText={setLinkUrl}
              onBlur={() => markTouched('linkUrl')}
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://…"
              error={visibleError('linkUrl')}
            />
          </Card>

          <Card>
            <ConsentRow
              label="Autoriser les commentaires"
              description="Les parents pourront répondre sous cette publication."
              value={commentsEnabled}
              onChange={setCommentsEnabled}
            />
          </Card>

          {error ? <FormAlert tone="error">{userMessage(error)}</FormAlert> : null}

          {/* Le bouton est en bas, les champs sont en haut : sans ce repère, un
              appui qui ne déclenche rien parce que le titre est trop court
              ressemble à une panne. */}
          {attempted && Object.keys(issues).length > 0 ? (
            <FormAlert tone="warning" title="Publication incomplète">
              Les champs signalés plus haut demandent une correction.
            </FormAlert>
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
            <Button
              label="Publier"
              onPress={() => void handleSubmit()}
              loading={submitting}
              disabled={submitting}
            />

            {submitting && progress ? (
              // Annoncé aux lecteurs d'écran : sans cela, un envoi de photos
              // qui dure dix secondes ne dirait rien à qui ne voit pas
              // l'indicateur tourner.
              <AppText
                variant="caption"
                color="secondary"
                align="center"
                accessibilityLiveRegion="polite"
              >
                {progress}
              </AppText>
            ) : null}

            <Button
              label="Annuler"
              variant="ghost"
              disabled={submitting}
              onPress={() => router.back()}
            />

            <AppText variant="caption" color="muted">
              {`Jusqu’à ${UPLOAD_LIMITS.maxAttachmentsPerPost} photos, réduites à ` +
                `${UPLOAD_LIMITS.image.maxWidth} pixels de côté avant l’envoi.`}
            </AppText>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
