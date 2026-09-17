/**
 * Erreurs du transport Expo Push, nommées pour être reconnues.
 *
 * ## Pourquoi une classe, et pas un message
 *
 * Un `401` et une panne réseau se ressemblent dans un journal : les deux
 * produisent « l'appel a échoué ». Ils n'ont pourtant rien de commun — l'un se
 * répare tout seul, l'autre se répare en remplaçant un secret, et **il ne se
 * réparera jamais tout seul**. Tant que la seule différence est une phrase dans
 * un message, personne ne peut la reconnaître par programme, et la distinction
 * ne survit pas à la première reformulation.
 *
 * Le nom de cette classe vient du vocabulaire de la documentation du service,
 * qui appelle `InvalidCredentials` l'erreur d'un jeton d'accès refusé. Le code
 * et la documentation disent donc la même chose, ce qui est la seule façon de
 * s'en souvenir dans six mois.
 *
 * ## Ce que cette erreur n'est pas
 *
 * Elle n'est pas une erreur d'envoi ordinaire, et ne doit jamais être comptée
 * comme telle : un `failedCount` de 412 présente une configuration cassée comme
 * une audience injoignable, et c'est exactement la confusion que ce module
 * existe pour supprimer. Elle n'est pas non plus réessayable — retenter avec le
 * même jeton donne le même refus, autant de fois qu'on insiste.
 */
export class PushCredentialsError extends Error {
  /** Statut HTTP renvoyé par le service. */
  readonly statut: number;

  constructor(statut: number, message?: string) {
    super(
      message ??
        `Le service Expo Push a refusé le jeton d’accès (HTTP ${statut}). ` +
          'Aucun envoi ne peut aboutir tant qu’il n’a pas été remplacé.',
    );
    this.name = 'PushCredentialsError';
    this.statut = statut;
  }
}
