/**
 * Ouvre le contenu qu'une notification annonce.
 *
 * ## Le défaut que ce fichier répare
 *
 * `onPostPublished` glisse un `deeplink` dans chaque notification, et
 * `docs/05-notifications.md` promet qu'il « ouvre directement le contenu
 * concerné, jamais l'écran d'accueil ». C'était faux : l'application ne lisait
 * ce champ nulle part, donc un tap ouvrait l'application sur son écran
 * d'accueil. Rien ne le signalait — pas d'erreur, pas d'écran vide, juste le
 * mauvais écran, ce qui ressemble à un fonctionnement normal.
 *
 * ## Ce que fait ce fichier, et ce qu'il ne fait pas
 *
 * Il ne décide de rien. `cibleDeLaNotification` décide — quel appui compte,
 * quelle notification a déjà été traitée, quelle route ouvrir — et elle est
 * pure, donc couverte. Ici il ne reste que le branchement : s'abonner, garder
 * mémoire, naviguer. C'est la partie qui exige un appareil, et elle est réduite
 * au minimum pour cette raison.
 *
 * ## Une décision qui appartient à ce fichier
 *
 * **On attend que le compte soit actif.** Naviguer pendant que la session se
 * restaure entrerait en course avec la redirection du layout racine ; naviguer
 * pour un compte en attente de validation serait annulé aussitôt par cette même
 * redirection. La cible reste donc en attente tant que le compte n'est pas
 * `active` — c'est précisément ce qui fait fonctionner le démarrage à froid, où
 * la notification appuyée est connue avant que la session ne le soit.
 *
 * ## Limite connue, écrite ici plutôt que découverte plus tard
 *
 * Si un parent se déconnecte, appuie sur une notification, puis se connecte
 * avec un **autre** compte, il est conduit vers le contenu du premier. Les
 * règles Firestore refusent alors la lecture et l'écran affiche une erreur.
 * Ce n'est pas une faille — la barrière reste les règles, jamais l'interface —
 * mais c'est un écran d'erreur là où l'on attendait l'accueil. Le cas demande
 * deux gestes délibérés, et le traiter supposerait de mémoriser l'identifiant
 * du destinataire, que la notification ne porte pas.
 */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { cibleDeLaNotification } from '@/lib/notification-target';

export interface NotificationRoutingOptions {
  /**
   * Vrai quand l'utilisateur est connecté, son profil résolu et son compte
   * `active`. Tant que c'est faux, la cible reste en attente.
   */
  readonly pret: boolean;
}

/** Navigue vers le contenu visé par la dernière notification appuyée. */
export function useNotificationRouting({ pret }: NotificationRoutingOptions): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  /** Identifiant de la dernière notification déjà traitée. */
  const dejaTraitee = useRef<string | null>(null);

  useEffect(() => {
    if (!pret) return;

    const cible = cibleDeLaNotification(
      response
        ? {
            identifiant: response.notification.request.identifier,
            action: response.actionIdentifier,
            donnees: response.notification.request.content.data,
          }
        : null,
      {
        dejaTraitee: dejaTraitee.current,
        actionParDefaut: Notifications.DEFAULT_ACTION_IDENTIFIER,
      },
    );

    if (!cible) return;

    dejaTraitee.current = cible.identifiant;
    router.push(cible.route);
  }, [pret, response, router]);
}
