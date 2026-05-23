import type { AgentFolderRow } from '../types/agent'

interface Props {
  folders: AgentFolderRow[]
  onClose: () => void
  onCreated: (id: string) => void
}

export default function NewAgentModal(_props: Props) {
  return <div role="dialog" aria-label="New agent" />
}
