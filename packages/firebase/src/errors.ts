/**
 * Normalisation des erreurs.
 *
 * Objectif : ne jamais laisser remonter à l'interface un message technique
 * incompréhensible (« Missing or insufficient permissions », code 7). On
 * traduit systématiquement vers un `AppError` doté d'un code stable, que
 * l'interface sait présenter en français.
 */
import type { AppError, AppErrorCode } from '@fl/types';

/** Codes d'erreur Firestore / Auth, mappés vers nos codes applicatifs. */
const ERROR_CODE_MAP: Record<string, AppErrorCode> = {
  // Firestore
  'permission-denied': 'permission-denied',
  'not-found': 'not-found',
  'already-exists': 'already-exists',
  'invalid-argument': 'invalid-argument',
  'failed-precondition': 'failed-precondition',
  'resource-exhausted': 'resource-exhausted',
  unauthenticated: 'unauthenticated',
  unavailable: 'network',
  'deadline-exceeded': 'network',
  cancelled: 'unknown',
  aborted: 'failed-precondition',
  // Authentication
  'auth/email-already-in-use': 'already-exists',
  'auth/invalid-email': 'invalid-argument',
  'auth/weak-password': 'invalid-argument',
  'auth/user-disabled': 'permission-denied',
  'auth/user-not-found': 'not-found',
  'auth/wrong-password': 'invalid-argument',
  'auth/invalid-credential': 'invalid-argument',
  'auth/too-many-requests': 'rate-limited',
  'auth/network-request-failed': 'network',
  'auth/requires-recent-login': 'failed-precondition',
  // Cloud Functions
  'functions/unauthenticated': 'unauthenticated',
  'functions/permission-denied': 'permission-denied',
  'functions/not-found': 'not-found',
  'functions/invalid-argument': 'invalid-argument',
  'functions/failed-precondition': 'failed-precondition',
  'functions/resource-exhausted': 'rate-limited',
  'functions/unavailable': 'network',
};

/** Messages destinés à l'utilisateur, par code applicatif. */
const USER_MESSAGES: Record<AppErrorCode, string> = {
  unauthenticated: 'Vous devez être connecté pour effectuer cette action.',
  'permission-denied': "Vous n'avez pas les droits nécessaires pour cette action.",
  'not-found': "Cet élément n'existe plus ou a été supprimé.",
  'already-exists': 'Cet élément existe déjà.',
  'invalid-argument': 'Les informations saisies sont incorrectes.',
  'failed-precondition':
    "L'action n'est pas possible dans l'état actuel. Rechargez la page et réessayez.",
  'resource-exhausted': 'Trop de données demandées. Réessayez dans quelques instants.',
  'rate-limited': 'Vous avez effectué trop d’actions. Patientez un instant avant de réessayer.',
  network: 'Connexion impossible. Vérifiez votre réseau puis réessayez.',
  unknown: "Une erreur inattendue s'est produite. Réessayez dans quelques instants.",
};

/** Extrait un code exploitable d'une erreur inconnue. */
function extractCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Erreur inconnue';
}

/**
 * Convertit n'importe quelle erreur en `AppError`.
 *
 * À appeler dans la couche repository : c'est le seul endroit où les erreurs
 * du SDK Firebase sont connues. Au-dessus, tout le monde manipule `AppError`.
 */
export function toAppError(error: unknown): AppError {
  const rawCode = extractCode(error);
  const mapped = rawCode ? ERROR_CODE_MAP[rawCode] : undefined;
  const code: AppErrorCode = mapped ?? 'unknown';

  return {
    code,
    message: extractMessage(error),
    details: rawCode ? { firebaseCode: rawCode } : undefined,
    cause: error,
  };
}

/** Message présentable à l'utilisateur, en français. */
export function userMessage(error: AppError | unknown): string {
  if (isAppError(error)) {
    return USER_MESSAGES[error.code];
  }
  return USER_MESSAGES[toAppError(error).code];
}

/** Garde de type. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as AppError).code === 'string'
  );
}

/** Crée un `AppError` à partir d'un code et d'un message explicite. */
export function appError(
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return { code, message, details };
}

/** Raccourci : une erreur de permission, cas le plus fréquent. */
export function permissionDenied(message = 'Action non autorisée.'): AppError {
  return appError('permission-denied', message);
}

/** Raccourci : une erreur de validation. */
export function invalidArgument(message: string, details?: Record<string, unknown>): AppError {
  return appError('invalid-argument', message, details);
}

/**
 * Enveloppe une opération asynchrone pour qu'elle ne rejette jamais :
 * elle renvoie toujours un `Result<T>`. Utilisé par la couche services, ce qui
 * évite les `try/catch` répétés dans les écrans.
 */
export async function attempt<T>(
  operation: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: AppError }> {
  try {
    const value = await operation();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}
