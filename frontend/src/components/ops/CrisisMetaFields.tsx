import type { OpsCrisis } from '../../ops/opsApi';
import { OpsDatetimeField } from './OpsDatetimeField';

export type CrisisMetaDraft = {
  archive_status: OpsCrisis['archive_status'];
  event_start: string;
  event_end: string;
};

type Props = {
  value: CrisisMetaDraft;
  onChange: (next: CrisisMetaDraft) => void;
  statusOptions?: OpsCrisis['archive_status'][];
  labels: {
    status: string;
    eventStart: string;
    eventEnd: string;
    eventHint: string;
    statusDraft: string;
    statusActive: string;
    statusArchived: string;
  };
  disabled?: boolean;
};

const STATUS_LABEL_KEY: Record<OpsCrisis['archive_status'], keyof Props['labels']> = {
  draft: 'statusDraft',
  active: 'statusActive',
  archived: 'statusArchived',
};

export function CrisisMetaFields({
  value,
  onChange,
  statusOptions = ['draft', 'active', 'archived'],
  labels,
  disabled,
}: Props) {
  return (
    <div className="ops-crisis-meta-fields">
      <label className="ops-field">
        <span>{labels.status}</span>
        <select
          className="ops-input"
          value={value.archive_status}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              archive_status: e.target.value as OpsCrisis['archive_status'],
            })
          }
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {labels[STATUS_LABEL_KEY[s]]}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        <span>{labels.eventStart}</span>
        <OpsDatetimeField
          value={value.event_start}
          onChange={(event_start) => onChange({ ...value, event_start })}
          disabled={disabled}
        />
      </label>
      <label className="ops-field">
        <span>{labels.eventEnd}</span>
        <OpsDatetimeField
          value={value.event_end}
          onChange={(event_end) => onChange({ ...value, event_end })}
          disabled={disabled}
        />
      </label>
      <p className="muted ops-crisis-meta-hint">{labels.eventHint}</p>
    </div>
  );
}
