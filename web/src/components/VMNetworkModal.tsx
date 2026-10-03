import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Modal from './Modal'
import { btnGhost, btnPrimary, inputCls } from './ui'

// VMNetworkModal points a VM's NIC at a different libvirt network.
// The VM must be shut off — the domain is redefined with the new source.
export default function VMNetworkModal({
  uuid,
  name,
  state,
  onClose,
  onSaved,
}: {
  uuid: string
  name: string
  state: string
  onClose: () => void
  onSaved: () => void
}) {
  const [networks, setNetworks] = useState<any[]>([])
  const [network, setNetwork] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.vms
      .networks()
      .then(setNetworks)
      .catch(() => {})
    api.vms
      .vm(uuid)
      .then((vm) => {
        const cur = vm?.interfaces?.[0]?.network
        if (cur) setNetwork(cur)
      })
      .catch(() => {})
  }, [uuid])

  async function submit() {
    if (!network) return
    setBusy(true)
    setError('')
    try {
      await api.vms.setNetwork(uuid, { network })
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const running = state === 'running'

  return (
    <Modal title={`Network — ${name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Attach the VM to a different libvirt network. The <b>lan</b> network
          (Networks page → LAN access) hands out router DHCP addresses.
        </p>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
            Network
          </label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)} className={inputCls}>
            <option value="">— select a network —</option>
            {networks.map((n: any) => (
              <option key={n.name} value={n.name}>
                {n.name}
                {n.active ? '' : ' (stopped)'}
              </option>
            ))}
          </select>
        </div>
        {running && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            The VM is <b>running</b> — shut it down first, then apply. The change
            takes effect on the next start.
          </div>
        )}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !network || running} className={btnPrimary}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
