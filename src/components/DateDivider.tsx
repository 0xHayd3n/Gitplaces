import { memo } from 'react'
import './DateDivider.css'

interface Props {
  label: string
}

export const DateDivider = memo(function DateDivider({ label }: Props) {
  return (
    <div className="date-divider">
      <span className="date-divider__label">{label}</span>
      <span className="date-divider__line" />
    </div>
  )
})
