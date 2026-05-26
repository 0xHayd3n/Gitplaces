import SectionBlock from './shared/SectionBlock'

export default function AIPanel() {
  return (
    <>
      <SectionBlock title="API / HTTPS" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>API providers coming in Task 6.</div>
      </SectionBlock>

      <SectionBlock title="CLI" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>CLI providers coming in Task 7.</div>
      </SectionBlock>

      <SectionBlock title="MCP" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>MCP exposure coming in Task 8.</div>
      </SectionBlock>

      <SectionBlock title="Custom MCP" badge="BETA" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Custom MCP coming in Task 9.</div>
      </SectionBlock>

      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
    </>
  )
}
