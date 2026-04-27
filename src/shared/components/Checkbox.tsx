import QuillCheckbox from './QuillCheckbox';

interface Props {
  checked?: boolean;
  onChange: () => void;
  size?: number;
  onDrawComplete?: () => void;
}

export default function Checkbox({ checked = false, onChange, size = 20, onDrawComplete }: Props) {
  return (
    <QuillCheckbox
      checked={checked}
      onChange={() => onChange()}
      size={size}
      onDrawComplete={onDrawComplete}
    />
  );
}
