import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Guard } from './screens/Guard'
import { Placeholder } from './screens/Placeholder'
import { SCREENS } from './screens/registry'
import { Overview } from './screens/Overview'
import { RiskInbox } from './screens/RiskInbox'
import { SupplierNetwork } from './screens/SupplierNetwork'
import { Impact } from './screens/Impact'
import { Response } from './screens/Response'
import { Actions } from './screens/Actions'
import { Sources } from './screens/Sources'
import { RulesData } from './screens/RulesData'
import { Simulator } from './screens/Simulator'
import { SupplierDashboard } from './screens/SupplierDashboard'
import { Market } from './screens/Market'
import { SupplierProfile } from './screens/SupplierProfile'
import { Configuration } from './screens/Configuration'
import { DataQuotes } from './screens/DataQuotes'
import { StressTest } from './screens/StressTest'
import { Decision } from './screens/Decision'
import { SupplierMaster } from './screens/SupplierMaster'
import { DataReview } from './screens/DataReview'
import { Requirement } from './screens/Requirement'
import { Comparison } from './screens/Comparison'
import { ActionsReport, ConcentrationReport, LifecycleReport, RiskExposureReport } from './screens/Reports'

const BUILT: Record<string, JSX.Element> = {
  MS11: <Market />,
  MS12: <SupplierDashboard />,
  MS01: <Requirement />,
  MS02: <DataQuotes />,
  MS04: <SupplierProfile />,
  MS05: <StressTest />,
  MS06: <Decision />,
  MS08: <Configuration />,
  MS09: <DataReview />,
  MS10: <SupplierMaster />,
  MS03: <Comparison />,
  S01: <Overview />,
  S02: <RiskInbox />,
  S03: <SupplierNetwork />,
  S04: <Impact />,
  S05: <Response />,
  S06: <Actions />,
  S07: <Sources />,
  S08: <RulesData />,
  S09: <Simulator />,
  RP1: <RiskExposureReport />,
  RP2: <ConcentrationReport />,
  RP3: <ActionsReport />,
  RP4: <LifecycleReport />,
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/market" replace />} />
        {SCREENS.filter((s) => !s.hidden).map((s) => (
          <Route
            key={s.id}
            path={s.path}
            element={<Guard screen={s.id}>{BUILT[s.id] ?? <Placeholder screen={s} />}</Guard>}
          />
        ))}
        <Route path="*" element={<Navigate to="/market" replace />} />
      </Route>
    </Routes>
  )
}
