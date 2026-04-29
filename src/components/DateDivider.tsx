import './DateDivider.css'

interface Props {
  label: string
}

export function DateDivider({ label }: Props) {
  return (
    <div className="date-divider">
      <span className="date-divider__label">{label}</span>
      <span className="date-divider__line" />
    </div>
  )
}
