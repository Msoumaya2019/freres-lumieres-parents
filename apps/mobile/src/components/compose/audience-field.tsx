/**
 * Choix du public d'une publication.
 *
 * ## Changer de type reconstruit l'audience, il ne la corrige pas
 *
 * Passer de « une école » à « un niveau » ne peut pas conserver l'école déjà
 * choisie : les deux ciblages n'ont pas la même forme, et un reliquat de
 * l'ancien produirait un ciblage incohérent — le genre de valeur qui passe la
 * validation tout en désignant autre chose que ce que l'auteur croit.
 *
 * ## Un ciblage incomplet n'est pas transmis
 *
 * Tant que l'école, le niveau ou la classe ne sont pas choisis, le composant
 * signale `null` : le formulaire sait alors qu'il manque une réponse, et le
 * dit. Inventer une valeur par défaut — « tous les parents » — serait pire :
 * la publication partirait à toute l'organisation alors que l'auteur croyait
 * viser une classe.
 *
 * ## Pourquoi aucune liste n'est chargée ici
 *
 * Les écoles et les classes arrivent par `reference`, déjà chargées par
 * l'écran. Ce composant ne lit rien : il choisit.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  AUDIENCE_TYPE_LABELS,
  CLASS_LEVELS,
  CLASS_LEVEL_SHORT_LABELS,
  allowedAudienceTypes,
  type PostInput,
} from '@fl/shared';
import type { AudienceType, ClassLevel, UserRole } from '@fl/types';

import { AppText } from '@/components/ui';
import { ChoiceList } from '@/components/ui/form';
import { classesOfSchool, type ReferenceData } from '@/hooks/use-reference-data';
import { useTheme } from '@/providers/theme-provider';

export interface AudienceFieldProps {
  role: UserRole | undefined;
  reference: ReferenceData | null;
  /** `null` tant que le ciblage est incomplet. */
  onChange: (audience: PostInput['audience'] | null) => void;
  error?: string | undefined;
}

/**
 * Compose un ciblage, ou `null` s'il manque une réponse.
 *
 * Le type de retour est celui du schéma : les cinq formes y sont distinctes, et
 * une forme « niveau » sans niveau n'existe pas.
 */
function audienceFor(
  type: AudienceType,
  schoolId: string | null,
  level: ClassLevel | null,
  classId: string | null,
): PostInput['audience'] | null {
  switch (type) {
    case 'all':
      return { type: 'all' };
    case 'fcpe':
      return { type: 'fcpe' };
    case 'school':
      return schoolId ? { type: 'school', schoolId } : null;
    case 'level':
      return schoolId && level ? { type: 'level', schoolId, level } : null;
    case 'class':
      return classId ? { type: 'class', classId } : null;
  }
}

export function AudienceField({
  role,
  reference,
  onChange,
  error,
}: AudienceFieldProps): React.JSX.Element {
  const { theme } = useTheme();

  const [type, setType] = useState<AudienceType>('all');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [level, setLevel] = useState<ClassLevel | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  const types = allowedAudienceTypes(role ?? 'parent');

  const typeOptions = useMemo(
    () => types.map((value) => ({ value, label: AUDIENCE_TYPE_LABELS[value] })),
    [types],
  );

  const schoolOptions = useMemo(
    () => (reference?.schools ?? []).map((school) => ({ value: school.id, label: school.name })),
    [reference],
  );

  /**
   * Niveaux réellement présents dans l'école choisie.
   *
   * Les proposer tous — de la petite section au CM2 — laisserait publier vers
   * un niveau que l'établissement n'a pas : le ciblage serait alors valide mais
   * sans destinataire, et l'auteur croirait avoir touché quelqu'un.
   */
  const levelOptions = useMemo(() => {
    const present = new Set(classesOfSchool(reference, schoolId).map((item) => item.level));
    return CLASS_LEVELS.filter((candidate) => present.has(candidate)).map((value) => ({
      value,
      label: CLASS_LEVEL_SHORT_LABELS[value],
    }));
  }, [reference, schoolId]);

  const classOptions = useMemo(
    () =>
      classesOfSchool(reference, schoolId).map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [reference, schoolId],
  );

  /** Change le type : les sous-choix précédents ne s'appliquent plus. */
  function selectType(next: AudienceType): void {
    setType(next);
    setSchoolId(null);
    setLevel(null);
    setClassId(null);
    onChange(audienceFor(next, null, null, null));
  }

  function selectSchool(next: string): void {
    setSchoolId(next);
    setLevel(null);
    setClassId(null);
    onChange(audienceFor(type, next, null, null));
  }

  function selectLevel(next: ClassLevel): void {
    setLevel(next);
    onChange(audienceFor(type, schoolId, next, null));
  }

  function selectClass(next: string): void {
    setClassId(next);
    onChange(audienceFor(type, schoolId, level, next));
  }

  const needsSchool = type === 'school' || type === 'level' || type === 'class';

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <ChoiceList
        label="Qui doit voir cette publication ?"
        options={typeOptions}
        value={type}
        onChange={selectType}
        error={error}
        emptyMessage="Votre compte ne permet pas encore de publier."
      />

      {needsSchool ? (
        <ChoiceList
          label="École"
          options={schoolOptions}
          value={schoolId}
          onChange={selectSchool}
          emptyMessage="Aucune école n’est disponible pour le moment."
        />
      ) : null}

      {type === 'level' ? (
        <ChoiceList
          label="Niveau"
          options={levelOptions}
          value={level}
          onChange={selectLevel}
          emptyMessage="Choisissez d’abord une école."
        />
      ) : null}

      {type === 'class' ? (
        <ChoiceList
          label="Classe"
          options={classOptions}
          value={classId}
          onChange={selectClass}
          emptyMessage="Choisissez d’abord une école."
        />
      ) : null}

      {type === 'fcpe' ? (
        <AppText variant="caption" color="muted">
          Cette publication ne sera visible que par les membres de la FCPE.
        </AppText>
      ) : null}
    </View>
  );
}
