import QuillCheckbox from './QuillCheckbox';

interface Props {
  checked?: boolean;
  onChange: () => void;
  size?: number;
}

export default function Checkbox({ checked = false, onChange, size = 20 }: Props) {
  return (
    <QuillCheckbox
      checked={checked}
      onChange={() => onChange()}
      size={size}
    />
  );
}
