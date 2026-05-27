/** UNDP core + modular appendix — config-driven questionnaire */

export type OptionDef = { id: string; labelKey: string };

export type AppendixField =
  | { key: string; type: 'select'; labelKey: string; options: OptionDef[] }
  | { key: string; type: 'multiselect'; labelKey: string; options: OptionDef[] };

export type AppendixSection = {
  id: string;
  titleKey: string;
  fields: AppendixField[];
};

export const INFRASTRUCTURE_TYPES: OptionDef[] = [
  { id: 'residential', labelKey: 'q.infra.residential' },
  { id: 'commercial', labelKey: 'q.infra.commercial' },
  { id: 'government', labelKey: 'q.infra.government' },
  { id: 'utility', labelKey: 'q.infra.utility' },
  { id: 'transport_communication', labelKey: 'q.infra.transport' },
  { id: 'community', labelKey: 'q.infra.community' },
  { id: 'public_recreation', labelKey: 'q.infra.public_recreation' },
  { id: 'other', labelKey: 'q.infra.other' },
];

export const CRISIS_TYPES: OptionDef[] = [
  { id: 'earthquake', labelKey: 'q.crisis.earthquake' },
  { id: 'flood', labelKey: 'q.crisis.flood' },
  { id: 'tsunami', labelKey: 'q.crisis.tsunami' },
  { id: 'hurricane_cyclone', labelKey: 'q.crisis.hurricane' },
  { id: 'wildfire', labelKey: 'q.crisis.wildfire' },
  { id: 'explosion', labelKey: 'q.crisis.explosion' },
  { id: 'chemical', labelKey: 'q.crisis.chemical' },
  { id: 'conflict', labelKey: 'q.crisis.conflict' },
  { id: 'civil_unrest', labelKey: 'q.crisis.civil_unrest' },
];

export const DAMAGE_LEVELS = ['minimal', 'partial', 'complete'] as const;
export type DamageLevel = (typeof DAMAGE_LEVELS)[number];

export const DESCRIPTION_LANGUAGES = [
  { code: 'en', labelKey: 'q.lang.en' },
  { code: 'zh', labelKey: 'q.lang.zh' },
  { code: 'zh-Hant', labelKey: 'q.lang.zh-Hant' },
  { code: 'de', labelKey: 'q.lang.de' },
  { code: 'pt', labelKey: 'q.lang.pt' },
  { code: 'ar', labelKey: 'q.lang.ar' },
  { code: 'fr', labelKey: 'q.lang.fr' },
  { code: 'ru', labelKey: 'q.lang.ru' },
  { code: 'es', labelKey: 'q.lang.es' },
] as const;

export const APPENDIX_SECTIONS: AppendixSection[] = [
  {
    id: 'utilities_health',
    titleKey: 'q.appendix.utilities',
    fields: [
      {
        key: 'electricity_condition',
        type: 'select',
        labelKey: 'q.electricity',
        options: [
          { id: 'none', labelKey: 'q.electricity.none' },
          { id: 'minor', labelKey: 'q.electricity.minor' },
          { id: 'moderate', labelKey: 'q.electricity.moderate' },
          { id: 'severe', labelKey: 'q.electricity.severe' },
          { id: 'destroyed', labelKey: 'q.electricity.destroyed' },
          { id: 'unknown', labelKey: 'q.unknown' },
        ],
      },
      {
        key: 'health_services',
        type: 'select',
        labelKey: 'q.health',
        options: [
          { id: 'full', labelKey: 'q.health.full' },
          { id: 'partial', labelKey: 'q.health.partial' },
          { id: 'disrupted', labelKey: 'q.health.disrupted' },
          { id: 'none', labelKey: 'q.health.none' },
          { id: 'unknown', labelKey: 'q.unknown' },
        ],
      },
    ],
  },
  {
    id: 'pressing_needs',
    titleKey: 'q.appendix.needs',
    fields: [
      {
        key: 'pressing_needs',
        type: 'multiselect',
        labelKey: 'q.pressingNeeds',
        options: [
          { id: 'food_water', labelKey: 'q.needs.food_water' },
          { id: 'cash', labelKey: 'q.needs.cash' },
          { id: 'health', labelKey: 'q.needs.health' },
          { id: 'shelter', labelKey: 'q.needs.shelter' },
          { id: 'livelihood', labelKey: 'q.needs.livelihood' },
          { id: 'wash', labelKey: 'q.needs.wash' },
          { id: 'services', labelKey: 'q.needs.services' },
          { id: 'protection', labelKey: 'q.needs.protection' },
          { id: 'local_support', labelKey: 'q.needs.local_support' },
          { id: 'education', labelKey: 'q.needs.education' },
          { id: 'other', labelKey: 'q.needs.other' },
        ],
      },
    ],
  },
];
