'use client';

/**
 * Choix du ciblage d'une publication.
 *
 * ## Pourquoi l'audience est reconstruite et non amendée
 *
 * `Audience` est une union discriminée : `school` porte un `schoolId`, `level`
 * porte en plus un `level`, `class` porte un `classId`. Conserver les champs du
 * type précédent produirait une audience incohérente — par exemple
 * `{ type: 'class', classId: '…', level: 'cm2' }` — dont `buildAudienceKeys`
 * ne saurait que faire. Changer de type repart donc d'une audience neuve.
 *
 * ## Pourquoi rien n'est élargi en silence
 *
 * Si les données de référence ne sont pas encore chargées, `initialAudienceFor`
 * produit une audience **incomplète** (identifiant vide) plutôt que de retomber
 * sur « Tous les parents ». Une audience incomplète fait échouer la validation,
 * ce qui est visible et corrigeable ; un repli silencieux enverrait une
 * publication destinée à une classe à toutes les familles du groupe scolaire.
 * Les options concernées sont désactivées tant que la liste manque, pour que le
 * cas ne se présente pas.
 */
import { AUDIENCE_TYPE_LABELS, CLASS_LEVEL_LABELS } from '@fl/shared';
import type { Audience, AudienceType, ClassLevel, School, SchoolClass } from '@fl/types';

/** Types proposés, du plus large au plus étroit. */
const AUDIENCE_TYPES: readonly AudienceType[] = ['all', 'school', 'level', 'class', 'fcpe'];

const SELECT_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50';

const LABEL_CLASS = 'text-sm font-medium text-foreground';

/**
 * Audience initiale pour un type donné.
 *
 * Renvoie une audience **incomplète** quand la référence manque : voir l'en-tête.
 */
function initialAudienceFor(
  type: AudienceType,
  schools: readonly School[],
  classes: readonly SchoolClass[],
): Audience {
  const firstSchool = schools[0];

  switch (type) {
    case 'all':
      return { type: 'all' };
    case 'fcpe':
      return { type: 'fcpe' };
    case 'school':
      return { type: 'school', schoolId: firstSchool?.id ?? '' };
    case 'level':
      return {
        type: 'level',
        schoolId: firstSchool?.id ?? '',
        level: firstSchool?.classLevels[0] ?? 'PS',
      };
    case 'class':
      return { type: 'class', classId: classes[0]?.id ?? '' };
  }
}

interface AudiencePickerProps {
  readonly value: Audience;
  readonly onChange: (audience: Audience) => void;
  readonly schools: readonly School[];
  readonly classes: readonly SchoolClass[];
}

export function AudiencePicker({
  value,
  onChange,
  schools,
  classes,
}: AudiencePickerProps): React.JSX.Element {
  // L'école de travail sert à restreindre les niveaux proposés. Elle vient de
  // l'audience quand celle-ci en porte une, sinon de la première école connue.
  const schoolId = value.schoolId ?? schools[0]?.id ?? '';
  const school = schools.find((item) => item.id === schoolId);
  const levels: readonly ClassLevel[] = school?.classLevels ?? [];

  const needsSchool = value.type === 'school' || value.type === 'level';
  const needsLevel = value.type === 'level';
  const needsClass = value.type === 'class';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className={LABEL_CLASS} htmlFor="audience-type">
          Destinataires
        </label>
        <select
          id="audience-type"
          className={SELECT_CLASS}
          value={value.type}
          onChange={(event) => {
            onChange(initialAudienceFor(event.target.value as AudienceType, schools, classes));
          }}
        >
          {AUDIENCE_TYPES.map((type) => (
            <option
              key={type}
              value={type}
              // Sans école connue, « Une école » et « Un niveau » ne peuvent pas
              // être décrits ; sans classe connue, « Une classe » non plus.
              disabled={
                ((type === 'school' || type === 'level') && schools.length === 0) ||
                (type === 'class' && classes.length === 0)
              }
            >
              {AUDIENCE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {needsSchool ? (
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="audience-school">
            École
          </label>
          <select
            id="audience-school"
            className={SELECT_CLASS}
            value={schoolId}
            onChange={(event) => {
              const next = schools.find((item) => item.id === event.target.value);
              // Le niveau dépend de l'école : en changer impose de le reprendre,
              // sinon la clé d'audience désignerait un niveau que cette école ne
              // propose pas.
              onChange(
                needsLevel
                  ? {
                      type: 'level',
                      schoolId: next?.id ?? '',
                      level: next?.classLevels[0] ?? 'PS',
                    }
                  : { type: 'school', schoolId: next?.id ?? '' },
              );
            }}
          >
            {schools.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {needsLevel ? (
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="audience-level">
            Niveau
          </label>
          <select
            id="audience-level"
            className={SELECT_CLASS}
            value={value.level ?? levels[0] ?? ''}
            onChange={(event) => {
              onChange({
                type: 'level',
                schoolId,
                level: event.target.value as ClassLevel,
              });
            }}
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {CLASS_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {needsClass ? (
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="audience-class">
            Classe
          </label>
          <select
            id="audience-class"
            className={SELECT_CLASS}
            value={value.classId ?? ''}
            onChange={(event) => {
              onChange({ type: 'class', classId: event.target.value });
            }}
          >
            {/* Toutes les classes sont proposées, groupées par école : un même
                groupe scolaire en compte une vingtaine, ce qui tient dans une
                liste déroulante et évite une étape de sélection
                supplémentaire. */}
            {schools.map((item) => {
              const ofSchool = classes.filter((one) => one.schoolId === item.id);
              if (ofSchool.length === 0) return null;

              return (
                <optgroup key={item.id} label={item.name}>
                  {ofSchool.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      ) : null}
    </div>
  );
}
