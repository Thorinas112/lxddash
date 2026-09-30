import { useCallback, useEffect, useState } from 'react'
import { confirm } from '../components/ConfirmDialog'
import { api } from '../api/client'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'
import { btnAction, btnPrimary, inputCls } from '../components/ui'

interface Image {
  fingerprint: string
  aliases?: { name: string }[]
  properties?: Record<string, string>
  architecture?: string
  type?: string
  size?: number
  created_at?: string
  cached?: boolean
  auto_update?: boolean
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Images() {
  const [images, setImages] = useState<Image[]>([])
  const [isos, setIsos] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pullOpen, setPullOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setImages(await api.lxd.images())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const loadIsos = useCallback(async () => {
    try {
      const list = await api.vms.isos()
      setIsos(Array.isArray(list) ? list : [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadIsos()
  }, [load, loadIsos])

  async function uploadISO(file: File) {
    setUploading(true)
    setError('')
    try {
      await api.vms.uploadISO(file)
      await loadIsos()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function removeISO(name: string) {
    if (!(await confirm(`Delete ISO ${name}?`))) return
    setBusy('iso:' + name)
    setError('')
    try {
      await api.vms.deleteISO(name)
      await loadIsos()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove(img: Image) {
    if (!(await confirm(`Delete image ${img.aliases?.[0]?.name || img.fingerprint.slice(0, 12)}?`))) return
    setBusy(img.fingerprint)
    setError('')
    try {
      await api.lxd.deleteImage(img.fingerprint)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">LXD Images</h1>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {uploading ? <Spinner /> : null}
            {uploading ? 'Uploading…' : '+ Upload ISO'}
            <input
              type="file"
              accept=".iso"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadISO(f)
                e.target.value = ''
              }}
            />
          </label>
          <button onClick={() => setPullOpen(true)} className={btnPrimary}>
            + Pull image
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Alias</th>
              <th className="px-4 py-3">Fingerprint</th>
              <th className="px-4 py-3">OS</th>
              <th className="px-4 py-3">Arch</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {images.map((img) => {
              const alias = img.aliases?.map((a) => a.name).join(', ') || '—'
              const os = img.properties?.['os'] || '—'
              const ver = img.properties?.['release'] || ''
              return (
                <tr key={img.fingerprint} className="bg-white hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{alias}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {img.fingerprint.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {os}
                    {ver ? ` ${ver}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{img.architecture || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{img.type || '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">{fmtBytes(img.size || 0)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {img.created_at ? new Date(img.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {busy === img.fingerprint ? (
                      <Spinner />
                    ) : (
                      <button
                        onClick={() => remove(img)}
                        className={btnAction('bg-red-100 text-red-700')}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {images.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No images cached. Pull one, e.g. <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">ubuntu:24.04</code>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Install ISOs — stored on the host, used by the VM create flow */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Install ISOs ({isos.length})
        </h2>
        {isos.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-8 text-center text-sm text-gray-500 shadow-sm">
            No ISOs uploaded yet. Upload one to use it when creating VMs.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isos.map((iso) => (
                  <tr key={iso.name} className="bg-white hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{iso.name}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{fmtBytes(iso.size)}</td>
                    <td className="px-4 py-3 text-right">
                      {busy === 'iso:' + iso.name ? (
                        <Spinner />
                      ) : (
                        <button
                          onClick={() => removeISO(iso.name)}
                          className={btnAction('bg-red-100 text-red-700')}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pullOpen && (
        <PullModal
          onClose={() => setPullOpen(false)}
          onPulled={() => {
            setPullOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function PullModal({ onClose, onPulled }: { onClose: () => void; onPulled: () => void }) {
  const [remote, setRemote] = useState('ubuntu:24.04')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.pullImage(remote)
      onPulled()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title="Pull image"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Pull image"
      steps={[
        {
          label: 'Pick image',
          valid: remote.trim() !== '',
          body: (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Images come from the{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">images.lxd.canonical.com</code>{' '}
                mirror (all major distros) or any public LXD server URL.
              </p>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
                  Popular images
                </label>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setRemote(e.target.value)
                  }}
                  className={inputCls}
                >
                  <option value="">— pick an image —</option>
                  {POPULAR_IMAGES.map((img) => (
                    <option key={img.remote} value={img.remote}>
                      {img.label} ({img.remote})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
                  Or type a custom remote:alias
                </label>
                <input
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                  placeholder="ubuntu:24.04"
                  className={inputCls}
                />
              </div>
            </div>
          ),
        },
        {
          label: 'Confirm',
          body: (
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <ReviewRow k="Image" v={remote} />
              </div>
              <div className="rounded border border-gray-200 bg-panel2 p-2 text-[11px] leading-relaxed text-gray-500">
                <span className="font-medium text-gray-600">Available remotes:</span>{' '}
                ubuntu · ubuntu-daily · debian · alpine · archlinux · centos · fedora · oracle ·
                rockylinux · almalinux · opensuse · gentoo · images — or an{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">https://…</code> LXD
                server URL. Examples:{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">ubuntu:24.04/cloud</code>,{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">debian:12</code>,{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">alpine:3.24</code>
              </div>
              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{k}</dt>
      <dd className="truncate text-right font-mono text-xs text-gray-800">{v}</dd>
    </div>
  )
}

// POPULAR_IMAGES is a curated list of images currently available on
// the images.lxd.canonical.com mirror (verified 2026-09-26).
const POPULAR_IMAGES: { label: string; remote: string }[] = [
  { label: 'Ubuntu 26.04 LTS (Resolute)', remote: 'ubuntu:26.04' },
  { label: 'Ubuntu 26.04 LTS Cloud', remote: 'ubuntu:26.04/cloud' },
  { label: 'Ubuntu 24.04 LTS (Noble)', remote: 'ubuntu:24.04' },
  { label: 'Ubuntu 24.04 LTS Cloud', remote: 'ubuntu:24.04/cloud' },
  { label: 'Ubuntu 22.04 LTS (Jammy)', remote: 'ubuntu:22.04' },
  { label: 'Debian 14 (Forky)', remote: 'debian:14' },
  { label: 'Debian 13 (Trixie)', remote: 'debian:13' },
  { label: 'Debian 12 (Bookworm)', remote: 'debian:12' },
  { label: 'Alpine 3.24', remote: 'alpine:3.24' },
  { label: 'Alpine 3.23', remote: 'alpine:3.23' },
  { label: 'Alpine 3.22', remote: 'alpine:3.22' },
  { label: 'Alpine Edge', remote: 'alpine:edge' },
  { label: 'Arch Linux (current)', remote: 'archlinux:current' },
  { label: 'Fedora 44', remote: 'fedora:44' },
  { label: 'Fedora 43', remote: 'fedora:43' },
  { label: 'CentOS 10 Stream', remote: 'centos:10-Stream' },
  { label: 'CentOS 9 Stream', remote: 'centos:9-Stream' },
  { label: 'Rocky Linux 10', remote: 'rockylinux:10' },
  { label: 'Rocky Linux 9', remote: 'rockylinux:9' },
  { label: 'Rocky Linux 8', remote: 'rockylinux:8' },
  { label: 'AlmaLinux 10', remote: 'almalinux:10' },
  { label: 'AlmaLinux 9', remote: 'almalinux:9' },
  { label: 'AlmaLinux 8', remote: 'almalinux:8' },
  { label: 'Oracle Linux 10', remote: 'oracle:10' },
  { label: 'Oracle Linux 9', remote: 'oracle:9' },
  { label: 'Oracle Linux 8', remote: 'oracle:8' },
  { label: 'openSUSE Leap 16.0', remote: 'opensuse:16.0' },
  { label: 'openSUSE Tumbleweed', remote: 'opensuse:tumbleweed' },
  { label: 'Gentoo (systemd)', remote: 'gentoo:current/systemd' },
  { label: 'Gentoo (openrc)', remote: 'gentoo:current/openrc' },
  { label: 'Amazon Linux 2023', remote: 'amazonlinux:2023' },
  { label: 'Kali Linux (current)', remote: 'kali:current' },
  { label: 'Linux Mint 22 (Zena)', remote: 'mint:zena' },
  { label: 'NixOS 26.05', remote: 'nixos:26.05' },
  { label: 'Void Linux (glibc)', remote: 'voidlinux:current' },
  { label: 'FreeBSD 15.1', remote: 'freebsd:15.1' },
  { label: 'OpenWrt 25.12', remote: 'openwrt:25.12' },
  { label: 'BusyBox 1.38', remote: 'busybox:1.38.0' },
  { label: 'Slackware (current)', remote: 'slackware:current' },
]