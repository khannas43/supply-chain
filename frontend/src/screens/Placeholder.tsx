import { PageHead } from '../components/ui'
import type { ScreenDef } from './registry'

export function Placeholder({ screen }: { screen: ScreenDef }) {
  return (
    <div className="page">
      <PageHead title={`${screen.id} ${screen.label}`}>{screen.purpose}</PageHead>
      <div className="card empty">This screen is next in the build order.</div>
    </div>
  )
}
