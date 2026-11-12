import { useEffect, useRef, useState } from "react";
import { parseNumericDraft } from "./measurements";

interface Props {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
  onCommit: (value: number) => boolean | void;
  onInvalidValue: (message: string) => void;
}

/** Keep incomplete typing out of project state; one completed edit is one undo step. */
export default function DimensionInput({
  label,
  value,
  min,
  max,
  unit,
  disabled,
  onCommit,
  onInvalidValue,
}: Props) {
  const [draft, setDraft] = useState(value === null ? "" : String(value)),
    [invalid, setInvalid] = useState(false);
  const editing = useRef(false),
    cancelBlur = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(value === null ? "" : String(value));
      setInvalid(false);
    }
  }, [value]);
  function finish() {
    editing.current = false;
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    const next = parseNumericDraft(draft, min, max);
    if (next === null) {
      setDraft(value === null ? "" : String(value));
      setInvalid(true);
      onInvalidValue(
        `Enter a value between ${min} and ${max} ${unit}. The previous value was kept.`,
      );
      return;
    }
    setInvalid(false);
    if (value !== null && Math.abs(next - value) < 1e-9) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (onCommit(next) === false) setDraft(value === null ? "" : String(value));
    else setDraft(String(next));
  }
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step="any"
      value={draft}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      title={invalid ? `Enter ${min}–${max} ${unit}` : undefined}
      onFocus={() => {
        editing.current = true;
        setInvalid(false);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelBlur.current = true;
          setDraft(value === null ? "" : String(value));
          setInvalid(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
