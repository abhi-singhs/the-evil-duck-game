import { Hunt } from './Hunt'
import { useSave } from './useSave'

export default function App() {
  const { settings, best, storageWarning, setSettings, recordResult } = useSave()

  return (
    <Hunt key="solo" settings={settings} best={best} storageWarning={storageWarning}
      setSettings={setSettings} onComplete={recordResult} />
  )
}
