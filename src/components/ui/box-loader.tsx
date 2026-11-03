import type React from "react"

type LoaderVariant = 'default' | 'purple' | 'green' | 'pink' | 'blue'

interface Props {
  className?: string
  style?: React.CSSProperties
  variant?: LoaderVariant
}

const Loader: React.FC<Props> = ({ className = '', style, variant = 'default' }) => {
  const root = [
    'hon-box-loader',
    `hon-box-loader--${variant}`,
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={root} style={style}>
      <div className="boxes">
        <div className="box box-1">
          <div className="face face-front" />
          <div className="face face-right" />
          <div className="face face-left" />
          <div className="face face-top" />
          <div className="face face-bottom" />
          <div className="face face-back" />
        </div>
        <div className="box box-2">
          <div className="face face-front" />
          <div className="face face-right" />
          <div className="face face-left" />
          <div className="face face-top" />
          <div className="face face-bottom" />
          <div className="face face-back" />
        </div>
        <div className="box box-3">
          <div className="face face-front" />
          <div className="face face-right" />
          <div className="face face-left" />
          <div className="face face-top" />
          <div className="face face-bottom" />
          <div className="face face-back" />
        </div>
        <div className="box box-4">
          <div className="face face-front" />
          <div className="face face-right" />
          <div className="face face-left" />
          <div className="face face-top" />
          <div className="face face-bottom" />
          <div className="face face-back" />
        </div>
      </div>
      <div className="reflection" aria-hidden="true">
        <div className="tile t-1" />
        <div className="tile t-2" />
        <div className="tile t-3" />
        <div className="tile t-4" />
      </div>
    </div>
  )
}

export default Loader


