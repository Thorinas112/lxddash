const API = '/api'

export function getToken(): string | null {
  return localStorage.getItem('lxddash_token')
}

export function setToken(token: string) {
  localStorage.setItem('lxddash_token', token)
}

export function clearToken() {
  localStorage.removeItem('lxddash_token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API}${path}`, { ...options, headers })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
  }
  if (!res.ok) {
    let msg = res.statusText
    let body: any = null
    try {
      body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { body?: any }
    err.body = body
    throw err
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json() as Promise<T>
  return res.text() as unknown as Promise<T>
}

export const api = {
  auth: {
    status: () => request<{ setup_required: boolean }>('/auth/status'),
    setup: (username: string, password: string) =>
      request<{ token: string }>('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
  },

  login: (username: string, password: string) =>
    request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  tokens: {
    list: () => request<any[]>('/auth/tokens'),
    create: (name: string) =>
      request<{ token: string; meta: any }>('/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    remove: (id: string) => request<any>(`/auth/tokens/${id}`, { method: 'DELETE' }),
  },

  systemd: {
    services: () => request<any[]>('/systemd/services'),
    action: (name: string, action: string) =>
      request<any>(`/systemd/services/${encodeURIComponent(name)}/${action}`, { method: 'POST' }),
  },

  updates: {
    status: () => request<any>('/updates'),
    upgrade: () => request<any>('/updates/upgrade', { method: 'POST' }),
  },

  notify: {
    get: () => request<{ url: string }>('/notify'),
    set: (url: string) => request<any>('/notify', { method: 'POST', body: JSON.stringify({ url }) }),
    test: () => request<any>('/notify/test', { method: 'POST' }),
  },

  host: {
    power: (action: 'reboot' | 'poweroff') =>
      request<any>('/host/power', { method: 'POST', body: JSON.stringify({ action }) }),
    logs: (unit: string, lines = 200) =>
      request<{ logs: string }>(`/host/logs?unit=${encodeURIComponent(unit)}&lines=${lines}`),
    disks: () => request<{ mounts: any[]; disks: any[] }>('/host/disks'),
  },

  alerts: {
    get: () => request<any>('/alerts'),
    set: (body: any) => request<any>('/alerts', { method: 'POST', body: JSON.stringify(body) }),
  },

  forwards: {
    list: () => request<any[]>('/forwards'),
    add: (body: any) => request<any>('/forwards', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: string) => request<any>(`/forwards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  overview: () => request<any>('/dashboard/overview'),

  search: (q: string) => request<any[]>(`/search?q=${encodeURIComponent(q)}`),

  metrics: (hours = 1) => request<any[]>(`/metrics?hours=${hours}`),

  resourceMetrics: (hours = 24) => request<any[]>(`/resource-metrics?hours=${hours}`),

  activity: (category = '', limit = 100) =>
    request<any[]>(`/activity?category=${category}&limit=${limit}`),

  backups: {
    jobs: () => request<any[]>('/backups/jobs'),
    create: (body: any) =>
      request<any>('/backups/jobs', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: string) => request<any>(`/backups/jobs/${id}`, { method: 'DELETE' }),
    toggle: (id: string, enabled: boolean) =>
      request<any>(`/backups/jobs/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    runNow: (id: string) => request<any>(`/backups/jobs/${id}/run`, { method: 'POST' }),
  },

  docker: {
    containers: () => request<any[]>('/docker/containers'),
    stats: () => request<any[]>('/docker/stats'),
    create: (body: any) =>
      request<any>('/docker/containers', { method: 'POST', body: JSON.stringify(body) }),
    action: (id: string, action: 'start' | 'stop' | 'restart' | 'remove') =>
      action === 'remove'
        ? request<any>(`/docker/containers/${id}`, { method: 'DELETE' })
        : request<any>(`/docker/containers/${id}/${action}`, { method: 'POST' }),
    logs: (id: string, tail = '200') => request<string>(`/docker/containers/${id}/logs?tail=${tail}`),
    images: () => request<any[]>('/docker/images'),
    pullImage: (ref: string) =>
      request<any>('/docker/images/pull', { method: 'POST', body: JSON.stringify({ ref }) }),
    removeImage: (id: string) => request<any>(`/docker/images/${id}`, { method: 'DELETE' }),
    networks: () => request<any[]>('/docker/networks'),
    volumes: () => request<any[]>('/docker/volumes'),
    removeVolume: (name: string) => request<any>(`/docker/volumes/${name}`, { method: 'DELETE' }),
    removeNetwork: (id: string) => request<any>(`/docker/networks/${id}`, { method: 'DELETE' }),
    compose: (action: 'up' | 'down' | 'pull' | 'ps', dir: string) =>
      request<any>(`/docker/compose/${action}`, { method: 'POST', body: JSON.stringify({ dir }) }),
  },

  lxd: {
    instances: (withState = true) => request<any[]>(`/lxd/instances?state=${withState ? 1 : 0}`),
    create: (body: any) =>
      request<any>('/lxd/instances', { method: 'POST', body: JSON.stringify(body) }),
    action: (name: string, action: 'start' | 'stop' | 'restart' | 'remove') =>
      action === 'remove'
        ? request<any>(`/lxd/instances/${name}`, { method: 'DELETE' })
        : request<any>(`/lxd/instances/${name}/${action}`, { method: 'POST' }),
    update: (name: string, body: any) =>
      request<any>(`/lxd/instances/${name}`, { method: 'PATCH', body: JSON.stringify(body) }),
    updates: (name: string) => request<any>(`/lxd/instances/${encodeURIComponent(name)}/updates`),
    logs: (name: string) => request<string>(`/lxd/instances/${encodeURIComponent(name)}/logs`),
    processes: (name: string) => request<string>(`/lxd/instances/${encodeURIComponent(name)}/processes`),
    snapshots: (name: string) => request<any[]>(`/lxd/instances/${name}/snapshots`),
    createSnapshot: (name: string, snapshot: string) =>
      request<any>(`/lxd/instances/${name}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ name: snapshot }),
      }),
    restoreSnapshot: (name: string, snapshot: string) =>
      request<any>(`/lxd/instances/${name}/snapshots/${snapshot}/restore`, { method: 'POST' }),
    deleteSnapshot: (name: string, snapshot: string) =>
      request<any>(`/lxd/instances/${name}/snapshots/${snapshot}`, { method: 'DELETE' }),
    backups: (name: string) => request<any[]>(`/lxd/instances/${name}/backups`),
    createBackup: (name: string, backup: string) =>
      request<any>(`/lxd/instances/${name}/backups`, {
        method: 'POST',
        body: JSON.stringify({ name: backup }),
      }),
    restoreBackup: (name: string, backup: string) =>
      request<any>(`/lxd/instances/${name}/backups/${backup}/restore`, { method: 'POST' }),
    deleteBackup: (name: string, backup: string) =>
      request<any>(`/lxd/instances/${name}/backups/${backup}`, { method: 'DELETE' }),
    images: () => request<any[]>('/lxd/images'),
    pullImage: (remote: string) =>
      request<any>('/lxd/images/pull', { method: 'POST', body: JSON.stringify({ remote }) }),
    deleteImage: (fingerprint: string) =>
      request<any>(`/lxd/images/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' }),
    profiles: () => request<any[]>('/lxd/profiles'),
    createProfile: (body: any) =>
      request<any>('/lxd/profiles', { method: 'POST', body: JSON.stringify(body) }),
    updateProfile: (name: string, body: any) =>
      request<any>(`/lxd/profiles/${name}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteProfile: (name: string) => request<any>(`/lxd/profiles/${name}`, { method: 'DELETE' }),
    networks: () => request<any[]>('/lxd/networks'),
    createNetwork: (body: any) =>
      request<any>('/lxd/networks', { method: 'POST', body: JSON.stringify(body) }),
    deleteNetwork: (name: string) =>
      request<any>(`/lxd/networks/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    acls: () => request<any[]>('/lxd/acls'),
    createAcl: (body: any) => request<any>('/lxd/acls', { method: 'POST', body: JSON.stringify(body) }),
    updateAcl: (name: string, body: any) =>
      request<any>(`/lxd/acls/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteAcl: (name: string) =>
      request<any>(`/lxd/acls/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    files: (name: string, path: string) =>
      request<any[]>(`/lxd/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`),
    uploadFile: (name: string, path: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(
        `${API}/lxd/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
        { method: 'POST', body: form, headers },
      ).then(async (res) => {
        if (!res.ok) {
          let msg = res.statusText
          try {
            const body = await res.json()
            if (body?.error) msg = body.error
          } catch {
            /* ignore */
          }
          throw new Error(msg)
        }
        return res.json()
      })
    },
    deleteFile: (name: string, path: string) =>
      request<any>(`/lxd/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      }),
    storagePools: () => request<any[]>('/lxd/storage-pools'),
    createStoragePool: (body: any) =>
      request<any>('/lxd/storage-pools', { method: 'POST', body: JSON.stringify(body) }),
    deleteStoragePool: (name: string) =>
      request<any>(`/lxd/storage-pools/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    storageVolumes: (pool: string) =>
      request<any[]>(`/lxd/storage-pools/${encodeURIComponent(pool)}/volumes`),
    createStorageVolume: (pool: string, body: any) =>
      request<any>(`/lxd/storage-pools/${encodeURIComponent(pool)}/volumes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteStorageVolume: (pool: string, name: string) =>
      request<any>(`/lxd/storage-pools/${encodeURIComponent(pool)}/volumes/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
  },

  vms: {
    list: () => request<any[]>('/vms'),
    stats: () => request<any[]>('/vms/stats'),
    create: (body: any) =>
      request<any>('/vms', { method: 'POST', body: JSON.stringify(body) }),
    isos: () => request<any[]>('/vms/isos'),
    uploadISO: (file: File) => {
      const form = new FormData()
      form.append('iso', file)
      const headers: Record<string, string> = {}
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(`${API}/vms/isos/upload`, { method: 'POST', body: form, headers }).then(
        (res) => {
          if (!res.ok) throw new Error('ISO upload failed')
          return res.json()
        },
      )
    },
    deleteISO: (name: string) =>
      request<any>(`/vms/isos/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    action: (uuid: string, action: 'start' | 'shutdown' | 'reboot' | 'force-stop' | 'remove') =>
      action === 'remove'
        ? request<any>(`/vms/${uuid}`, { method: 'DELETE' })
        : request<any>(`/vms/${uuid}/${action}`, { method: 'POST' }),
    clone: (uuid: string, name: string) =>
      request<any>(`/vms/${uuid}/clone`, { method: 'POST', body: JSON.stringify({ name }) }),
    snapshots: (uuid: string) => request<any[]>(`/vms/${uuid}/snapshots`),
    createSnapshot: (uuid: string, name: string) =>
      request<any>(`/vms/${uuid}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) }),
    revertSnapshot: (uuid: string, name: string) =>
      request<any>(`/vms/${uuid}/snapshots/${encodeURIComponent(name)}/revert`, { method: 'POST' }),
    deleteSnapshot: (uuid: string, name: string) =>
      request<any>(`/vms/${uuid}/snapshots/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    setAutostart: (uuid: string, enabled: boolean) =>
      request<any>(`/vms/${uuid}/autostart`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    resize: (uuid: string, body: any) =>
      request<any>(`/vms/${uuid}/resize`, { method: 'POST', body: JSON.stringify(body) }),
  },

  proxmox: {
    backups: () => request<any[]>('/proxmox/backups'),
    upload: (file: File) => {
      const form = new FormData()
      form.append('backup', file)
      const headers: Record<string, string> = {}
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(`${API}/proxmox/backups/upload`, { method: 'POST', body: form, headers }).then(
        (res) => {
          if (!res.ok) return res.json().then((b) => { throw new Error(b?.error || 'upload failed') })
          return res.json()
        },
      )
    },
    remove: (filename: string) =>
      request<any>(`/proxmox/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
    import: (path: string) =>
      request<any>('/proxmox/import', { method: 'POST', body: JSON.stringify({ path }) }),
    tasks: () => request<any[]>('/proxmox/tasks'),
  },

  ollama: {
    models: () => request<any[]>('/ollama/models'),
    pull: (name: string) =>
      request<any>('/ollama/models/pull', { method: 'POST', body: JSON.stringify({ name }) }),
    remove: (name: string) => request<any>(`/ollama/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    assist: (prompt: string) =>
      request<any>('/ollama/assist', { method: 'POST', body: JSON.stringify({ prompt }) }),
    chat: (body: any) =>
      request<any>('/ollama/chat', { method: 'POST', body: JSON.stringify(body) }),
    chatStream: (body: any, onChunk: (text: string) => void, signal?: AbortSignal) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(`${API}/ollama/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true }),
        signal,
      }).then(async (res) => {
        if (!res.ok || !res.body) throw new Error('chat failed')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const chunk = JSON.parse(line)
              if (chunk.message?.content) onChunk(chunk.message.content)
            } catch {
              /* ignore partial */
            }
          }
        }
      })
    },
    stats: () => request<any>('/ollama/stats'),
  },
}