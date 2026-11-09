import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL, type ScreenId } from '../auth/roles'
import { PageHead } from '../components/ui'

export function Guard({ screen, children }: { screen: ScreenId; children: ReactNode }) {
  const { canView, user } = useAuth()
  if (canView(screen)) return <>{children}</>
  return (
    <div className="page">
      <PageHead title="Access denied">
        Your role ({user.roles.map((r) => ROLE_LABEL[r]).join(', ')}) does not have access to this screen. Access is also enforced by the API.
      </PageHead>
    </div>
  )
}
